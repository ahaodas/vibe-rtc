// RTCSignaler.ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import type { SignalDB, OfferSDP, AnswerSDP } from './types'
import { Subscription } from 'rxjs'
import { createSignalStreams } from './signal-rx'
import { RTCError, RTCErrorCode, toRTCError, type RTCErrorPhase } from './errors'

let __seq = 0
const now = () =>
    typeof performance !== 'undefined' && performance.now
        ? performance.now().toFixed(1)
        : String(Date.now())

const sdpHash = (s?: string | null) => {
    if (!s) return '∅'
    const line1 = s.split('\n')[0]?.trim() ?? ''
    let x = 0
    for (let i = 0; i < line1.length; i++) x = (x * 33) ^ line1.charCodeAt(i)
    return `${line1} #${(x >>> 0).toString(16)}`
}

function mkDbg(ctx: {
    role: 'caller' | 'callee'
    roomId: () => string | null
    pc: () => RTCPeerConnection | undefined
}) {
    const p = (msg: string, extra?: any) => {
        const pc = ctx.pc()
        const tag = `[${++__seq}|${now()}|${ctx.role}|${ctx.roomId() ?? 'no-room'}]`
        const sig = pc ? pc.signalingState : 'no-pc'
        const ice = pc ? pc.iceConnectionState : 'no-pc'
        const ls = pc?.localDescription?.type ?? '∅'
        console.log(`${tag} ${msg}  [sig=${sig} ice=${ice} loc=${ls}]`, extra ?? '')
    }
    const pe = (msg: string, e: unknown) => {
        const pc = ctx.pc()
        const tag = `[${++__seq}|${now()}|${ctx.role}|${ctx.roomId() ?? 'no-room'}]`
        const sig = pc ? pc.signalingState : 'no-pc'
        console.error(`${tag} ${msg} [sig=${sig}]`, e)
    }
    return { p, pe }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

type Unsub = () => void
export type Role = 'caller' | 'callee'

export interface RTCSignalerOptions {
    rtcConfiguration?: RTCConfiguration
    fastLabel?: string
    reliableLabel?: string
    fastInit?: RTCDataChannelInit
    reliableInit?: RTCDataChannelInit
    fastBufferedAmountLowThreshold?: number
    reliableBufferedAmountLowThreshold?: number
    onMessage?: (text: string, meta: { reliable: boolean }) => void
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void
    onFastOpen?: () => void
    onFastClose?: () => void
    onReliableOpen?: () => void
    onReliableClose?: () => void
    onError?: (err: RTCError) => void
    onDebug?: (state: DebugState) => void // NEW: хук для UI
}

export type Phase =
    | 'idle'
    | 'subscribed'
    | 'negotiating'
    | 'connected'
    | 'soft-reconnect'
    | 'hard-reconnect'
    | 'closing'

export interface DebugState {
    ts: number
    roomId: string | null
    role: Role
    phase: Phase
    makingOffer: boolean
    polite: boolean
    pcState: RTCPeerConnectionState | 'none'
    iceState: RTCIceConnectionState | 'none'
    signalingState: RTCSignalingState | 'none'
    fast?: { state: RTCDataChannelState; ba: number }
    reliable?: { state: RTCDataChannelState; ba: number }
    pendingIce: number
    retries: { soft: number; hard: number }
    timers: { softPending: boolean; hardPending: boolean; softInMs?: number; hardInMs?: number }
    lastEvent?: string
    lastError?: string
}

export class RTCSignaler {
    private pc!: RTCPeerConnection | undefined
    private dcFast?: RTCDataChannel
    private dcReliable?: RTCDataChannel

    private makingOffer = false
    private polite: boolean

    private roomId: string | null = null
    private unsubscribes: Unsub[] = [] // оставлено для совместимости, но не используется с Rx
    private connectedOrSubbed = false

    private readonly rtcConfig: RTCConfiguration
    private readonly fastLabel: string
    private readonly reliableLabel: string
    private readonly fastInit: RTCDataChannelInit
    private readonly reliableInit: RTCDataChannelInit
    private readonly fastBALow: number
    private readonly reliableBALow: number

    private lastHandledOfferSdp: string | null = null
    private lastHandledAnswerSdp: string | null = null
    private lastSeenOfferSdp: string | null = null
    private lastSeenAnswerSdp: string | null = null
    private lastLocalOfferSdp: string | null = null
    private answering = false

    private remoteDescSet = false
    private pendingIce: RTCIceCandidateInit[] = []

    private fastQueue: string[] = []
    private reliableQueue: string[] = []

    private fastOpenWaiters: Array<(ch: RTCDataChannel) => void> = []
    private reliableOpenWaiters: Array<(ch: RTCDataChannel) => void> = []

    private onMessage: (t: string, meta: { reliable: boolean }) => void
    private onConnectionStateChange: (s: RTCPeerConnectionState) => void
    private onFastOpen: () => void
    private onFastClose: () => void
    private onReliableOpen: () => void
    private onReliableClose: () => void
    private onError: (e: RTCError) => void
    private onDebug: (d: DebugState) => void

    private dbg

    private softTimer?: number
    private hardTimer?: number
    private softDelayMs = 250
    private hardDelayMs = 6000
    private softRetries = 0
    private hardRetries = 0

    private phase: Phase = 'idle'
    private lastErrorText: string | undefined
    private signalingEpoch = 0

    // --- Новое: RxJS обёртка над сигналингом + список подписок ---
    private streams
    private rxSubs: Subscription[] = []

    constructor(
        private readonly role: Role,
        private readonly signalDb: SignalDB,
        opts: RTCSignalerOptions = {},
    ) {
        this.dbg = mkDbg({ role: this.role, roomId: () => this.roomId, pc: () => this.pc })
        this.polite = role === 'callee'
        this.rtcConfig = opts.rtcConfiguration ?? {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        }

        this.fastLabel = opts.fastLabel ?? 'fast'
        this.reliableLabel = opts.reliableLabel ?? 'reliable'
        this.fastInit = { ordered: false, maxRetransmits: 0, ...(opts.fastInit ?? {}) }
        this.reliableInit = { ordered: true, ...(opts.reliableInit ?? {}) }
        this.fastBALow = opts.fastBufferedAmountLowThreshold ?? 64 * 1024
        this.reliableBALow = opts.reliableBufferedAmountLowThreshold ?? 256 * 1024

        this.onMessage = opts.onMessage ?? (() => {})
        this.onConnectionStateChange = opts.onConnectionStateChange ?? (() => {})
        this.onFastOpen = opts.onFastOpen ?? (() => {})
        this.onFastClose = opts.onFastClose ?? (() => {})
        this.onReliableOpen = opts.onReliableOpen ?? (() => {})
        this.onReliableClose = opts.onReliableClose ?? (() => {})
        this.onError = (e) => {
            this.lastErrorText = `${e.code}: ${e.message}`
            ;(opts.onError ?? ((ee) => console.error('[RTCSignaler]', ee)))(e)
            this.emitDebug('error')
        }
        this.onDebug = opts.onDebug ?? (() => {})

        this.streams = createSignalStreams(this.signalDb)
    }

    // ————————————————————————————————————————————————————————————————
    // Public API
    // ————————————————————————————————————————————————————————————————

    async createRoom(): Promise<string> {
        let id: string
        try {
            id = await this.signalDb.createRoom()
        } catch (e) {
            throw this.raiseError(e, RTCErrorCode.DB_UNAVAILABLE, 'room', true, 'createRoom failed')
        }
        this.roomId = id
        try {
            const room = await this.signalDb.getRoom()
            this.signalingEpoch = room?.epoch ?? 0
        } catch (e) {
            this.onError(
                this.raiseError(
                    e,
                    RTCErrorCode.DB_UNAVAILABLE,
                    'room',
                    true,
                    'createRoom: failed to sync room epoch',
                    false,
                ),
            )
        }
        this.dbg.p('createRoom -> ' + id)
        this.emitDebug('createRoom')
        return id
    }

    async joinRoom(id: string): Promise<void> {
        this.roomId = id
        this.dbg.p('joinRoom -> ' + id)
        try {
            await this.signalDb.joinRoom(id, this.role)
        } catch (e) {
            throw this.raiseError(e, RTCErrorCode.DB_UNAVAILABLE, 'room', true, 'joinRoom failed')
        }
        try {
            const room = await this.signalDb.getRoom()
            this.signalingEpoch = room?.epoch ?? 0
        } catch (e) {
            this.signalingEpoch = 0
            this.onError(
                this.raiseError(
                    e,
                    RTCErrorCode.DB_UNAVAILABLE,
                    'room',
                    true,
                    'joinRoom: failed to load room snapshot',
                    false,
                ),
            )
        }
        this.phase = 'subscribed'
        this.emitDebug('joinRoom')
    }

    async connect(): Promise<void> {
        if (!this.roomId) {
            throw this.raiseError(
                new Error('Room not selected'),
                RTCErrorCode.ROOM_NOT_SELECTED,
                'room',
                false,
            )
        }
        if (this.connectedOrSubbed) {
            this.dbg.p('connect() skipped (already connected/subscribed)')
            return
        }
        this.connectedOrSubbed = true

        this.initPeer()
        this.emitDebug('initPeer')

        // --- Rx: подписки на удалённые ICE-кандидаты ---
        const remoteIce$ = this.role === 'caller' ? this.streams.calleeIce$ : this.streams.callerIce$
        this.rxSubs.push(
            remoteIce$.subscribe(async (c) => {
                if (!this.acceptEpoch((c as any).epoch)) return
                this.dbg.p(`remote ICE from ${this.role === 'caller' ? 'callee' : 'caller'}`, {
                    buffered: !this.remoteDescSet,
                    cand: (c.candidate || '').slice(0, 42),
                })
                try {
                    if (!this.remoteDescSet) {
                        this.pendingIce.push(c)
                        return
                    }
                    await this?.pc?.addIceCandidate(c)
                } catch (e) {
                    this.onError(
                        this.raiseError(e, RTCErrorCode.SIGNALING_FAILED, 'signaling', true, undefined, false),
                    )
                }
            }),
        )

        // --- Rx: входящие offer ---
        this.rxSubs.push(
            this.streams.offer$.subscribe(async (offer) => {
                if (!this.acceptEpoch((offer as any).epoch)) return
                const desc = new RTCSessionDescription(offer)
                const sdp = desc.sdp ?? null
                this.dbg.p('onOffer()', {
                    type: desc.type,
                    sdp: sdpHash(sdp),
                    makingOffer: this.makingOffer,
                    sig: this.pc?.signalingState,
                    polite: this.polite,
                })
                this.emitDebug('onOffer')

                if (sdp && sdp === this.lastSeenOfferSdp) {
                    this.dbg.p('skip offer: already seen')
                    return
                }
                this.lastSeenOfferSdp = sdp

                try {
                    if (desc.type !== 'offer') return

                    if (
                        this.role === 'caller' &&
                        sdp &&
                        this.lastLocalOfferSdp &&
                        sdp === this.lastLocalOfferSdp
                    ) {
                        this.dbg.p('skip offer: echo of own local offer')
                        return
                    }

                    if (sdp && sdp === this.lastHandledOfferSdp) {
                        this.dbg.p('skip offer (same sdp handled)')
                        return
                    }

                    const collision =
                        this.makingOffer || (this.pc && this.pc.signalingState !== 'stable')
                    if (collision) {
                        if (!this.polite) {
                            this.dbg.p('glare → ignore (impolite)')
                            return
                        }
                        this.dbg.p('glare → rollback')
                        try {
                            await this.pc?.setLocalDescription({ type: 'rollback' } as any)
                        } catch (e) {
                            this.dbg.pe('rollback fail', e)
                        }
                    }

                    this.phase = 'negotiating'
                    this.emitDebug('SRD(offer) start')

                    try {
                        await this.pc?.setRemoteDescription(desc)
                    } catch (e) {
                        this.dbg.pe(`SRD FAIL type=offer sdp=${sdpHash(sdp)}`, e)
                        throw e
                    }
                    this.remoteDescSet = true
                    this.lastHandledOfferSdp = sdp
                    this.dbg.p('SRD(offer) done, drain ICE', { pending: this.pendingIce.length })
                    this.emitDebug('SRD(offer) done')

                    while (this.pendingIce.length) {
                        const c = this.pendingIce.shift()!
                        try {
                            await this.pc?.addIceCandidate(c)
                        } catch (e) {
                            this.onError(
                                this.raiseError(
                                    e,
                                    RTCErrorCode.SIGNALING_FAILED,
                                    'signaling',
                                    true,
                                    undefined,
                                    false,
                                ),
                            )
                        }
                    }

                    if (this.pc?.signalingState !== 'have-remote-offer') {
                        this.dbg.p('skip answer: state!=' + this.pc?.signalingState)
                        return
                    }
                    if (this.answering) {
                        this.dbg.p('skip answer: already answering')
                        return
                    }
                    this.answering = true

                    const answer = await this.pc.createAnswer()
                    this.dbg.p('created answer', { sdp: sdpHash(answer.sdp) })
                    this.dbg.p('SLD(answer) start')
                    await this.pc.setLocalDescription(answer)
                    this.dbg.p('SLD(answer) done, publish')
                    const epochChanged = await this.refreshSignalingEpoch()
                    if (epochChanged) {
                        this.dbg.p('skip answer publish after epoch sync')
                        return
                    }
                    await this.streams.setAnswer({ ...(answer as AnswerSDP), epoch: this.signalingEpoch })
                    this.dbg.p('answer published')
                } catch (e) {
                    this.onError(
                        this.raiseError(e, RTCErrorCode.SIGNALING_FAILED, 'negotiation', true, undefined, false),
                    )
                } finally {
                    this.answering = false
                }
            }),
        )

        // --- Rx: входящие answer ---
        this.rxSubs.push(
            this.streams.answer$.subscribe(async (answer) => {
                if (!this.acceptEpoch((answer as any).epoch)) return
                const desc = new RTCSessionDescription(answer)
                const sdp = desc.sdp ?? null
                this.dbg.p('onAnswer()', {
                    type: desc.type,
                    sdp: sdpHash(sdp),
                    sig: this?.pc?.signalingState,
                })
                this.emitDebug('onAnswer')

                if (sdp && sdp === this.lastSeenAnswerSdp) {
                    this.dbg.p('skip answer: already seen')
                    return
                }
                this.lastSeenAnswerSdp = sdp

                try {
                    if (desc.type !== 'answer') return
                    if (sdp && sdp === this.lastHandledAnswerSdp) {
                        this.dbg.p('skip answer (same sdp handled)')
                        return
                    }
                    if (this.remoteDescSet) {
                        this.dbg.p('skip answer: remote already set')
                        return
                    }
                    if (!this.pc || this.pc.signalingState !== 'have-local-offer') {
                        this.dbg.p(
                            'skip answer: not waiting (state=' +
                            (this.pc?.signalingState ?? 'no-pc') +
                            ')',
                        )
                        return
                    }

                    this.dbg.p('SRD(answer) start')
                    try {
                        await this.pc.setRemoteDescription(desc)
                    } catch (e) {
                        this.dbg.pe(`SRD FAIL type=answer sdp=${sdpHash(sdp)}`, e)
                        throw e
                    }
                    this.lastHandledAnswerSdp = sdp
                    this.remoteDescSet = true
                    this.dbg.p('SRD(answer) done, drain ICE', { pending: this.pendingIce.length })
                    this.emitDebug('SRD(answer) done')

                    while (this.pendingIce.length) {
                        const c = this.pendingIce.shift()!
                        try {
                            await this.pc.addIceCandidate(c)
                        } catch (e) {
                            this.onError(
                                this.raiseError(
                                    e,
                                    RTCErrorCode.SIGNALING_FAILED,
                                    'signaling',
                                    true,
                                    undefined,
                                    false,
                                ),
                            )
                        }
                    }
                } catch (e) {
                    this.onError(
                        this.raiseError(e, RTCErrorCode.SIGNALING_FAILED, 'negotiation', true, undefined, false),
                    )
                }
            }),
        )
    }

    async sendFast(text: string) {
        if (this.dcFast && this.dcFast.readyState === 'open') {
            await this.backpressure(this.dcFast, this.fastBALow)
            this.dcFast.send(text)
            return
        }
        this.fastQueue.push(text)
        const ch = await this.waitChannelReady(false)
        await this.backpressure(ch, this.fastBALow)
        this.flushQueue(ch, this.fastQueue)
    }

    async sendReliable(text: string) {
        if (this.dcReliable && this.dcReliable.readyState === 'open') {
            await this.backpressure(this.dcReliable, this.reliableBALow)
            this.dcReliable.send(text)
            return
        }
        this.reliableQueue.push(text)
        const ch = await this.waitChannelReady(true)
        await this.backpressure(ch, this.reliableBALow)
        this.flushQueue(ch, this.reliableQueue)
    }

    async reconnectSoft(): Promise<void> {
        if (!this.roomId) {
            throw this.raiseError(
                new Error('Room not selected'),
                RTCErrorCode.ROOM_NOT_SELECTED,
                'reconnect',
                false,
            )
        }
        if (!this?.pc) return
        if (this.makingOffer || this.pc.signalingState !== 'stable') {
            this.dbg.p('reconnectSoft skipped (makingOffer or !stable)')
            return
        }
        this.phase = 'soft-reconnect'
        this.emitDebug('soft-reconnect')
        try {
            const offer = await this.pc.createOffer({ iceRestart: true })
            this.lastLocalOfferSdp = offer.sdp ?? null
            this.dbg.p('SLD(offer,iceRestart) start', { sdp: sdpHash(offer.sdp) })
            await this.pc.setLocalDescription(offer)
            const epochChanged = await this.refreshSignalingEpoch()
            if (epochChanged) {
                this.dbg.p('skip offer(iceRestart) publish after epoch sync')
                return
            }
            await this.streams.setOffer({ ...(offer as OfferSDP), epoch: this.signalingEpoch })
            this.dbg.p('offer(iceRestart) published')
        } catch (e) {
            throw this.raiseError(
                e,
                RTCErrorCode.SIGNALING_FAILED,
                'reconnect',
                true,
                'reconnectSoft failed',
            )
        }
    }

    async reconnectHard(opts: { awaitReadyMs?: number } = {}) {
        if (!this.roomId) {
            throw this.raiseError(
                new Error('Room not selected'),
                RTCErrorCode.ROOM_NOT_SELECTED,
                'reconnect',
                false,
            )
        }
        this.phase = 'hard-reconnect'
        this.emitDebug('hard-reconnect start')

        this.cleanupPeerOnly()

        this.lastHandledOfferSdp = null
        this.lastHandledAnswerSdp = null
        this.lastSeenOfferSdp = null
        this.lastSeenAnswerSdp = null
        this.lastLocalOfferSdp = null
        this.answering = false
        this.remoteDescSet = false
        this.pendingIce.length = 0

        this.initPeer()
        this.emitDebug('hard-reconnect initPeer')

        const waitMs = opts.awaitReadyMs ?? 15000
        await this.waitReady({ timeoutMs: waitMs })
        this.dbg.p('reconnectHard done')
        this.phase = 'connected'
        this.emitDebug('hard-reconnect done')
    }

    async hangup(): Promise<void> {
        this.phase = 'closing'
        this.emitDebug('hangup')
        this.clearRecoveryTimers()

        // Rx-подписки
        for (const s of this.rxSubs.splice(0)) {
            try {
                s.unsubscribe()
            } catch {}
        }

        // старые подписки (на всякий случай, если где-то добавите)
        this.unsubscribes.forEach((u) => {
            try {
                u()
            } catch {}
        })
        this.unsubscribes = []

        this.cleanupPeerOnly()
        this.connectedOrSubbed = false
        this.phase = 'idle'
        this.emitDebug('hangup done')
    }

    async endRoom(): Promise<void> {
        this.dbg.p('endRoom')
        await this.hangup()
        try {
            await this.signalDb.endRoom()
        } catch (e) {
            throw this.raiseError(e, RTCErrorCode.DB_UNAVAILABLE, 'room', true, 'endRoom failed')
        }
        this.roomId = null
        this.emitDebug('endRoom')
    }

    get currentRoomId() {
        return this.roomId
    }

    setMessageHandler(cb: (t: string, meta: { reliable: boolean }) => void): Unsub {
        this.onMessage = cb
        return () => {
            this.onMessage = () => {}
        }
    }
    setConnectionStateHandler(cb: (s: RTCPeerConnectionState) => void): Unsub {
        this.onConnectionStateChange = cb
        return () => {
            this.onConnectionStateChange = () => {}
        }
    }
    setFastOpenHandler(cb: () => void): Unsub {
        this.onFastOpen = cb
        return () => {
            this.onFastOpen = () => {}
        }
    }
    setFastCloseHandler(cb: () => void): Unsub {
        this.onFastClose = cb
        return () => {
            this.onFastClose = () => {}
        }
    }
    setReliableOpenHandler(cb: () => void): Unsub {
        this.onReliableOpen = cb
        return () => {
            this.onReliableOpen = () => {}
        }
    }
    setReliableCloseHandler(cb: () => void): Unsub {
        this.onReliableClose = cb
        return () => {
            this.onReliableClose = () => {}
        }
    }
    setErrorHandler(cb: (e: RTCError) => void): Unsub {
        this.onError = (e) => {
            this.lastErrorText = `${e.code}: ${e.message}`
            cb(e)
            this.emitDebug('error')
        }
        return () => {
            this.onError = (e) => console.error('[RTCSignaler]', e)
        }
    }
    setDebugHandler(cb: (d: DebugState) => void): Unsub {
        this.onDebug = cb
        this.emitDebug('attach-debug')
        return () => {
            this.onDebug = () => {}
        }
    }

    // ————————————————————————————————————————————————————————————————
    // Internals
    // ————————————————————————————————————————————————————————————————

    private initPeer() {
        this.dbg.p('initPeer()')
        this.pc = new RTCPeerConnection(this.rtcConfig)

        this.remoteDescSet = false
        this.pendingIce.length = 0
        this.emitDebug('pc-created')

        this.pc.addEventListener('signalingstatechange', () => {
            this.dbg.p('signalingstatechange')
            this.emitDebug('signalingstatechange')
        })
        this.pc.addEventListener('iceconnectionstatechange', () => {
            this.dbg.p('ice=' + this.pc!.iceConnectionState)
            const s = this?.pc!.iceConnectionState
            this.emitDebug('ice=' + s)
            if (!this.roomId) return
            if (s === 'connected') {
                this.phase = 'connected'
                this.softRetries = 0
                this.hardRetries = 0
                this.softDelayMs = 250
                this.hardDelayMs = 6000
                this.clearRecoveryTimers()
                this.emitDebug('connected')
            }
            if (this.role === 'caller' && s === 'disconnected') this.scheduleSoftThenMaybeHard()
            if (this.role === 'caller' && (s === 'failed' || s === 'closed')) this.tryHardNow()
        })
        this.pc.addEventListener('connectionstatechange', () => {
            const st = this.pc!.connectionState
            this.dbg.p('connection=' + st)
            this.onConnectionStateChange(st)
            this.emitDebug('connection=' + st)
            if (!this.roomId) return
            if (st === 'connected') {
                this.phase = 'connected'
                this.softRetries = 0
                this.hardRetries = 0
                this.softDelayMs = 250
                this.hardDelayMs = 6000
                this.clearRecoveryTimers()
                this.emitDebug('connected')
            }
            if (this.role === 'caller' && st === 'disconnected') this.scheduleSoftThenMaybeHard()
            if (this.role === 'caller' && (st === 'failed' || st === 'closed')) this.tryHardNow()
        })

        if (this.role === 'caller') {
            this.dcFast = this.pc.createDataChannel(this.fastLabel, this.fastInit)
            this.setupChannel(this.dcFast, false)

            this.dcReliable = this.pc.createDataChannel(this.reliableLabel, this.reliableInit)
            this.setupChannel(this.dcReliable, true)
        } else {
            this.pc.ondatachannel = (ev) => {
                const ch = ev.channel
                const rel = ch.label === this.reliableLabel
                if (rel) this.dcReliable = ch
                else this.dcFast = ch
                this.setupChannel(ch, rel)
                if (ch.readyState === 'open') {
                    this.resolveChannelWaiters(ch, rel)
                    if (rel) this.flushQueue(ch, this.reliableQueue)
                    else this.flushQueue(ch, this.fastQueue)
                    this.emitDebug('dc-early-open')
                }
            }
        }

        this.pc.onicecandidate = async (ev) => {
            if (!ev.candidate) return
            try {
                // Передаём "как есть" RTCIceCandidate — адаптер сам приведёт к init перед записью
                const ice: RTCIceCandidate = ev.candidate
                if (this.role === 'caller') await this.streams.addCallerIceCandidate(ice)
                else await this.streams.addCalleeIceCandidate(ice)
            } catch (e) {
                this.onError(
                    this.raiseError(e, RTCErrorCode.DB_UNAVAILABLE, 'signaling', true, undefined, false),
                )
            }
        }

        this.pc.onnegotiationneeded = async () => {
            if (!this.pc) return
            if (this.makingOffer || this.pc.signalingState !== 'stable') {
                this.dbg.p('onnegotiationneeded skipped (makingOffer or !stable)')
                return
            }
            this.phase = 'negotiating'
            this.emitDebug('negotiationneeded')

            try {
                this.makingOffer = true
                const offer = await this.pc.createOffer()
                this.lastLocalOfferSdp = offer.sdp ?? null
                this.dbg.p('created offer', { sdp: sdpHash(offer.sdp) })
                this.dbg.p('SLD(offer) start')
                await this.pc.setLocalDescription(offer)
                const epochChanged = await this.refreshSignalingEpoch()
                if (epochChanged) {
                    this.dbg.p('skip offer publish after epoch sync')
                    return
                }
                await this.streams.setOffer({ ...(offer as OfferSDP), epoch: this.signalingEpoch })
                this.dbg.p('offer published')
            } catch (e) {
                this.dbg.pe('negotiation error', e)
                this.onError(
                    this.raiseError(e, RTCErrorCode.SIGNALING_FAILED, 'negotiation', true, undefined, false),
                )
            } finally {
                this.makingOffer = false
                this.emitDebug('negotiation-done')
            }
        }
    }

    private setupChannel(ch: RTCDataChannel, reliable: boolean) {
        const ownerPc = this.pc
        try {
            ch.bufferedAmountLowThreshold = reliable ? this.reliableBALow : this.fastBALow
        } catch {}
        ch.onopen = () => {
            if (reliable) {
                this.flushQueue(ch, this.reliableQueue)
                this.onReliableOpen()
            } else {
                this.flushQueue(ch, this.fastQueue)
                this.onFastOpen()
            }
            this.resolveChannelWaiters(ch, reliable)
            this.emitDebug(`dc-open:${ch.label}`)
        }
        ch.onclose = () => {
            this.dbg.p(`onclose (${ch.label})`)

            // Игнорируем close от "старых" каналов после смены RTCPeerConnection.
            if (!ownerPc || this.pc !== ownerPc) {
                this.emitDebug(`dc-close-stale:${ch.label}`)
                return
            }
            if (ch.label === this.fastLabel) this.dcFast = undefined
            if (ch.label === this.reliableLabel) this.dcReliable = undefined

            if (this.isActive()) {
                const ice = this.pc?.iceConnectionState
                const conn = this.pc?.connectionState
                const unhealthy =
                    ice === 'disconnected' ||
                    ice === 'failed' ||
                    ice === 'closed' ||
                    conn === 'disconnected' ||
                    conn === 'failed' ||
                    conn === 'closed'
                if (unhealthy) this.scheduleSoftThenMaybeHard()
            }
            if (reliable) this.onReliableClose()
            else this.onFastClose()
            this.emitDebug(`dc-close:${ch.label}`)
        }
        ch.onmessage = (ev) => {
            const text = typeof ev.data === 'string' ? ev.data : String(ev.data)
            this.onMessage(text, { reliable })
        }
    }

    private waitChannelReady(reliable: boolean): Promise<RTCDataChannel> {
        const existing = reliable ? this.dcReliable : this.dcFast
        if (existing && existing.readyState === 'open') return Promise.resolve(existing)
        return new Promise<RTCDataChannel>((res) => {
            const arr = reliable ? this.reliableOpenWaiters : this.fastOpenWaiters
            arr.push(res)
            this.emitDebug('waitChannelReady')
        })
    }

    private resolveChannelWaiters(ch: RTCDataChannel, reliable: boolean) {
        const arr = reliable ? this.reliableOpenWaiters : this.fastOpenWaiters
        if (!arr.length) return
        const cbs = arr.splice(0, arr.length)
        cbs.forEach((cb) => {
            try {
                cb(ch)
            } catch {}
        })
    }

    private flushQueue(ch: RTCDataChannel, queue: string[]) {
        if (ch.readyState !== 'open' || !queue.length) return
        for (const msg of queue.splice(0, queue.length)) ch.send(msg)
    }

    private async backpressure(dc: RTCDataChannel, low: number) {
        if (dc.bufferedAmount > low) {
            await new Promise<void>((res) => {
                const h = () => {
                    dc.removeEventListener('bufferedamountlow', h)
                    res()
                }
                dc.addEventListener('bufferedamountlow', h, { once: true })
            })
        }
    }

    async waitReady(opts: { timeoutMs?: number } = {}) {
        const timeoutMs = opts.timeoutMs ?? 15000
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const s = this.inspect()
            if (
                s.pcState === 'connected' &&
                s.fast?.state === 'open' &&
                s.reliable?.state === 'open'
            )
                return
            await sleep(100)
        }
        throw this.raiseError(
            new Error('waitReady timeout'),
            RTCErrorCode.WAIT_READY_TIMEOUT,
            'transport',
            true,
            'waitReady timeout',
            false,
            { inspect: this.inspect(), timeoutMs },
        )
    }

    inspect() {
        return {
            pcState: this.pc?.connectionState ?? 'none',
            iceState: this.pc?.iceConnectionState ?? 'none',
            signalingState: this.pc?.signalingState ?? 'none',
            fast: this.dcFast
                ? {
                    label: this.dcFast.label,
                    state: this.dcFast.readyState,
                    ba: this.dcFast.bufferedAmount,
                }
                : null,
            reliable: this.dcReliable
                ? {
                    label: this.dcReliable.label,
                    state: this.dcReliable.readyState,
                    ba: this.dcReliable.bufferedAmount,
                }
                : null,
        }
    }

    private cleanupPeerOnly() {
        this.dbg.p('cleanupPeerOnly')
        try {
            this.dcFast?.close()
        } catch {}
        try {
            this.dcReliable?.close()
        } catch {}
        this.dcFast = undefined
        this.dcReliable = undefined
        try {
            this.pc?.close()
        } catch {}
        this.pc = undefined
        this.emitDebug('cleanupPeerOnly')
    }

    private isActive() {
        return !!this.pc && !!this.roomId
    }

    private clearRecoveryTimers() {
        if (this.softTimer) {
            clearTimeout(this.softTimer as unknown as number)
            this.softTimer = undefined
        }
        if (this.hardTimer) {
            clearTimeout(this.hardTimer as unknown as number)
            this.hardTimer = undefined
        }
        this.emitDebug('clearTimers')
    }

    private scheduleSoftThenMaybeHard() {
        if (!this.roomId || this.phase === 'closing' || this.phase === 'idle') return
        if (!this.pc || this.pc.signalingState === 'closed') return
        this.clearRecoveryTimers()
        this.upkeepRecoveryBackoff()
        this.phase = 'soft-reconnect'
        const softIn = this.softDelayMs
        const hardIn = this.hardDelayMs

        this.softTimer = setTimeout(() => {
            this.softRetries++
            this.reconnectSoft().catch(() => {})
            // экспоненциальный бэкофф до 2.5с
            this.softDelayMs = Math.min(this.softDelayMs * 2, 2500)
            this.emitDebug('soft-reconnect fire')
        }, softIn) as unknown as number

        this.hardTimer = setTimeout(() => {
            this.tryHardNow().catch(() => {})
            // экспоненциальный бэкофф до 10с
            this.hardRetries++
            this.hardDelayMs = Math.min(this.hardDelayMs * 2, 30000)
            this.emitDebug('hard-reconnect fire')
        }, hardIn) as unknown as number

        this.emitDebug('schedule reconnects')
    }

    private upkeepRecoveryBackoff() {
        // Можно тонко подстроить стратегию бэкоффа/сброса здесь при нужных событиях
    }

    private async tryHardNow() {
        if (!this.roomId || this.phase === 'closing' || this.phase === 'idle') return
        this.clearRecoveryTimers()
        try {
            await this.reconnectHard({ awaitReadyMs: 15000 })
        } catch (e) {
            this.dbg.pe('tryHardNow failed', e)
            this.onError(
                this.raiseError(e, RTCErrorCode.SIGNALING_FAILED, 'reconnect', true, undefined, false),
            )
        }
    }

    private acceptEpoch(epochLike: unknown): boolean {
        const epoch =
            typeof epochLike === 'number' && Number.isFinite(epochLike) ? epochLike : this.signalingEpoch
        if (epoch < this.signalingEpoch) return false
        if (epoch > this.signalingEpoch) {
            this.signalingEpoch = epoch
            this.lastHandledOfferSdp = null
            this.lastHandledAnswerSdp = null
            this.lastSeenOfferSdp = null
            this.lastSeenAnswerSdp = null
            this.lastLocalOfferSdp = null
            this.answering = false
            this.remoteDescSet = false
            this.pendingIce.length = 0
            if (this.pc) {
                this.cleanupPeerOnly()
                this.initPeer()
                this.emitDebug('epoch-advance')
            }
        }
        return true
    }

    private async refreshSignalingEpoch(): Promise<boolean> {
        const before = this.signalingEpoch
        try {
            const room = await this.signalDb.getRoom()
            this.acceptEpoch(room?.epoch)
        } catch {
            // best-effort sync
        }
        return this.signalingEpoch !== before
    }

    private raiseError(
        err: unknown,
        fallbackCode: RTCErrorCode,
        phase: RTCErrorPhase,
        retriable: boolean,
        message?: string,
        rethrow = true,
        details?: Record<string, unknown>,
    ): RTCError {
        const wrapped = toRTCError(err, { fallbackCode, phase, retriable, message, details })
        if (rethrow) return wrapped
        return wrapped
    }

    private emitDebug(lastEvent?: string) {
        const st: DebugState = {
            ts: Date.now(),
            roomId: this.roomId,
            role: this.role,
            phase: this.phase,
            makingOffer: this.makingOffer,
            polite: this.polite,
            pcState: this.pc?.connectionState ?? 'none',
            iceState: this.pc?.iceConnectionState ?? 'none',
            signalingState: this.pc?.signalingState ?? 'none',
            fast: this.dcFast
                ? { state: this.dcFast.readyState, ba: this.dcFast.bufferedAmount }
                : undefined,
            reliable: this.dcReliable
                ? { state: this.dcReliable.readyState, ba: this.dcReliable.bufferedAmount }
                : undefined,
            pendingIce: this.pendingIce.length,
            retries: { soft: this.softRetries, hard: this.hardRetries },
            timers: {
                softPending: !!this.softTimer,
                hardPending: !!this.hardTimer,
                softInMs: this.softDelayMs,
                hardInMs: this.hardDelayMs,
            },
            lastEvent,
            lastError: this.lastErrorText,
        }
        this.onDebug(st)
    }
}
