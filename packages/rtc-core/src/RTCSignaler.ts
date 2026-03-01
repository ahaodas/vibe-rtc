// RTCSignaler.ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import type { Subscription } from 'rxjs'
import {
    type CandidateType,
    type ConnectionStrategy,
    getCandidateType,
    type IcePhase,
    shouldAcceptCandidate,
    shouldSendCandidate,
} from './connection-strategy'
import { RTCError, RTCErrorCode, type RTCErrorPhase, toRTCError } from './errors'
import { DEFAULT_ICE_SERVERS, withDefaultIceServers } from './ice-config'
import { createSignalStreams } from './signal-rx'
import type { AnswerSDP, OfferSDP, SignalDB } from './types'

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
    enabled: boolean
}) {
    const p = (msg: string, extra?: any) => {
        if (!ctx.enabled) return
        const pc = ctx.pc()
        const tag = `[${++__seq}|${now()}|${ctx.role}|${ctx.roomId() ?? 'no-room'}]`
        const sig = pc ? pc.signalingState : 'no-pc'
        const ice = pc ? pc.iceConnectionState : 'no-pc'
        const ls = pc?.localDescription?.type ?? '∅'
        console.log(`${tag} ${msg}  [sig=${sig} ice=${ice} loc=${ls}]`, extra ?? '')
    }
    const pe = (msg: string, e: unknown) => {
        if (!ctx.enabled) return
        const pc = ctx.pc()
        const tag = `[${++__seq}|${now()}|${ctx.role}|${ctx.roomId() ?? 'no-room'}]`
        const sig = pc ? pc.signalingState : 'no-pc'
        console.error(`${tag} ${msg} [sig=${sig}]`, e)
    }
    return { p, pe }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
const CONNECTING_WATCHDOG_MS_LAN = 6500
const CONNECTING_WATCHDOG_MS_STUN = 25_000
const MAX_STUN_WATCHDOG_RECONNECTS = 2

type Unsub = () => void
export type Role = 'caller' | 'callee'

export interface RTCSignalerOptions {
    debug?: boolean
    rtcConfiguration?: RTCConfiguration
    fastLabel?: string
    reliableLabel?: string
    fastInit?: RTCDataChannelInit
    reliableInit?: RTCDataChannelInit
    fastBufferedAmountLowThreshold?: number
    reliableBufferedAmountLowThreshold?: number
    waitReadyTimeoutMs?: number
    connectionStrategy?: ConnectionStrategy
    lanFirstTimeoutMs?: number
    stunServers?: RTCIceServer[]
    onMessage?: (text: string, meta: { reliable: boolean }) => void
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void
    onFastOpen?: () => void
    onFastClose?: () => void
    onReliableOpen?: () => void
    onReliableClose?: () => void
    onError?: (err: RTCError) => void
    onDebug?: (state: DebugState) => void // NEW: hook for UI
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
    connectionStrategy: ConnectionStrategy
    icePhase: IcePhase
    pcGeneration: number
    candidateStats: {
        localSeen: Record<CandidateType, number>
        localSent: Record<CandidateType, number>
        localDropped: Record<CandidateType, number>
        remoteSeen: Record<CandidateType, number>
        remoteAccepted: Record<CandidateType, number>
        remoteDropped: Record<CandidateType, number>
    }
    selectedPath?: CandidateType
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
    private unsubscribes: Unsub[] = [] // kept for compatibility, but unused with Rx
    private connectedOrSubbed = false

    private readonly baseRtcConfig: RTCConfiguration
    private readonly defaultStunServers: RTCIceServer[]
    private readonly fastLabel: string
    private readonly reliableLabel: string
    private readonly fastInit: RTCDataChannelInit
    private readonly reliableInit: RTCDataChannelInit
    private readonly fastBALow: number
    private readonly reliableBALow: number
    private readonly defaultWaitReadyTimeoutMs: number

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
    private connectingWatchdogTimer?: number
    private connectingWatchdogGeneration?: number
    private stunWatchdogReconnects = 0
    private softDelayMs = 250
    private hardDelayMs = 6000
    private softRetries = 0
    private hardRetries = 0

    private phase: Phase = 'idle'
    private lastErrorText: string | undefined
    private signalingEpoch = 0
    private remotePcGeneration: number | undefined
    private readonly connectionStrategy: ConnectionStrategy
    private readonly lanFirstTimeoutMs: number
    private icePhase: IcePhase
    private lanFirstTimer?: number
    private dcRecoveryTimer?: number
    private dcRecoveryGeneration?: number
    private pcGeneration = 0
    private controlledPeerRebuild = false
    private selectedPath: CandidateType | undefined
    private candidateStats = {
        localSeen: this.makeCandidateCountMap(),
        localSent: this.makeCandidateCountMap(),
        localDropped: this.makeCandidateCountMap(),
        remoteSeen: this.makeCandidateCountMap(),
        remoteAccepted: this.makeCandidateCountMap(),
        remoteDropped: this.makeCandidateCountMap(),
    }

    // --- New: RxJS wrapper over signaling + subscription list ---
    private streams
    private rxSubs: Subscription[] = []
    private readonly debugEnabled: boolean

    constructor(
        private readonly role: Role,
        private readonly signalDb: SignalDB,
        opts: RTCSignalerOptions = {},
    ) {
        const isTestEnv =
            // Vitest exposes this marker in test runtime.
            typeof (globalThis as any).__vitest_worker__ !== 'undefined' ||
            // Fallback for Node/Jest-like runners.
            (globalThis as any).process?.env?.NODE_ENV === 'test'
        this.debugEnabled = opts.debug ?? isTestEnv
        this.dbg = mkDbg({
            role: this.role,
            roomId: () => this.roomId,
            pc: () => this.pc,
            enabled: this.debugEnabled,
        })
        this.polite = role === 'callee'
        this.connectionStrategy = opts.connectionStrategy ?? 'LAN_FIRST'
        this.lanFirstTimeoutMs = opts.lanFirstTimeoutMs ?? 1800
        this.icePhase = this.connectionStrategy === 'LAN_FIRST' ? 'LAN' : 'STUN'
        this.baseRtcConfig = opts.rtcConfiguration ? { ...opts.rtcConfiguration } : {}
        this.defaultStunServers =
            opts.stunServers && opts.stunServers.length > 0
                ? opts.stunServers.map((server) => ({ ...server }))
                : this.baseRtcConfig.iceServers && this.baseRtcConfig.iceServers.length > 0
                  ? this.baseRtcConfig.iceServers.map((server) => ({ ...server }))
                  : DEFAULT_ICE_SERVERS.map((server) => ({ ...server }))

        this.fastLabel = opts.fastLabel ?? 'fast'
        this.reliableLabel = opts.reliableLabel ?? 'reliable'
        this.fastInit = { ordered: false, maxRetransmits: 0, ...(opts.fastInit ?? {}) }
        this.reliableInit = { ordered: true, ...(opts.reliableInit ?? {}) }
        this.fastBALow = opts.fastBufferedAmountLowThreshold ?? 64 * 1024
        this.reliableBALow = opts.reliableBufferedAmountLowThreshold ?? 256 * 1024
        this.defaultWaitReadyTimeoutMs = opts.waitReadyTimeoutMs ?? 15000

        this.onMessage = opts.onMessage ?? (() => {})
        this.onConnectionStateChange = opts.onConnectionStateChange ?? (() => {})
        this.onFastOpen = opts.onFastOpen ?? (() => {})
        this.onFastClose = opts.onFastClose ?? (() => {})
        this.onReliableOpen = opts.onReliableOpen ?? (() => {})
        this.onReliableClose = opts.onReliableClose ?? (() => {})
        this.onError = (e) => {
            this.lastErrorText = `${e.code}: ${e.message}`
            ;(
                opts.onError ??
                ((ee) => {
                    if (this.debugEnabled) console.error('[RTCSignaler]', ee)
                })
            )(e)
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
        try {
            const room = await this.signalDb.getRoom()
            if (!room) {
                throw this.raiseError(
                    new Error('Room not found'),
                    RTCErrorCode.ROOM_NOT_FOUND,
                    'room',
                    false,
                )
            }
        } catch (e) {
            if (e instanceof RTCError) throw e
            throw this.raiseError(e, RTCErrorCode.DB_UNAVAILABLE, 'room', true, 'connect failed')
        }
        if (this.connectedOrSubbed) {
            this.dbg.p('connect() skipped (already connected/subscribed)')
            return
        }
        this.connectedOrSubbed = true
        this.selectedPath = undefined
        this.remotePcGeneration = undefined
        this.stunWatchdogReconnects = 0
        this.candidateStats = {
            localSeen: this.makeCandidateCountMap(),
            localSent: this.makeCandidateCountMap(),
            localDropped: this.makeCandidateCountMap(),
            remoteSeen: this.makeCandidateCountMap(),
            remoteAccepted: this.makeCandidateCountMap(),
            remoteDropped: this.makeCandidateCountMap(),
        }
        this.icePhase = this.connectionStrategy === 'LAN_FIRST' ? 'LAN' : 'STUN'

        this.initPeer()
        this.emitDebug('initPeer')

        // --- Rx: subscriptions to remote ICE candidates ---
        const remoteIce$ =
            this.role === 'caller' ? this.streams.calleeIce$ : this.streams.callerIce$
        this.rxSubs.push(
            remoteIce$.subscribe(async (c) => {
                if (!this.acceptEpoch((c as any).epoch)) return
                const remoteGeneration =
                    typeof (c as any).pcGeneration === 'number'
                        ? (c as any).pcGeneration
                        : undefined
                if (
                    typeof remoteGeneration === 'number' &&
                    typeof this.remotePcGeneration === 'number' &&
                    remoteGeneration < this.remotePcGeneration
                ) {
                    this.dbg.p(
                        `remote ICE dropped stale generation=${remoteGeneration} currentRemote=${this.remotePcGeneration}`,
                    )
                    this.emitDebug('ice-remote-drop:stale-generation')
                    return
                }
                const candidateText = c.candidate || ''
                const candidateType = getCandidateType(candidateText)
                this.bumpCandidateCounter(this.candidateStats.remoteSeen, candidateType)
                if (
                    this.connectionStrategy === 'LAN_FIRST' &&
                    this.role === 'callee' &&
                    this.icePhase === 'LAN' &&
                    candidateType !== 'host'
                ) {
                    this.dbg.p(`LAN received non-host ICE (${candidateType}) -> fallback to STUN`)
                    this.transitionToStun('remote-candidate')
                }
                if (!shouldAcceptCandidate(this.icePhase, candidateText)) {
                    this.bumpCandidateCounter(this.candidateStats.remoteDropped, candidateType)
                    this.dbg.p(`remote ICE dropped type=${candidateType} phase=${this.icePhase}`)
                    this.emitDebug(`ice-remote-drop:${candidateType}`)
                    return
                }
                this.bumpCandidateCounter(this.candidateStats.remoteAccepted, candidateType)
                this.dbg.p(`remote ICE from ${this.role === 'caller' ? 'callee' : 'caller'}`, {
                    buffered: !this.remoteDescSet,
                    phase: this.icePhase,
                    type: candidateType,
                    cand: candidateText.slice(0, 42),
                })
                try {
                    if (!this.remoteDescSet) {
                        this.pendingIce.push(c)
                        return
                    }
                    if (!this.pc) return
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
            }),
        )

        // --- Rx: incoming offer ---
        this.rxSubs.push(
            this.streams.offer$.subscribe(async (offer) => {
                if (!this.acceptEpoch((offer as any).epoch)) return
                let localGeneration = this.pcGeneration
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

                    const remoteGeneration =
                        typeof (offer as any).pcGeneration === 'number'
                            ? (offer as any).pcGeneration
                            : undefined
                    this.maybeSyncCalleeToRemoteOfferGeneration(remoteGeneration)
                    localGeneration = this.pcGeneration
                    if (
                        typeof remoteGeneration === 'number' &&
                        typeof this.remotePcGeneration === 'number' &&
                        remoteGeneration < this.remotePcGeneration
                    ) {
                        this.dbg.p(
                            `skip offer: stale remote generation=${remoteGeneration} current=${this.remotePcGeneration}`,
                        )
                        return
                    }
                    if (typeof remoteGeneration === 'number')
                        this.remotePcGeneration = remoteGeneration

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

                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
                    try {
                        await this.pc.setRemoteDescription(desc)
                    } catch (e) {
                        this.dbg.pe(`SRD FAIL type=offer sdp=${sdpHash(sdp)}`, e)
                        throw e
                    }
                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
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

                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
                    const answer = await this.pc.createAnswer()
                    this.dbg.p('created answer', { sdp: sdpHash(answer.sdp) })
                    this.dbg.p('SLD(answer) start')
                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
                    await this.pc.setLocalDescription(answer)
                    this.dbg.p('SLD(answer) done, publish')
                    const epochChanged = await this.refreshSignalingEpoch()
                    if (epochChanged) {
                        this.dbg.p('skip answer publish after epoch sync')
                        return
                    }
                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
                    await this.streams.setAnswer({
                        ...(answer as AnswerSDP),
                        epoch: this.signalingEpoch,
                        pcGeneration: localGeneration,
                        forPcGeneration:
                            typeof remoteGeneration === 'number' ? remoteGeneration : undefined,
                    } as AnswerSDP)
                    this.dbg.p('answer published')
                } catch (e) {
                    this.onError(
                        this.raiseError(
                            e,
                            RTCErrorCode.SIGNALING_FAILED,
                            'negotiation',
                            true,
                            undefined,
                            false,
                        ),
                    )
                } finally {
                    this.answering = false
                }
            }),
        )

        // --- Rx: incoming answer ---
        this.rxSubs.push(
            this.streams.answer$.subscribe(async (answer) => {
                if (!this.acceptEpoch((answer as any).epoch)) return
                const localGeneration = this.pcGeneration
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
                    const forPcGeneration =
                        typeof (answer as any).forPcGeneration === 'number'
                            ? (answer as any).forPcGeneration
                            : undefined
                    if (
                        typeof forPcGeneration === 'number' &&
                        forPcGeneration !== localGeneration
                    ) {
                        this.dbg.p(
                            `skip answer: forPcGeneration=${forPcGeneration} current=${localGeneration}`,
                        )
                        this.emitDebug('answer-drop:forPcGeneration-mismatch')
                        return
                    }
                    const remoteGeneration =
                        typeof (answer as any).pcGeneration === 'number'
                            ? (answer as any).pcGeneration
                            : undefined
                    if (
                        typeof remoteGeneration === 'number' &&
                        typeof this.remotePcGeneration === 'number' &&
                        remoteGeneration < this.remotePcGeneration
                    ) {
                        this.dbg.p(
                            `skip answer: stale remote generation=${remoteGeneration} current=${this.remotePcGeneration}`,
                        )
                        return
                    }
                    if (typeof remoteGeneration === 'number')
                        this.remotePcGeneration = remoteGeneration

                    this.dbg.p('SRD(answer) start')
                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
                    try {
                        await this.pc.setRemoteDescription(desc)
                    } catch (e) {
                        this.dbg.pe(`SRD FAIL type=answer sdp=${sdpHash(sdp)}`, e)
                        throw e
                    }
                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
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
                        this.raiseError(
                            e,
                            RTCErrorCode.SIGNALING_FAILED,
                            'negotiation',
                            true,
                            undefined,
                            false,
                        ),
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
            await this.streams.setOffer({
                ...(offer as OfferSDP),
                epoch: this.signalingEpoch,
                pcGeneration: this.pcGeneration,
            } as OfferSDP)
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
        this.controlledPeerRebuild = true
        try {
            this.makingOffer = false
            this.resetNegotiationStateForPeerRebuild()
            this.cleanupPeerOnly()
            this.initPeer()
        } finally {
            this.controlledPeerRebuild = false
        }
        this.emitDebug('hard-reconnect initPeer')

        const waitMs = opts.awaitReadyMs ?? this.defaultWaitReadyTimeoutMs
        await this.waitReady({ timeoutMs: waitMs })
        this.dbg.p('reconnectHard done')
        this.phase = 'connected'
        this.emitDebug('hard-reconnect done')
    }

    async hangup(): Promise<void> {
        this.phase = 'closing'
        this.emitDebug('hangup')
        this.clearRecoveryTimers()
        this.clearLanFirstTimer()

        // Rx subscriptions
        for (const s of this.rxSubs.splice(0)) {
            try {
                s.unsubscribe()
            } catch {}
        }

        // legacy subscriptions (in case one gets added somewhere)
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

    private buildRtcConfigForPhase(phase: IcePhase): RTCConfiguration {
        if (phase === 'LAN') {
            return {
                ...this.baseRtcConfig,
                iceServers: [],
            }
        }
        return withDefaultIceServers(this.baseRtcConfig, this.defaultStunServers)
    }

    private isCurrentGeneration(generation: number): boolean {
        return this.pcGeneration === generation
    }

    private isConnectedState(): boolean {
        const connectionState = this.pc?.connectionState
        const iceState = this.pc?.iceConnectionState
        return (
            connectionState === 'connected' || iceState === 'connected' || iceState === 'completed'
        )
    }

    private areDataChannelsOpen(): boolean {
        return this.dcFast?.readyState === 'open' && this.dcReliable?.readyState === 'open'
    }

    private clearDcRecoveryTimer() {
        if (!this.dcRecoveryTimer) return
        clearTimeout(this.dcRecoveryTimer as unknown as number)
        this.dcRecoveryTimer = undefined
    }

    private clearConnectingWatchdogTimer() {
        if (!this.connectingWatchdogTimer) return
        clearTimeout(this.connectingWatchdogTimer as unknown as number)
        this.connectingWatchdogTimer = undefined
    }

    private scheduleCallerConnectingWatchdog(generation: number, reason: string) {
        if (this.role !== 'caller') return
        if (!this.roomId || !this.pc || this.phase === 'closing' || this.phase === 'idle') return
        if (!this.isCurrentGeneration(generation)) return
        if (this.isConnectedState() || this.areDataChannelsOpen()) {
            this.clearConnectingWatchdogTimer()
            this.connectingWatchdogGeneration = undefined
            return
        }
        if (this.connectingWatchdogGeneration === generation) return
        this.connectingWatchdogGeneration = generation
        this.clearConnectingWatchdogTimer()
        const watchdogTimeoutMs =
            this.icePhase === 'STUN' ? CONNECTING_WATCHDOG_MS_STUN : CONNECTING_WATCHDOG_MS_LAN
        this.dbg.p(`connecting watchdog armed (${reason}) in ${watchdogTimeoutMs}ms`)
        this.connectingWatchdogTimer = setTimeout(() => {
            void (async () => {
                this.connectingWatchdogTimer = undefined
                if (!this.roomId || !this.pc || this.phase === 'closing' || this.phase === 'idle')
                    return
                if (!this.isCurrentGeneration(generation)) return
                if (this.isConnectedState() || this.areDataChannelsOpen()) return
                await this.logIceDiagnostics(`watchdog:${reason}`, generation)
                if (
                    this.icePhase === 'STUN' &&
                    this.stunWatchdogReconnects >= MAX_STUN_WATCHDOG_RECONNECTS
                ) {
                    this.dbg.p(
                        `connecting watchdog reached STUN reconnect limit (${MAX_STUN_WATCHDOG_RECONNECTS}), no hard reconnect`,
                    )
                    this.emitDebug('connecting-watchdog:stun-max-reached')
                    return
                }
                if (this.icePhase === 'STUN') this.stunWatchdogReconnects += 1
                this.dbg.p(`connecting watchdog -> reconnectHard (${reason})`)
                this.emitDebug('connecting-watchdog:hard-reconnect')
                try {
                    await this.reconnectHard({ awaitReadyMs: this.defaultWaitReadyTimeoutMs })
                } catch (e) {
                    this.dbg.pe('connecting watchdog failed', e)
                } finally {
                    if (this.connectingWatchdogGeneration === generation) {
                        this.connectingWatchdogGeneration = undefined
                    }
                }
            })()
        }, watchdogTimeoutMs) as unknown as number
    }

    private scheduleCallerDcRecovery(generation: number, reason: string) {
        if (this.role !== 'caller') return
        if (!this.roomId || !this.pc || this.phase === 'closing' || this.phase === 'idle') return
        if (!this.isCurrentGeneration(generation)) return
        if (this.areDataChannelsOpen()) {
            this.clearDcRecoveryTimer()
            this.dcRecoveryGeneration = undefined
            return
        }
        if (this.dcRecoveryGeneration === generation) return
        this.dcRecoveryGeneration = generation
        this.clearDcRecoveryTimer()
        this.dcRecoveryTimer = setTimeout(() => {
            void (async () => {
                this.dcRecoveryTimer = undefined
                if (!this.roomId || !this.pc || this.phase === 'closing' || this.phase === 'idle')
                    return
                if (!this.isCurrentGeneration(generation)) return
                if (this.areDataChannelsOpen()) return
                if (this.makingOffer || this.pc.signalingState !== 'stable') {
                    this.dbg.p('dc recovery skipped (makingOffer or !stable)')
                    this.emitDebug('dc-recovery-skip')
                    return
                }
                this.dbg.p(`dc recovery -> reconnectSoft (${reason})`)
                this.emitDebug('dc-recovery:ice-restart')
                try {
                    await this.reconnectSoft()
                } catch (e) {
                    this.dbg.pe('dc recovery failed', e)
                }
            })()
        }, 1200) as unknown as number
    }

    private resetNegotiationStateForPeerRebuild() {
        this.lastHandledOfferSdp = null
        this.lastHandledAnswerSdp = null
        this.lastSeenOfferSdp = null
        this.lastSeenAnswerSdp = null
        this.lastLocalOfferSdp = null
        this.answering = false
        this.remoteDescSet = false
        this.remotePcGeneration = undefined
        this.pendingIce.length = 0
    }

    private transitionToStun(reason: 'timeout' | 'remote-offer-generation' | 'remote-candidate') {
        if (this.icePhase === 'STUN') return
        this.dbg.p(`LAN -> STUN transition (${reason})`)
        this.emitDebug(`phase-transition:LAN->STUN:${reason}`)
        this.icePhase = 'STUN'
        this.stunWatchdogReconnects = 0
        this.controlledPeerRebuild = true
        try {
            this.makingOffer = false
            this.answering = false
            this.resetNegotiationStateForPeerRebuild()
            this.clearLanFirstTimer()
            this.clearConnectingWatchdogTimer()
            this.connectingWatchdogGeneration = undefined
            this.cleanupPeerOnly()
            this.initPeer()
        } finally {
            this.controlledPeerRebuild = false
        }
        this.emitDebug('phase=STUN')
    }

    private maybeSyncCalleeToRemoteOfferGeneration(remoteGeneration: number | undefined) {
        if (this.role !== 'callee') return
        if (typeof remoteGeneration !== 'number') return
        if (remoteGeneration <= this.pcGeneration) return
        if (this.connectionStrategy === 'LAN_FIRST' && this.icePhase === 'LAN') {
            this.transitionToStun('remote-offer-generation')
            return
        }

        this.dbg.p(
            `remote offer generation=${remoteGeneration} ahead of local=${this.pcGeneration} -> rebuild callee peer`,
        )
        this.emitDebug('peer-rebuild:remote-offer-generation')

        this.controlledPeerRebuild = true
        try {
            this.makingOffer = false
            this.answering = false
            this.resetNegotiationStateForPeerRebuild()
            this.clearLanFirstTimer()
            this.clearConnectingWatchdogTimer()
            this.connectingWatchdogGeneration = undefined
            this.cleanupPeerOnly()
            this.initPeer()
        } finally {
            this.controlledPeerRebuild = false
        }
    }

    private async publishOfferIfStable(
        generation: number,
        source: 'onnegotiationneeded' | 'bootstrap',
    ) {
        if (!this.isCurrentGeneration(generation)) return
        if (!this.pc) return
        if (this.makingOffer || this.pc.signalingState !== 'stable') {
            this.dbg.p(`${source} skipped (makingOffer or !stable)`)
            return
        }
        this.phase = 'negotiating'
        this.emitDebug(source === 'bootstrap' ? 'negotiation-bootstrap' : 'negotiationneeded')

        try {
            this.makingOffer = true
            const offer = await this.pc.createOffer()
            if (!this.isCurrentGeneration(generation) || !this.pc) return
            this.lastLocalOfferSdp = offer.sdp ?? null
            this.dbg.p('created offer', { sdp: sdpHash(offer.sdp) })
            this.dbg.p('SLD(offer) start')
            await this.pc.setLocalDescription(offer)
            if (!this.isCurrentGeneration(generation) || !this.pc) return
            const epochChanged = await this.refreshSignalingEpoch()
            if (epochChanged) {
                this.dbg.p('skip offer publish after epoch sync')
                return
            }
            if (!this.isCurrentGeneration(generation) || !this.pc) return
            await this.streams.setOffer({
                ...(offer as OfferSDP),
                epoch: this.signalingEpoch,
                pcGeneration: generation,
            } as OfferSDP)
            this.dbg.p(source === 'bootstrap' ? 'offer published (bootstrap)' : 'offer published')
        } catch (e) {
            this.dbg.pe('negotiation error', e)
            this.onError(
                this.raiseError(
                    e,
                    RTCErrorCode.SIGNALING_FAILED,
                    'negotiation',
                    true,
                    undefined,
                    false,
                ),
            )
        } finally {
            this.makingOffer = false
            this.emitDebug('negotiation-done')
        }
    }

    private startLanFirstTimer(generation: number) {
        if (this.connectionStrategy !== 'LAN_FIRST') return
        if (this.role !== 'caller') {
            this.emitDebug('phase=LAN-passive')
            return
        }
        this.clearLanFirstTimer()
        this.lanFirstTimer = setTimeout(() => {
            if (!this.isCurrentGeneration(generation)) return
            if (!this.roomId || !this.pc || this.phase === 'closing' || this.phase === 'idle')
                return
            if (this.icePhase !== 'LAN' || this.isConnectedState()) return
            this.dbg.p(`LAN timeout -> fallback to STUN in ${this.lanFirstTimeoutMs}ms`)
            this.transitionToStun('timeout')
        }, this.lanFirstTimeoutMs) as unknown as number
        this.emitDebug('phase=LAN')
    }

    private clearLanFirstTimer() {
        if (!this.lanFirstTimer) return
        clearTimeout(this.lanFirstTimer as unknown as number)
        this.lanFirstTimer = undefined
    }

    private makeCandidateCountMap(): Record<CandidateType, number> {
        return { host: 0, srflx: 0, relay: 0, unknown: 0 }
    }

    private bumpCandidateCounter(counter: Record<CandidateType, number>, type: CandidateType) {
        counter[type] = (counter[type] ?? 0) + 1
    }

    private captureSelectedPath() {
        if (this.selectedPath) return
        if (this.icePhase === 'LAN') {
            this.selectedPath = 'host'
            this.dbg.p('selected path inferred host (LAN phase)')
            this.emitDebug('selected-path:host')
            return
        }
        if (
            this.candidateStats.remoteAccepted.srflx > 0 ||
            this.candidateStats.localSent.srflx > 0
        ) {
            this.selectedPath = 'srflx'
        } else if (
            this.candidateStats.remoteAccepted.relay > 0 ||
            this.candidateStats.localSent.relay > 0
        ) {
            this.selectedPath = 'relay'
        } else if (
            this.candidateStats.remoteAccepted.host > 0 ||
            this.candidateStats.localSent.host > 0
        ) {
            this.selectedPath = 'host'
        } else {
            this.selectedPath = 'unknown'
        }
        this.dbg.p(`selected path inferred ${this.selectedPath}`)
        this.emitDebug(`selected-path:${this.selectedPath}`)
    }

    private initPeer() {
        this.dbg.p('initPeer()')
        this.clearDcRecoveryTimer()
        this.dcRecoveryGeneration = undefined
        this.clearConnectingWatchdogTimer()
        this.connectingWatchdogGeneration = undefined
        const generation = ++this.pcGeneration
        const rtcConfig = this.buildRtcConfigForPhase(this.icePhase)
        this.pc = new RTCPeerConnection(rtcConfig)
        this.dbg.p(`pc created generation=${generation} phase=${this.icePhase}`, {
            iceServers: rtcConfig.iceServers ?? [],
        })

        this.remoteDescSet = false
        this.pendingIce.length = 0
        this.emitDebug('pc-created')
        if (this.icePhase === 'LAN') this.startLanFirstTimer(generation)
        else this.clearLanFirstTimer()

        this.pc.addEventListener('signalingstatechange', () => {
            if (!this.isCurrentGeneration(generation)) return
            this.dbg.p('signalingstatechange')
            this.emitDebug('signalingstatechange')
        })
        this.pc.addEventListener('iceconnectionstatechange', () => {
            if (!this.isCurrentGeneration(generation)) return
            this.dbg.p(`ice=${this.pc?.iceConnectionState}`)
            const s = this.pc?.iceConnectionState
            this.emitDebug(`ice=${s}`)
            if (!this.roomId) return
            if (s === 'connected') {
                this.phase = 'connected'
                this.softRetries = 0
                this.hardRetries = 0
                this.softDelayMs = 250
                this.hardDelayMs = 6000
                this.stunWatchdogReconnects = 0
                this.clearRecoveryTimers()
                this.clearLanFirstTimer()
                this.captureSelectedPath()
                this.scheduleCallerDcRecovery(generation, 'ice=connected')
                this.clearConnectingWatchdogTimer()
                this.connectingWatchdogGeneration = undefined
                this.emitDebug('connected')
            }
            if (s === 'completed') {
                this.clearLanFirstTimer()
                this.captureSelectedPath()
                this.scheduleCallerDcRecovery(generation, 'ice=completed')
                this.clearConnectingWatchdogTimer()
                this.connectingWatchdogGeneration = undefined
                this.emitDebug('ice=completed')
            }
            if (s === 'checking') this.scheduleCallerConnectingWatchdog(generation, 'ice=checking')
            if (s === 'failed') void this.logIceDiagnostics('ice=failed', generation)
            if (this.controlledPeerRebuild) return
            if (this.role === 'caller' && s === 'disconnected') this.scheduleSoftThenMaybeHard()
            if (this.role === 'caller' && (s === 'failed' || s === 'closed')) this.tryHardNow()
        })
        this.pc.addEventListener('icecandidateerror', (event: any) => {
            if (!this.isCurrentGeneration(generation)) return
            this.dbg.p('icecandidateerror', {
                address: event?.address ?? null,
                port: event?.port ?? null,
                url: event?.url ?? null,
                errorCode: event?.errorCode ?? null,
                errorText: event?.errorText ?? null,
            })
            this.emitDebug(`ice-candidate-error:${event?.errorCode ?? 'unknown'}`)
        })
        this.pc.addEventListener('connectionstatechange', () => {
            if (!this.isCurrentGeneration(generation)) return
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
                this.stunWatchdogReconnects = 0
                this.clearRecoveryTimers()
                this.clearLanFirstTimer()
                this.captureSelectedPath()
                this.scheduleCallerDcRecovery(generation, 'connection=connected')
                this.clearConnectingWatchdogTimer()
                this.connectingWatchdogGeneration = undefined
                this.emitDebug('connected')
            }
            if (st === 'connecting')
                this.scheduleCallerConnectingWatchdog(generation, 'connection=connecting')
            if (st === 'failed') void this.logIceDiagnostics('connection=failed', generation)
            if (this.controlledPeerRebuild) return
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
            if (!this.isCurrentGeneration(generation)) return
            if (!ev.candidate) return
            const candidateText = ev.candidate.candidate || ''
            const candidateType = getCandidateType(candidateText)
            this.bumpCandidateCounter(this.candidateStats.localSeen, candidateType)
            if (!shouldSendCandidate(this.icePhase, candidateText)) {
                this.bumpCandidateCounter(this.candidateStats.localDropped, candidateType)
                this.dbg.p(`local ICE dropped type=${candidateType} phase=${this.icePhase}`)
                this.emitDebug(`ice-local-drop:${candidateType}`)
                return
            }
            this.bumpCandidateCounter(this.candidateStats.localSent, candidateType)
            try {
                // Include local pcGeneration so remote side can safely ignore stale ICE
                // after peer rebuilds within the same signaling epoch.
                const candidatePayload = {
                    ...ev.candidate.toJSON(),
                    epoch: this.signalingEpoch,
                    pcGeneration: generation,
                } as RTCIceCandidateInit & { epoch: number; pcGeneration: number }
                if (this.role === 'caller')
                    await this.streams.addCallerIceCandidate(candidatePayload as any)
                else await this.streams.addCalleeIceCandidate(candidatePayload as any)
            } catch (e) {
                this.onError(
                    this.raiseError(
                        e,
                        RTCErrorCode.DB_UNAVAILABLE,
                        'signaling',
                        true,
                        undefined,
                        false,
                    ),
                )
            }
        }

        this.pc.onnegotiationneeded = () => {
            void this.publishOfferIfStable(generation, 'onnegotiationneeded')
        }

        if (this.role === 'caller') {
            // Fail-safe for very fast reload races where negotiationneeded can be missed.
            setTimeout(() => {
                void this.publishOfferIfStable(generation, 'bootstrap')
            }, 0)
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
            if (this.areDataChannelsOpen()) {
                this.clearDcRecoveryTimer()
                this.dcRecoveryGeneration = undefined
            }
            this.emitDebug(`dc-open:${ch.label}`)
        }
        ch.onclose = () => {
            this.dbg.p(`onclose (${ch.label})`)

            // Ignore close events from stale channels after RTCPeerConnection replacement.
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
        const timeoutMs = opts.timeoutMs ?? this.defaultWaitReadyTimeoutMs
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
        this.clearLanFirstTimer()
        this.clearDcRecoveryTimer()
        this.dcRecoveryGeneration = undefined
        this.clearConnectingWatchdogTimer()
        this.connectingWatchdogGeneration = undefined
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

    private async logIceDiagnostics(reason: string, generation: number) {
        if (!this.debugEnabled) return
        if (!this.pc) return
        if (!this.isCurrentGeneration(generation)) return
        if (typeof this.pc.getStats !== 'function') return
        try {
            const stats = await this.pc.getStats()
            if (!this.pc) return
            if (!this.isCurrentGeneration(generation)) return

            const localCandidates = new Map<string, any>()
            const remoteCandidates = new Map<string, any>()
            let selectedPair: any
            let inProgressPair: any

            stats.forEach((report: any) => {
                if (report.type === 'local-candidate') localCandidates.set(report.id, report)
                if (report.type === 'remote-candidate') remoteCandidates.set(report.id, report)
            })

            stats.forEach((report: any) => {
                if (report.type !== 'candidate-pair') return
                const isSelected =
                    report.selected === true ||
                    report.nominated === true ||
                    report.state === 'succeeded'
                if (isSelected && !selectedPair) {
                    selectedPair = report
                    return
                }
                if (!inProgressPair && report.state === 'in-progress') inProgressPair = report
            })

            const pair = selectedPair ?? inProgressPair
            const local = pair ? localCandidates.get(pair.localCandidateId) : undefined
            const remote = pair ? remoteCandidates.get(pair.remoteCandidateId) : undefined

            this.dbg.p(`ice diagnostics (${reason})`, {
                generation,
                connectionState: this.pc.connectionState,
                iceConnectionState: this.pc.iceConnectionState,
                signalingState: this.pc.signalingState,
                pairId: pair?.id ?? null,
                pairState: pair?.state ?? null,
                pairNominated: pair?.nominated ?? null,
                pairSelected: pair?.selected ?? null,
                pairRtt: pair?.currentRoundTripTime ?? null,
                pairBytesSent: pair?.bytesSent ?? null,
                pairBytesReceived: pair?.bytesReceived ?? null,
                localCandidateType: local?.candidateType ?? null,
                localProtocol: local?.protocol ?? null,
                localAddress: local?.address ?? local?.ip ?? null,
                localPort: local?.port ?? null,
                remoteCandidateType: remote?.candidateType ?? null,
                remoteProtocol: remote?.protocol ?? null,
                remoteAddress: remote?.address ?? remote?.ip ?? null,
                remotePort: remote?.port ?? null,
            })
            this.emitDebug(`ice-diagnostics:${reason}`)
        } catch (e) {
            this.dbg.pe(`ice diagnostics failed (${reason})`, e)
        }
    }

    private scheduleSoftThenMaybeHard() {
        if (!this.roomId || this.phase === 'closing' || this.phase === 'idle') return
        if (!this.pc || this.pc.signalingState === 'closed') return
        this.clearConnectingWatchdogTimer()
        this.connectingWatchdogGeneration = undefined
        this.clearRecoveryTimers()
        this.upkeepRecoveryBackoff()
        this.phase = 'soft-reconnect'
        const softIn = this.softDelayMs
        const hardIn = this.hardDelayMs

        this.softTimer = setTimeout(() => {
            this.softRetries++
            this.reconnectSoft().catch(() => {})
            // exponential backoff up to 2.5s
            this.softDelayMs = Math.min(this.softDelayMs * 2, 2500)
            this.emitDebug('soft-reconnect fire')
        }, softIn) as unknown as number

        this.hardTimer = setTimeout(() => {
            this.tryHardNow().catch(() => {})
            // exponential backoff up to 10s
            this.hardRetries++
            this.hardDelayMs = Math.min(this.hardDelayMs * 2, 30000)
            this.emitDebug('hard-reconnect fire')
        }, hardIn) as unknown as number

        this.emitDebug('schedule reconnects')
    }

    private upkeepRecoveryBackoff() {
        // Fine-tune backoff/reset strategy here for specific events.
    }

    private async tryHardNow() {
        if (!this.roomId || this.phase === 'closing' || this.phase === 'idle') return
        this.clearRecoveryTimers()
        try {
            await this.reconnectHard({ awaitReadyMs: this.defaultWaitReadyTimeoutMs })
        } catch (e) {
            this.dbg.pe('tryHardNow failed', e)
            this.onError(
                this.raiseError(
                    e,
                    RTCErrorCode.SIGNALING_FAILED,
                    'reconnect',
                    true,
                    undefined,
                    false,
                ),
            )
        }
    }

    private acceptEpoch(epochLike: unknown): boolean {
        const epoch =
            typeof epochLike === 'number' && Number.isFinite(epochLike)
                ? epochLike
                : this.signalingEpoch
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
            this.remotePcGeneration = undefined
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
        const room = await this.signalDb.getRoom()
        if (!room) {
            throw this.raiseError(
                new Error('Room not found'),
                RTCErrorCode.ROOM_NOT_FOUND,
                'room',
                false,
                'signaling room no longer exists',
            )
        }
        this.acceptEpoch(room.epoch)
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
            connectionStrategy: this.connectionStrategy,
            icePhase: this.icePhase,
            pcGeneration: this.pcGeneration,
            candidateStats: this.candidateStats,
            selectedPath: this.selectedPath,
            lastEvent,
            lastError: this.lastErrorText,
        }
        this.onDebug(st)
    }
}
