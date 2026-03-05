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
import {
    DEFAULT_ICE_SERVERS,
    extractStunOnlyIceServers,
    extractTurnOnlyIceServers,
} from './ice-config'
import {
    createInitialNetRttSnapshot,
    createNetRttService,
    type NetRttService,
    type NetRttSnapshot,
} from './metrics/netRtt'
import { createPingService, type PingService, type PingSnapshot } from './protocol/ping'
import { createSignalStreams } from './signal-rx'
import type { AnswerSDP, OfferSDP, RoomDoc, SignalDB } from './types'

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

const flattenIceUrls = (iceServers: RTCIceServer[]): string[] => {
    const urls: string[] = []
    for (const server of iceServers) {
        const raw = server.urls
        if (typeof raw === 'string') {
            urls.push(raw)
            continue
        }
        if (Array.isArray(raw)) {
            for (const url of raw) {
                if (typeof url === 'string') urls.push(url)
            }
        }
    }
    return urls
}

const summarizeIceServers = (
    iceServers: RTCIceServer[],
): {
    stunCount: number
    turnCount: number
    urlsSample: string[]
} => {
    const urls = flattenIceUrls(iceServers)
    let stunCount = 0
    let turnCount = 0
    for (const url of urls) {
        const lower = url.toLowerCase()
        if (lower.startsWith('stun:') || lower.startsWith('stuns:')) stunCount += 1
        if (lower.startsWith('turn:') || lower.startsWith('turns:')) turnCount += 1
    }
    return {
        stunCount,
        turnCount,
        urlsSample: urls.slice(0, 3),
    }
}

function mkDbg(ctx: {
    role: 'caller' | 'callee'
    roomId: () => string | null
    pc: () => RTCPeerConnection | undefined
    enabled: boolean
}) {
    const p = (msg: string, extra?: unknown) => {
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
const CONNECTING_WATCHDOG_MS_PUBLIC = 30_000
const MAX_STUN_WATCHDOG_RECONNECTS = 2
const DEFAULT_STUN_ONLY_TIMEOUT_MS = 10_000
const STUN_ONLY_CHECKING_GRACE_MS = 1800
const STUN_ONLY_PROGRESS_WINDOW_MS = 2000
const STUN_ONLY_PROGRESS_EXTENSION_MS = 2000

const createSessionId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    const rand = Math.random().toString(16).slice(2, 10)
    return `sess-${Date.now().toString(16)}-${rand}`
}

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
    stunOnlyTimeoutMs?: number
    pingIntervalMs?: number
    pingWindowSize?: number
    netRttIntervalMs?: number
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
    sessionId: string | null
    participantId: string | null
    candidateStats: {
        localSeen: Record<CandidateType, number>
        localSent: Record<CandidateType, number>
        localDropped: Record<CandidateType, number>
        remoteSeen: Record<CandidateType, number>
        remoteAccepted: Record<CandidateType, number>
        remoteDropped: Record<CandidateType, number>
    }
    selectedPath?: CandidateType
    ping: PingSnapshot
    netRtt: NetRttSnapshot
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
    private readonly nativeIceServers: RTCIceServer[]
    private readonly stunOnlyIceServers: RTCIceServer[]
    private readonly turnOnlyIceServers: RTCIceServer[]
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
    private sessionId: string | null = null
    private participantId: string | null = null
    private loggedStaleSessionKeys = new Set<string>()
    private seenRemoteOfferSessions = new Set<string>()
    private readonly connectionStrategy: ConnectionStrategy
    private readonly lanFirstTimeoutMs: number
    private readonly stunOnlyTimeoutMs: number
    private readonly netRttIntervalMs: number
    private icePhase: IcePhase
    private lanFirstTimer?: number
    private stunOnlyTimer?: number
    private dcRecoveryTimer?: number
    private dcRecoveryGeneration?: number
    private pcGeneration = 0
    private controlledPeerRebuild = false
    private selectedPath: CandidateType | undefined
    private selectedPathDiagnosticsKey: string | null = null
    private readonly pingService: PingService
    private netRttService?: NetRttService
    private remoteProgressSeq = 0
    private remoteProgressLastAt = 0
    private signalSequence = 0
    private takeoverStopping = false
    private ownSlotActive = true
    private ownSlotCheckAt = 0
    private ownSlotCheckInFlight?: Promise<boolean>
    private ownSlotSessionMismatchKey: string | null = null
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
        const globalWithRuntimeFlags = globalThis as typeof globalThis & {
            __vitest_worker__?: unknown
            process?: { env?: { NODE_ENV?: string } }
        }
        const isTestEnv =
            // Vitest exposes this marker in test runtime.
            typeof globalWithRuntimeFlags.__vitest_worker__ !== 'undefined' ||
            // Fallback for Node/Jest-like runners.
            globalWithRuntimeFlags.process?.env?.NODE_ENV === 'test'
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
        this.stunOnlyTimeoutMs = opts.stunOnlyTimeoutMs ?? DEFAULT_STUN_ONLY_TIMEOUT_MS
        this.netRttIntervalMs = opts.netRttIntervalMs ?? 1000
        this.baseRtcConfig = opts.rtcConfiguration ? { ...opts.rtcConfiguration } : {}
        const configuredIceServers = this.baseRtcConfig.iceServers ?? []
        const fallbackIceServers =
            opts.stunServers && opts.stunServers.length > 0 ? opts.stunServers : DEFAULT_ICE_SERVERS
        const effectiveIceServers =
            configuredIceServers.length > 0 ? configuredIceServers : fallbackIceServers
        this.nativeIceServers = effectiveIceServers.map((server) => ({ ...server }))
        this.stunOnlyIceServers = extractStunOnlyIceServers(effectiveIceServers)
        this.turnOnlyIceServers = extractTurnOnlyIceServers(effectiveIceServers)
        this.icePhase = this.resolveInitialIcePhase()

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
        this.pingService = createPingService({
            send: (message) => {
                if (this.dcReliable?.readyState === 'open') {
                    this.dcReliable.send(message)
                    return
                }
                if (this.dcFast?.readyState === 'open') {
                    this.dcFast.send(message)
                }
            },
            isOpen: () => this.isAnyDataChannelsOpen(),
            intervalMs: opts.pingIntervalMs,
            windowSize: opts.pingWindowSize,
            onUpdate: () => {
                this.emitDebug()
            },
        })

        this.streams = createSignalStreams(this.signalDb)
        const participantId = (
            this.signalDb as SignalDB & { getParticipantId?: () => string | null }
        ).getParticipantId?.()
        if (participantId) this.participantId = participantId
    }

    // ————————————————————————————————————————————————————————————————
    // Public API
    // ————————————————————————————————————————————————————————————————

    async createRoom(): Promise<string> {
        let id: string
        this.dbg.p('join-start', { role: this.role, mode: 'create' })
        this.emitDebug('join-start')
        try {
            id = await this.signalDb.createRoom()
        } catch (e) {
            throw this.raiseError(e, RTCErrorCode.DB_UNAVAILABLE, 'room', true, 'createRoom failed')
        }
        this.roomId = id
        try {
            const room = await this.signalDb.getRoom()
            this.signalingEpoch = room?.epoch ?? 0
            this.syncIdentityFromRoom(room)
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
        this.dbg.p('join-success', {
            role: this.role,
            participantId: this.participantId,
            sessionId: this.sessionId,
            roomId: id,
        })
        this.emitDebug('join-success')
        // Align lifecycle with joinRoom(): connect() flow expects non-idle pre-subscribed state.
        this.phase = 'subscribed'
        this.dbg.p(`createRoom -> ${id}`)
        this.emitDebug('createRoom')
        return id
    }

    async joinRoom(id: string): Promise<void> {
        this.roomId = id
        this.dbg.p('join-start', {
            role: this.role,
            participantId: this.participantId,
            roomId: id,
        })
        this.emitDebug('join-start')
        this.dbg.p(`joinRoom -> ${id}`)
        try {
            await this.signalDb.joinRoom(id, this.role)
        } catch (e) {
            throw this.raiseError(e, RTCErrorCode.DB_UNAVAILABLE, 'room', true, 'joinRoom failed')
        }
        try {
            const room = await this.signalDb.getRoom()
            this.signalingEpoch = room?.epoch ?? 0
            this.syncIdentityFromRoom(room)
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
        this.dbg.p('join-success', {
            role: this.role,
            participantId: this.participantId,
            sessionId: this.sessionId,
            roomId: id,
        })
        this.emitDebug('join-success')
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
        this.selectedPathDiagnosticsKey = null
        this.loggedStaleSessionKeys.clear()
        this.seenRemoteOfferSessions.clear()
        this.stunWatchdogReconnects = 0
        this.takeoverStopping = false
        this.ownSlotActive = true
        this.ownSlotCheckAt = 0
        this.ownSlotCheckInFlight = undefined
        this.ownSlotSessionMismatchKey = null
        this.remoteProgressSeq = 0
        this.remoteProgressLastAt = 0
        this.signalSequence = 0
        this.pingService.stop()
        this.pingService.reset()
        this.netRttService?.stop()
        this.netRttService?.reset()
        this.candidateStats = {
            localSeen: this.makeCandidateCountMap(),
            localSent: this.makeCandidateCountMap(),
            localDropped: this.makeCandidateCountMap(),
            remoteSeen: this.makeCandidateCountMap(),
            remoteAccepted: this.makeCandidateCountMap(),
            remoteDropped: this.makeCandidateCountMap(),
        }
        this.clearLanFirstTimer()
        this.clearStunOnlyTimer()
        this.icePhase = this.resolveInitialIcePhase()

        this.initPeer()
        this.emitDebug('initPeer')

        // --- Rx: subscriptions to remote ICE candidates ---
        const remoteIce$ =
            this.role === 'caller' ? this.streams.calleeIce$ : this.streams.callerIce$
        this.rxSubs.push(
            remoteIce$.subscribe(async (c) => {
                const candidateSignal = c as RTCIceCandidateInit & {
                    epoch?: number
                    icePhase?: IcePhase
                }
                if (!this.acceptEpoch(candidateSignal.epoch)) return
                if (!(await this.ensureOwnSlotActive('recv-candidate'))) return
                const remoteSessionId = this.getSignalSessionId(c)
                this.dbg.p('signaling-recv:candidate', {
                    sessionId: remoteSessionId ?? null,
                    currentSessionId: this.sessionId ?? null,
                    phase: this.icePhase,
                })
                if (
                    remoteSessionId &&
                    remoteSessionId !== this.sessionId &&
                    !this.remoteDescSet
                ) {
                    const isCurrentRemoteSession =
                        await this.isCurrentRemoteRoleSession(remoteSessionId)
                    if (!isCurrentRemoteSession) {
                        this.logStaleSessionOnce('candidate', remoteSessionId)
                        this.dbg.p(
                            'signaling-recv:candidate ignored due to remote lease session mismatch',
                            {
                                sessionId: remoteSessionId,
                                currentSessionId: this.sessionId ?? null,
                            },
                        )
                        return
                    }
                }
                const syncedSession = this.syncPeerToRemoteSession(
                    remoteSessionId,
                    candidateSignal.icePhase,
                    'candidate',
                )
                if (syncedSession == null) {
                    this.dbg.p('signaling-recv:candidate ignored due to session mismatch', {
                        sessionId: remoteSessionId ?? null,
                        currentSessionId: this.sessionId ?? null,
                    })
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
                    this.dbg.p(
                        `LAN received non-host ICE (${candidateType}) -> fallback to public ICE`,
                    )
                    this.transitionToNextIcePhase('remote-candidate')
                }
                if (!shouldAcceptCandidate(this.icePhase, candidateText)) {
                    this.bumpCandidateCounter(this.candidateStats.remoteDropped, candidateType)
                    this.dbg.p(`remote ICE dropped type=${candidateType} phase=${this.icePhase}`)
                    this.emitDebug(`ice-remote-drop:${candidateType}`)
                    return
                }
                this.bumpCandidateCounter(this.candidateStats.remoteAccepted, candidateType)
                this.markRemoteProgress()
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
                const offerSignal = offer as OfferSDP
                if (!this.acceptEpoch(offerSignal.epoch)) return
                if (!(await this.ensureOwnSlotActive('recv-offer'))) return
                const remoteSessionId = this.getSignalSessionId(offer)
                this.dbg.p('signaling-recv:offer', {
                    sessionId: remoteSessionId ?? null,
                    currentSessionId: this.sessionId ?? null,
                    phase: this.icePhase,
                })
                if (
                    remoteSessionId &&
                    remoteSessionId !== this.sessionId &&
                    this.seenRemoteOfferSessions.has(remoteSessionId)
                ) {
                    this.logStaleSessionOnce('offer', remoteSessionId)
                    return
                }
                if (remoteSessionId && remoteSessionId !== this.sessionId) {
                    const isCurrentRemoteSession =
                        await this.isCurrentRemoteRoleSession(remoteSessionId)
                    if (!isCurrentRemoteSession) {
                        this.logStaleSessionOnce('offer', remoteSessionId)
                        this.dbg.p('signaling-recv:offer ignored due to session mismatch', {
                            sessionId: remoteSessionId,
                            currentSessionId: this.sessionId ?? null,
                        })
                        return
                    }
                }
                const localSessionId = this.syncPeerToRemoteSession(
                    remoteSessionId,
                    offerSignal.icePhase,
                    'offer',
                )
                if (localSessionId == null) {
                    this.dbg.p('signaling-recv:offer ignored due to session mismatch', {
                        sessionId: remoteSessionId ?? null,
                        currentSessionId: this.sessionId ?? null,
                    })
                    return
                }
                if (remoteSessionId) this.seenRemoteOfferSessions.add(remoteSessionId)
                const localGeneration = this.pcGeneration
                const desc = new RTCSessionDescription(offer)
                const sdp = desc.sdp ?? null
                const offerSignalKey = `${remoteSessionId ?? 'n/a'}|${
                    offerSignal.forGen ??
                    offerSignal.gen ??
                    offerSignal.pcGeneration ??
                    offerSignal.forPcGeneration ??
                    -1
                }|${sdp ?? ''}`
                this.dbg.p('onOffer()', {
                    type: desc.type,
                    sdp: sdpHash(sdp),
                    makingOffer: this.makingOffer,
                    sig: this.pc?.signalingState,
                    polite: this.polite,
                })
                this.emitDebug('onOffer')

                if (offerSignalKey === this.lastSeenOfferSdp) {
                    this.dbg.p('skip offer: already seen')
                    return
                }
                this.lastSeenOfferSdp = offerSignalKey

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

                    if (offerSignalKey === this.lastHandledOfferSdp) {
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
                            await this.pc?.setLocalDescription({
                                type: 'rollback',
                            } as RTCSessionDescriptionInit)
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
                    this.lastHandledOfferSdp = offerSignalKey
                    this.dbg.p('SRD(offer) done, drain ICE', { pending: this.pendingIce.length })
                    this.emitDebug('SRD(offer) done')

                    while (this.pendingIce.length) {
                        const c = this.pendingIce.shift()
                        if (!c) continue
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
                        this.dbg.p(`skip answer: state!=${this.pc?.signalingState}`)
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
                    if (this.icePhase === 'STUN_ONLY') this.startStunOnlyTimer(localGeneration)
                    this.dbg.p('SLD(answer) done, publish')
                    const epochChanged = await this.refreshSignalingEpoch()
                    if (epochChanged) {
                        this.dbg.p('skip answer publish after epoch sync')
                        return
                    }
                    if (!(await this.ensureOwnSlotActive('send-answer:offer-handler:publish'))) {
                        this.dbg.p('skip answer publish: role slot is not active')
                        return
                    }
                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
                    const localRoleSessionId = this.getLocalRoleSessionId() ?? this.sessionId
                    const answerForSessionId = offerSignal.forSessionId ?? remoteSessionId
                    const signalSeq = this.nextSignalSequence()
                    this.dbg.p('signaling-send:answer', {
                        sessionId: localRoleSessionId ?? null,
                        forSessionId: answerForSessionId ?? null,
                        generation: localGeneration,
                        signalSeq,
                        phase: this.icePhase,
                    })
                    await this.streams.setAnswer({
                        ...(answer as AnswerSDP),
                        epoch: this.signalingEpoch,
                        pcGeneration: localGeneration,
                        gen: localGeneration,
                        forGen: signalSeq,
                        sessionId: localRoleSessionId ?? undefined,
                        forSessionId: answerForSessionId ?? undefined,
                        icePhase: this.icePhase,
                    } as AnswerSDP)
                    this.dbg.p('answer published')
                } catch (e) {
                    if (await this.handleTakeoverWriteError('send-answer:offer-handler', e)) return
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
                const answerSignal = answer as AnswerSDP
                if (!this.acceptEpoch(answerSignal.epoch)) return
                if (!(await this.ensureOwnSlotActive('recv-answer'))) return
                const remoteSessionId = this.getSignalSessionId(answer)
                const answerForSessionId = this.getSignalTargetSessionId(answer)
                this.dbg.p('signaling-recv:answer', {
                    sessionId: remoteSessionId ?? null,
                    forSessionId: answerForSessionId ?? null,
                    currentSessionId: this.sessionId ?? null,
                    phase: this.icePhase,
                })
                const desc = new RTCSessionDescription(answer)
                const sdp = desc.sdp ?? null
                const answerSignalKey = `${remoteSessionId ?? 'n/a'}|${answerForSessionId ?? 'n/a'}|${
                    answerSignal.forGen ??
                    answerSignal.gen ??
                    answerSignal.pcGeneration ??
                    answerSignal.forPcGeneration ??
                    -1
                }|${sdp ?? ''}`
                this.dbg.p('onAnswer()', {
                    type: desc.type,
                    sdp: sdpHash(sdp),
                    sig: this?.pc?.signalingState,
                })
                this.emitDebug('onAnswer')

                if (answerSignalKey === this.lastSeenAnswerSdp) {
                    this.dbg.p('skip answer: already seen')
                    return
                }
                this.lastSeenAnswerSdp = answerSignalKey

                try {
                    if (desc.type !== 'answer') return
                    const localRoleSessionId = this.getLocalRoleSessionId()
                    if (
                        this.role === 'caller' &&
                        answerForSessionId &&
                        localRoleSessionId &&
                        answerForSessionId !== localRoleSessionId
                    ) {
                        this.logStaleSessionOnce('answer', remoteSessionId ?? answerForSessionId)
                        this.dbg.p('signaling-recv:answer ignored due to target session mismatch', {
                            answerForSessionId,
                            localRoleSessionId,
                            remoteSessionId: remoteSessionId ?? null,
                        })
                        return
                    }
                    const prevSessionId = this.sessionId
                    const localSessionId = this.syncPeerToRemoteSession(
                        remoteSessionId,
                        answerSignal.icePhase,
                        'answer',
                    )
                    if (localSessionId == null) {
                        this.dbg.p('signaling-recv:answer ignored due to session mismatch', {
                            sessionId: remoteSessionId ?? null,
                            currentSessionId: this.sessionId ?? null,
                        })
                        return
                    }
                    const remoteSessionChanged =
                        !!remoteSessionId && !!prevSessionId && remoteSessionId !== prevSessionId
                    if (answerSignalKey === this.lastHandledAnswerSdp) {
                        this.dbg.p('skip answer (same sdp handled)')
                        return
                    }
                    if (!this.pc || this.pc.signalingState !== 'have-local-offer') {
                        if (
                            this.role === 'caller' &&
                            remoteSessionChanged &&
                            this.pc &&
                            this.pc.signalingState === 'stable'
                        ) {
                            this.dbg.p('answer indicates remote session change -> reconnectHard', {
                                remoteSessionId,
                                prevSessionId,
                            })
                            void this.tryHardNow()
                            return
                        }
                        this.dbg.p(
                            'skip answer: not waiting (state=' +
                                (this.pc?.signalingState ?? 'no-pc') +
                                ')',
                        )
                        return
                    }
                    const localGeneration = this.pcGeneration

                    this.dbg.p('SRD(answer) start')
                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
                    try {
                        await this.pc.setRemoteDescription(desc)
                    } catch (e) {
                        this.dbg.pe(`SRD FAIL type=answer sdp=${sdpHash(sdp)}`, e)
                        throw e
                    }
                    if (!this.isCurrentGeneration(localGeneration) || !this.pc) return
                    this.lastHandledAnswerSdp = answerSignalKey
                    this.remoteDescSet = true
                    this.markRemoteProgress()
                    this.dbg.p('SRD(answer) done, drain ICE', { pending: this.pendingIce.length })
                    this.emitDebug('SRD(answer) done')

                    while (this.pendingIce.length) {
                        const c = this.pendingIce.shift()
                        if (!c) continue
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
        if (!(await this.ensureOwnSlotActive('reconnect-soft'))) return
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
            this.makingOffer = true
            this.remoteDescSet = false
            const offer = await this.pc.createOffer({ iceRestart: true })
            this.lastLocalOfferSdp = offer.sdp ?? null
            this.dbg.p('SLD(offer,iceRestart) start', { sdp: sdpHash(offer.sdp) })
            await this.pc.setLocalDescription(offer)
            if (this.icePhase === 'STUN_ONLY') this.startStunOnlyTimer(this.pcGeneration)
            const epochChanged = await this.refreshSignalingEpoch()
            if (epochChanged) {
                this.dbg.p('skip offer(iceRestart) publish after epoch sync')
                return
            }
            if (!(await this.ensureOwnSlotActive('reconnect-soft:publish'))) return
            const localRoleSessionId = this.getLocalRoleSessionId() ?? this.sessionId
            const signalSeq = this.nextSignalSequence()
            this.dbg.p('signaling-send:offer', {
                sessionId: localRoleSessionId ?? null,
                generation: this.pcGeneration,
                signalSeq,
                phase: this.icePhase,
                source: 'reconnectSoft',
            })
            await this.streams.setOffer({
                ...(offer as OfferSDP),
                epoch: this.signalingEpoch,
                pcGeneration: this.pcGeneration,
                gen: this.pcGeneration,
                forGen: signalSeq,
                sessionId: localRoleSessionId ?? undefined,
                forSessionId: localRoleSessionId ?? undefined,
                icePhase: this.icePhase,
            } as OfferSDP)
            this.dbg.p('offer(iceRestart) published')
        } catch (e) {
            if (await this.handleTakeoverWriteError('send-offer:reconnect-soft', e)) return
            throw this.raiseError(
                e,
                RTCErrorCode.SIGNALING_FAILED,
                'reconnect',
                true,
                'reconnectSoft failed',
            )
        } finally {
            this.makingOffer = false
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
        this.pingService.stop()
        this.netRttService?.stop()

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

        // Best-effort presence signal so remote peer can react quickly to manual leave.
        // Skip it during takeover shutdown: stale tabs must not write into role docs.
        if (!this.takeoverStopping) {
            try {
                void this.signalDb.leaveRoom?.(this.role).catch(() => {})
            } catch {}
        }

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

    get currentParticipantId() {
        return this.participantId
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

    private hasIcePhase(phase: IcePhase): boolean {
        if (phase === 'LAN') return true
        if (phase === 'STUN') return this.nativeIceServers.length > 0
        if (phase === 'STUN_ONLY') return this.stunOnlyIceServers.length > 0
        return this.turnOnlyIceServers.length > 0
    }

    private resolveInitialIcePhase(): IcePhase {
        if (this.connectionStrategy === 'LAN_FIRST') return 'LAN'
        if (this.connectionStrategy === 'BROWSER_NATIVE') return 'STUN'
        if (this.hasIcePhase('STUN_ONLY')) return 'STUN_ONLY'
        if (this.hasIcePhase('TURN_ENABLED')) return 'TURN_ENABLED'
        return 'STUN_ONLY'
    }

    private getNextIcePhase(from: IcePhase): IcePhase | undefined {
        if (from === 'LAN') {
            if (this.hasIcePhase('STUN_ONLY')) return 'STUN_ONLY'
            if (this.hasIcePhase('TURN_ENABLED')) return 'TURN_ENABLED'
            return undefined
        }
        if (from === 'STUN' || from === 'STUN_ONLY') {
            if (this.hasIcePhase('TURN_ENABLED')) return 'TURN_ENABLED'
            return undefined
        }
        return undefined
    }

    private normalizeSignalIcePhase(value: unknown): IcePhase | undefined {
        if (value === 'TURN_ONLY') return 'TURN_ENABLED'
        if (
            value === 'LAN' ||
            value === 'STUN' ||
            value === 'STUN_ONLY' ||
            value === 'TURN_ENABLED'
        ) {
            return value
        }
        return undefined
    }

    private getRoleSlotSessionIdFromRoom(
        room: RoomDoc | null | undefined,
        role: Role,
    ): string | null {
        const slot = role === 'caller' ? room?.slots?.caller : room?.slots?.callee
        if (!slot || typeof slot.sessionId !== 'string') return null
        const value = slot.sessionId.trim()
        return value.length > 0 ? value : null
    }

    private syncIdentityFromRoom(room: RoomDoc | null | undefined) {
        const db = this.signalDb as SignalDB & {
            getParticipantId?: () => string | null
            getRoleSessionId?: (role: Role) => string | null
        }
        const participantId = db.getParticipantId?.()
        if (participantId) this.participantId = participantId
        const sessionFromAdapter = db.getRoleSessionId?.(this.role) ?? null
        const sessionFromRoom = this.getRoleSlotSessionIdFromRoom(room, this.role)
        const nextSessionId = sessionFromAdapter || sessionFromRoom
        if (nextSessionId) this.sessionId = nextSessionId
    }

    private async isCurrentRemoteRoleSession(remoteSessionId: string): Promise<boolean> {
        try {
            const room = await this.signalDb.getRoom()
            if (!room) return true
            const remoteRole: Role = this.role === 'caller' ? 'callee' : 'caller'
            const activeRemoteSessionId = this.getRoleSlotSessionIdFromRoom(room, remoteRole)
            if (!activeRemoteSessionId) return true
            return activeRemoteSessionId === remoteSessionId
        } catch {
            return true
        }
    }

    private getSignalSessionId(signal: unknown): string | undefined {
        const raw = (signal as { sessionId?: unknown } | null | undefined)?.sessionId
        if (typeof raw !== 'string') return undefined
        const value = raw.trim()
        return value.length > 0 ? value : undefined
    }

    private getSignalTargetSessionId(signal: unknown): string | undefined {
        const raw = (signal as { forSessionId?: unknown } | null | undefined)?.forSessionId
        if (typeof raw !== 'string') return undefined
        const value = raw.trim()
        return value.length > 0 ? value : undefined
    }

    private logStaleSessionOnce(
        source: 'offer' | 'answer' | 'candidate',
        remoteSessionId: string | undefined,
    ) {
        const key = `${source}:${remoteSessionId ?? 'missing'}:${this.sessionId ?? 'none'}`
        if (this.loggedStaleSessionKeys.has(key)) return
        this.loggedStaleSessionKeys.add(key)
        this.dbg.p(`ignore-stale-session:${source}`, {
            currentSessionId: this.sessionId ?? null,
            remoteSessionId: remoteSessionId ?? null,
        })
        this.emitDebug('ignore-stale-session')
    }

    private errorMessage(error: unknown): string {
        if (typeof error === 'string') return error
        if (error && typeof error === 'object' && 'message' in error) {
            const message = (error as { message?: unknown }).message
            if (typeof message === 'string') return message
        }
        return String(error)
    }

    private isTakeoverWriteError(error: unknown): boolean {
        const directMessage = this.errorMessage(error).toLowerCase()
        if (directMessage.includes('taken over')) return true
        if (error && typeof error === 'object' && 'cause' in error) {
            const cause = (error as { cause?: unknown }).cause
            const causeMessage = this.errorMessage(cause).toLowerCase()
            if (causeMessage.includes('taken over')) return true
        }
        return false
    }

    private async handleTakeoverWriteError(source: string, error: unknown): Promise<boolean> {
        if (!this.isTakeoverWriteError(error)) return false
        let slot: ReturnType<typeof this.getRoleSlotFromRoom>
        try {
            const room = await this.signalDb.getRoom()
            slot = this.getRoleSlotFromRoom(room, this.role)
        } catch {}
        await this.handleTakeoverDetected(source, slot)
        return true
    }

    private getLocalRoleSessionId(): string | null {
        const signalDbWithRoleSession = this.signalDb as SignalDB & {
            getRoleSessionId?: (role: Role) => string | null
        }
        return signalDbWithRoleSession.getRoleSessionId?.(this.role) ?? this.sessionId
    }

    private getRoleSlotFromRoom(
        room: RoomDoc | null | undefined,
        role: Role,
    ):
        | {
              participantId: string
              sessionId: string
              joinedAt: number
              lastSeenAt: number
          }
        | null
        | undefined {
        return role === 'caller' ? room?.slots?.caller : room?.slots?.callee
    }

    private async handleTakeoverDetected(
        source: string,
        slot:
            | {
                  participantId: string
                  sessionId: string
                  joinedAt: number
                  lastSeenAt: number
              }
            | null
            | undefined,
    ) {
        if (this.takeoverStopping) return
        this.takeoverStopping = true
        this.dbg.p('takeover-detected', {
            role: this.role,
            source,
            myParticipantId: this.participantId,
            mySessionId: this.getLocalRoleSessionId(),
            ownerParticipantId: slot?.participantId ?? null,
            ownerSessionId: slot?.sessionId ?? null,
        })
        this.emitDebug('takeover-detected')
        this.onError(
            this.raiseError(
                new Error('Room slot was taken over by another tab'),
                RTCErrorCode.INVALID_STATE,
                'lifecycle',
                false,
                'takeover detected',
                false,
            ),
        )
        try {
            await this.hangup()
        } catch {}
    }

    private async ensureOwnSlotActive(source: string): Promise<boolean> {
        if (this.takeoverStopping) return false
        if (this.phase === 'closing' || this.phase === 'idle') return false
        if (!this.roomId || !this.participantId) return true
        const nowMs = Date.now()
        if (this.ownSlotCheckInFlight) return this.ownSlotActive
        if (nowMs - this.ownSlotCheckAt < 400) return this.ownSlotActive

        this.ownSlotCheckInFlight = (async () => {
            let active = true
            try {
                const localSessionId = this.getLocalRoleSessionId()
                const localParticipantId = this.participantId
                const resolveMismatch = async () => {
                    const room = await this.signalDb.getRoom()
                    const slot = this.getRoleSlotFromRoom(room, this.role)
                    return {
                        slot,
                        ownerMismatch:
                            !!slot?.participantId &&
                            !!localParticipantId &&
                            slot.participantId !== localParticipantId,
                        sessionMismatch:
                            !!slot?.sessionId &&
                            !!localSessionId &&
                            slot.sessionId !== localSessionId,
                    }
                }

                let { slot, ownerMismatch, sessionMismatch } = await resolveMismatch()
                if (ownerMismatch || sessionMismatch) {
                    // Re-check once to avoid false positives from transient stale snapshots.
                    const confirmed = await resolveMismatch()
                    slot = confirmed.slot
                    ownerMismatch = confirmed.ownerMismatch
                    sessionMismatch = confirmed.sessionMismatch
                }
                if (ownerMismatch) {
                    active = false
                    await this.handleTakeoverDetected(source, slot)
                } else if (sessionMismatch) {
                    const mismatchKey = `${slot?.sessionId ?? 'none'}|${localSessionId ?? 'none'}`
                    if (this.ownSlotSessionMismatchKey !== mismatchKey) {
                        this.ownSlotSessionMismatchKey = mismatchKey
                        this.dbg.p('own-slot session mismatch -> takeover', {
                            source,
                            roomSessionId: slot?.sessionId ?? null,
                            localSessionId: localSessionId ?? null,
                        })
                    }
                    active = false
                    await this.handleTakeoverDetected(source, slot)
                } else {
                    this.ownSlotSessionMismatchKey = null
                }
            } catch {
                active = true
            } finally {
                this.ownSlotActive = active
                this.ownSlotCheckAt = Date.now()
                this.ownSlotCheckInFlight = undefined
            }
            return this.ownSlotActive
        })()

        return this.ownSlotActive
    }

    private markRemoteProgress() {
        this.remoteProgressSeq += 1
        this.remoteProgressLastAt = Date.now()
    }

    private nextSignalSequence(): number {
        this.signalSequence += 1
        return this.signalSequence
    }

    private syncPeerToRemoteSession(
        remoteSessionId: string | undefined,
        remotePhaseRaw: unknown,
        source: 'offer' | 'answer' | 'candidate',
    ): string | undefined {
        if (!remoteSessionId) return this.sessionId ?? undefined
        if (remoteSessionId === this.sessionId) return remoteSessionId
        if (source === 'answer' && this.role === 'caller') {
            this.dbg.p(`sync-remote-session:${source}`, {
                remoteSessionId,
                currentSessionId: this.sessionId ?? null,
                remotePhase: this.normalizeSignalIcePhase(remotePhaseRaw) ?? 'n/a',
                targetPhase: this.icePhase,
            })
            this.sessionId = remoteSessionId
            this.emitDebug(`sync-remote:${source}`)
            return this.sessionId ?? undefined
        }
        if (source === 'candidate' && !this.remoteDescSet) {
            this.dbg.p(`sync-remote-session:${source}`, {
                remoteSessionId,
                currentSessionId: this.sessionId ?? null,
                remotePhase: this.normalizeSignalIcePhase(remotePhaseRaw) ?? 'n/a',
                targetPhase: this.icePhase,
            })
            this.sessionId = remoteSessionId
            this.emitDebug(`sync-remote:${source}`)
            return this.sessionId ?? undefined
        }
        if (source !== 'offer') {
            this.logStaleSessionOnce(source, remoteSessionId)
            return undefined
        }
        const remotePhase = this.normalizeSignalIcePhase(remotePhaseRaw)
        const targetPhase =
            remotePhase && this.hasIcePhase(remotePhase) ? remotePhase : this.icePhase
        this.dbg.p(`sync-remote-session:${source}`, {
            remoteSessionId,
            currentSessionId: this.sessionId ?? null,
            remotePhase: remotePhase ?? 'n/a',
            targetPhase,
        })
        this.sessionId = remoteSessionId
        this.controlledPeerRebuild = true
        try {
            this.makingOffer = false
            this.answering = false
            this.resetNegotiationStateForPeerRebuild()
            this.clearLanFirstTimer()
            this.clearStunOnlyTimer()
            this.clearConnectingWatchdogTimer()
            this.connectingWatchdogGeneration = undefined
            this.cleanupPeerOnly()
            this.icePhase = targetPhase
            this.initPeer()
        } finally {
            this.controlledPeerRebuild = false
        }
        this.emitDebug(`sync-remote:${source}`)
        return this.sessionId ?? undefined
    }

    private buildRtcConfigForPhase(phase: IcePhase): RTCConfiguration {
        if (phase === 'LAN') {
            return {
                ...this.baseRtcConfig,
                iceServers: [],
            }
        }
        if (phase === 'STUN') {
            return {
                ...this.baseRtcConfig,
                iceServers: this.nativeIceServers.map((server) => ({ ...server })),
                iceTransportPolicy: this.baseRtcConfig.iceTransportPolicy ?? 'all',
            }
        }
        if (phase === 'TURN_ENABLED') {
            return {
                ...this.baseRtcConfig,
                iceServers: this.turnOnlyIceServers.map((server) => ({ ...server })),
                iceTransportPolicy: this.baseRtcConfig.iceTransportPolicy ?? 'all',
            }
        }
        return {
            ...this.baseRtcConfig,
            iceServers: this.stunOnlyIceServers.map((server) => ({ ...server })),
            iceTransportPolicy: 'all',
        }
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

    private isAnyDataChannelsOpen(): boolean {
        return this.dcFast?.readyState === 'open' || this.dcReliable?.readyState === 'open'
    }

    private syncPingLifecycle() {
        if (this.phase === 'closing' || this.phase === 'idle' || !this.roomId) {
            this.pingService.pause()
            return
        }
        if (this.isAnyDataChannelsOpen()) {
            this.pingService.start()
            return
        }
        this.pingService.pause()
    }

    private syncNetRttLifecycle() {
        const netRtt = this.netRttService
        if (!netRtt || !this.pc) return
        if (this.phase === 'closing' || this.phase === 'idle' || !this.roomId) {
            netRtt.pause()
            return
        }

        const conn = this.pc.connectionState
        const ice = this.pc.iceConnectionState
        const connected = conn === 'connected' || ice === 'connected' || ice === 'completed'
        if (connected) {
            netRtt.start()
            return
        }

        const closedOrFailed =
            conn === 'disconnected' ||
            conn === 'failed' ||
            conn === 'closed' ||
            ice === 'disconnected' ||
            ice === 'failed' ||
            ice === 'closed'
        if (closedOrFailed) {
            netRtt.stop()
            return
        }

        netRtt.pause()
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
            this.icePhase === 'LAN' ? CONNECTING_WATCHDOG_MS_LAN : CONNECTING_WATCHDOG_MS_PUBLIC
        this.connectingWatchdogTimer = setTimeout(() => {
            void (async () => {
                this.connectingWatchdogTimer = undefined
                if (!this.roomId || !this.pc || this.phase === 'closing' || this.phase === 'idle')
                    return
                if (!this.isCurrentGeneration(generation)) return
                if (this.isConnectedState() || this.areDataChannelsOpen()) return
                if (
                    this.icePhase === 'TURN_ENABLED' &&
                    this.stunWatchdogReconnects >= MAX_STUN_WATCHDOG_RECONNECTS
                ) {
                    return
                }
                if (this.icePhase === 'TURN_ENABLED') this.stunWatchdogReconnects += 1
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
                const hasMissingOrClosedChannels =
                    !this.dcFast ||
                    !this.dcReliable ||
                    this.dcFast.readyState === 'closed' ||
                    this.dcReliable.readyState === 'closed'
                if (hasMissingOrClosedChannels) {
                    this.dbg.p(`dc recovery -> reconnectHard (${reason})`)
                    this.emitDebug('dc-recovery:hard-reconnect')
                    await this.tryHardNow()
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
        this.pendingIce.length = 0
    }

    private transitionToIcePhase(nextPhase: IcePhase, reason: string): boolean {
        if (this.icePhase === nextPhase) return false
        if (!this.hasIcePhase(nextPhase)) return false
        if (nextPhase === 'TURN_ENABLED' && this.turnOnlyIceServers.length === 0) {
            this.dbg.p('skip TURN_ENABLED transition: no TURN servers in config')
            this.emitDebug('turn-enabled-skip:no-turn-servers')
            return false
        }
        const prevPhase = this.icePhase
        this.dbg.p(`${prevPhase} -> ${nextPhase} transition (${reason})`)
        this.emitDebug(`phase-transition:${prevPhase}->${nextPhase}:${reason}`)
        this.icePhase = nextPhase
        this.stunWatchdogReconnects = 0
        this.controlledPeerRebuild = true
        try {
            this.makingOffer = false
            this.answering = false
            this.resetNegotiationStateForPeerRebuild()
            this.clearLanFirstTimer()
            this.clearStunOnlyTimer()
            this.clearConnectingWatchdogTimer()
            this.connectingWatchdogGeneration = undefined
            this.cleanupPeerOnly()
            this.initPeer()
        } finally {
            this.controlledPeerRebuild = false
        }
        this.emitDebug(`phase=${nextPhase}`)
        return true
    }

    private transitionToNextIcePhase(reason: string): boolean {
        const nextPhase = this.getNextIcePhase(this.icePhase)
        if (!nextPhase) {
            if (this.icePhase === 'STUN_ONLY') {
                this.dbg.p('stay on STUN_ONLY: next phase unavailable (no-turn-servers)')
                this.emitDebug('turn-enabled-skip:no-turn-servers')
            }
            return false
        }
        return this.transitionToIcePhase(nextPhase, reason)
    }

    private async publishOfferIfStable(
        generation: number,
        source: 'onnegotiationneeded' | 'bootstrap',
    ) {
        if (!(await this.ensureOwnSlotActive(`send-offer:${source}`))) return
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
            this.remoteDescSet = false
            const offer = await this.pc.createOffer()
            if (!this.isCurrentGeneration(generation) || !this.pc) return
            this.lastLocalOfferSdp = offer.sdp ?? null
            this.dbg.p('created offer', { sdp: sdpHash(offer.sdp) })
            this.dbg.p('SLD(offer) start')
            await this.pc.setLocalDescription(offer)
            if (this.icePhase === 'STUN_ONLY') this.startStunOnlyTimer(generation)
            if (!this.isCurrentGeneration(generation) || !this.pc) return
            const epochChanged = await this.refreshSignalingEpoch()
            if (epochChanged) {
                this.dbg.p('skip offer publish after epoch sync')
                return
            }
            if (!(await this.ensureOwnSlotActive(`send-offer:${source}:publish`))) return
            if (!this.isCurrentGeneration(generation) || !this.pc) return
            const localRoleSessionId = this.getLocalRoleSessionId() ?? this.sessionId
            const signalSeq = this.nextSignalSequence()
            this.dbg.p('signaling-send:offer', {
                sessionId: localRoleSessionId ?? null,
                generation,
                signalSeq,
                phase: this.icePhase,
                source,
            })
            await this.streams.setOffer({
                ...(offer as OfferSDP),
                epoch: this.signalingEpoch,
                pcGeneration: generation,
                gen: generation,
                forGen: signalSeq,
                sessionId: localRoleSessionId ?? undefined,
                forSessionId: localRoleSessionId ?? undefined,
                icePhase: this.icePhase,
            } as OfferSDP)
            this.dbg.p(source === 'bootstrap' ? 'offer published (bootstrap)' : 'offer published')
        } catch (e) {
            if (await this.handleTakeoverWriteError(`send-offer:${source}`, e)) return
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
            this.dbg.p(`LAN timeout -> fallback in ${this.lanFirstTimeoutMs}ms`)
            this.transitionToNextIcePhase('timeout')
        }, this.lanFirstTimeoutMs) as unknown as number
        this.emitDebug('phase=LAN')
    }

    private clearLanFirstTimer() {
        if (!this.lanFirstTimer) return
        clearTimeout(this.lanFirstTimer as unknown as number)
        this.lanFirstTimer = undefined
    }

    private startStunOnlyTimer(
        generation: number,
        delayMs: number = this.stunOnlyTimeoutMs,
        allowCheckingGrace = true,
        allowProgressExtension = true,
    ) {
        if (this.connectionStrategy !== 'LAN_FIRST') return
        if (this.icePhase !== 'STUN_ONLY') return
        if (!this.hasIcePhase('TURN_ENABLED')) return
        const baselineProgressSeq = this.remoteProgressSeq
        this.clearStunOnlyTimer()
        this.stunOnlyTimer = setTimeout(() => {
            if (!this.isCurrentGeneration(generation)) return
            if (!this.roomId || !this.pc || this.phase === 'closing' || this.phase === 'idle')
                return
            if (this.icePhase !== 'STUN_ONLY' || this.isConnectedState()) return
            if (
                this.pc.connectionState === 'connected' ||
                this.pc.iceConnectionState === 'connected'
            )
                return
            const nowMs = Date.now()
            const remoteProgress =
                this.remoteProgressSeq > baselineProgressSeq &&
                nowMs - this.remoteProgressLastAt <= STUN_ONLY_PROGRESS_WINDOW_MS
            if (allowProgressExtension && remoteProgress) {
                this.dbg.p('STUN-only timeout postponed: signaling/ICE progress observed')
                this.startStunOnlyTimer(generation, STUN_ONLY_PROGRESS_EXTENSION_MS, true, false)
                return
            }
            if (allowCheckingGrace && this.pc.iceConnectionState === 'checking') {
                this.dbg.p('STUN-only timeout grace: ICE is checking')
                this.startStunOnlyTimer(
                    generation,
                    STUN_ONLY_CHECKING_GRACE_MS,
                    false,
                    allowProgressExtension,
                )
                return
            }
            if (!this.hasIcePhase('TURN_ENABLED')) {
                this.dbg.p('STUN-only timeout: TURN phase skipped (no-turn-servers)')
                this.emitDebug('turn-enabled-skip:no-turn-servers')
                return
            }
            this.dbg.p(`STUN-only timeout -> TURN_ENABLED (delay=${delayMs}ms)`)
            this.transitionToNextIcePhase('stun-timeout')
        }, delayMs) as unknown as number
    }

    private clearStunOnlyTimer() {
        if (!this.stunOnlyTimer) return
        clearTimeout(this.stunOnlyTimer as unknown as number)
        this.stunOnlyTimer = undefined
    }

    private makeCandidateCountMap(): Record<CandidateType, number> {
        return { host: 0, srflx: 0, relay: 0, unknown: 0 }
    }

    private bumpCandidateCounter(counter: Record<CandidateType, number>, type: CandidateType) {
        counter[type] = (counter[type] ?? 0) + 1
    }

    private mapSelectedPathFromRoute(route: NetRttSnapshot['route']): CandidateType | undefined {
        if (!route) return undefined
        const localType = route.localCandidateType?.toLowerCase()
        const remoteType = route.remoteCandidateType?.toLowerCase()
        if (route.isRelay === true || localType === 'relay' || remoteType === 'relay') {
            return 'relay'
        }
        if (
            localType === 'srflx' ||
            remoteType === 'srflx' ||
            localType === 'prflx' ||
            remoteType === 'prflx'
        ) {
            return 'srflx'
        }
        if (localType === 'host' || remoteType === 'host') {
            return 'host'
        }
        return 'unknown'
    }

    private updateSelectedPathFromNetRtt(snapshot: NetRttSnapshot, source: string) {
        const nextPath = this.mapSelectedPathFromRoute(snapshot.route)
        const diagnosticsReason =
            snapshot.pathReason ?? 'selected ICE candidate pair is not available yet'

        if (!nextPath || nextPath === 'unknown') {
            if (this.selectedPath !== 'unknown') {
                this.selectedPath = 'unknown'
                this.emitDebug('selected-path:unknown')
            }
            const diagnosticsKey = `${this.pcGeneration}:${diagnosticsReason}`
            if (this.selectedPathDiagnosticsKey !== diagnosticsKey) {
                this.selectedPathDiagnosticsKey = diagnosticsKey
                this.dbg.p('selected path unavailable', {
                    source,
                    reason: diagnosticsReason,
                    selectionMethod: snapshot.pathSelectionMethod ?? 'unknown',
                })
            }
            return
        }

        this.selectedPathDiagnosticsKey = null
        if (this.selectedPath === nextPath) return

        this.selectedPath = nextPath
        this.dbg.p('selected path resolved from getStats()', {
            source,
            path: nextPath,
            localType: snapshot.route?.localCandidateType ?? 'unknown',
            remoteType: snapshot.route?.remoteCandidateType ?? 'unknown',
            pairId: snapshot.route?.pairId ?? snapshot.selectedPair?.id ?? null,
            nominated: snapshot.route?.nominated ?? snapshot.selectedPair?.nominated ?? false,
            selectionMethod: snapshot.pathSelectionMethod ?? 'unknown',
        })
        this.emitDebug(`selected-path:${nextPath}`)
    }

    private captureSelectedPath(source: string) {
        const netRtt = this.netRttService
        if (!netRtt) return
        this.updateSelectedPathFromNetRtt(netRtt.getSnapshot(), `${source}:snapshot`)
        void netRtt.refresh().catch(() => {
            this.dbg.p('selected path refresh failed', { source })
        })
    }

    private initPeer(nextSessionId?: string) {
        this.dbg.p('initPeer()')
        this.clearDcRecoveryTimer()
        this.dcRecoveryGeneration = undefined
        this.clearConnectingWatchdogTimer()
        this.connectingWatchdogGeneration = undefined
        this.netRttService?.stop()
        this.netRttService = undefined
        const generation = ++this.pcGeneration
        this.sessionId = nextSessionId ?? this.sessionId ?? createSessionId()
        this.selectedPathDiagnosticsKey = null
        const rtcConfig = this.buildRtcConfigForPhase(this.icePhase)
        const iceSummary = summarizeIceServers(rtcConfig.iceServers ?? [])
        this.pc = new RTCPeerConnection(rtcConfig)
        this.netRttService = createNetRttService({
            peerConnection: this.pc,
            intervalMs: this.netRttIntervalMs,
            onUpdate: (snapshot) => {
                if (!this.isCurrentGeneration(generation)) return
                this.updateSelectedPathFromNetRtt(snapshot, 'net-rtt:update')
                this.emitDebug()
            },
        })
        this.dbg.p('pc-config', {
            gen: generation,
            sessionId: this.sessionId,
            phase: this.icePhase,
            iceTransportPolicy: rtcConfig.iceTransportPolicy ?? 'all',
            stunCount: iceSummary.stunCount,
            turnCount: iceSummary.turnCount,
            urlsSample: iceSummary.urlsSample,
        })

        this.remoteDescSet = false
        this.pendingIce.length = 0
        this.emitDebug('pc-created')
        if (this.icePhase === 'LAN') this.startLanFirstTimer(generation)
        else this.clearLanFirstTimer()
        this.clearStunOnlyTimer()

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
            this.syncNetRttLifecycle()
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
                this.clearStunOnlyTimer()
                this.captureSelectedPath('ice=connected')
                this.scheduleCallerDcRecovery(generation, 'ice=connected')
                this.clearConnectingWatchdogTimer()
                this.connectingWatchdogGeneration = undefined
                this.emitDebug('connected')
            }
            if (s === 'completed') {
                this.clearLanFirstTimer()
                this.clearStunOnlyTimer()
                this.captureSelectedPath('ice=completed')
                this.scheduleCallerDcRecovery(generation, 'ice=completed')
                this.clearConnectingWatchdogTimer()
                this.connectingWatchdogGeneration = undefined
                this.emitDebug('ice=completed')
            }
            if (s === 'checking') this.scheduleCallerConnectingWatchdog(generation, 'ice=checking')
            if (
                this.connectionStrategy === 'LAN_FIRST' &&
                this.role === 'caller' &&
                this.icePhase === 'STUN_ONLY' &&
                s === 'failed'
            ) {
                const transitioned = this.transitionToNextIcePhase(`stun-${s}`)
                if (transitioned) return
            }
            if (
                this.connectionStrategy === 'LAN_FIRST' &&
                this.role === 'caller' &&
                this.icePhase === 'STUN_ONLY' &&
                s === 'disconnected' &&
                this.hasIcePhase('TURN_ENABLED')
            ) {
                this.dbg.p('STUN-only disconnected: wait before TURN_ENABLED transition')
                this.startStunOnlyTimer(generation, STUN_ONLY_CHECKING_GRACE_MS, true)
                return
            }
            if (this.controlledPeerRebuild) return
            if (this.role === 'caller' && s === 'disconnected') this.scheduleSoftThenMaybeHard()
            if (this.role === 'caller' && (s === 'failed' || s === 'closed')) this.tryHardNow()
        })
        this.pc.addEventListener('connectionstatechange', () => {
            if (!this.isCurrentGeneration(generation)) return
            const pc = this.pc
            if (!pc) return
            const st = pc.connectionState
            this.dbg.p(`connection=${st}`)
            this.onConnectionStateChange(st)
            this.emitDebug(`connection=${st}`)
            this.syncNetRttLifecycle()
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
                this.clearStunOnlyTimer()
                this.captureSelectedPath('connection=connected')
                this.scheduleCallerDcRecovery(generation, 'connection=connected')
                this.clearConnectingWatchdogTimer()
                this.connectingWatchdogGeneration = undefined
                this.emitDebug('connected')
            }
            if (st === 'connecting')
                this.scheduleCallerConnectingWatchdog(generation, 'connection=connecting')
            if (
                this.connectionStrategy === 'LAN_FIRST' &&
                this.role === 'caller' &&
                this.icePhase === 'STUN_ONLY' &&
                st === 'failed'
            ) {
                const transitioned = this.transitionToNextIcePhase(`stun-${st}`)
                if (transitioned) return
            }
            if (
                this.connectionStrategy === 'LAN_FIRST' &&
                this.role === 'caller' &&
                this.icePhase === 'STUN_ONLY' &&
                st === 'disconnected' &&
                this.hasIcePhase('TURN_ENABLED')
            ) {
                this.dbg.p(
                    'STUN-only disconnected(connection): wait before TURN_ENABLED transition',
                )
                this.startStunOnlyTimer(generation, STUN_ONLY_CHECKING_GRACE_MS, true)
                return
            }
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
                    this.syncNetRttLifecycle()
                    this.emitDebug('dc-early-open')
                }
            }
        }

        this.pc.onicecandidate = async (ev) => {
            if (!this.isCurrentGeneration(generation)) return
            if (this.takeoverStopping) return
            if (!this.roomId || this.phase === 'closing' || this.phase === 'idle') return
            if (!this.pc || this.pc.signalingState === 'closed') return
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
                const localRoleSessionId = this.getLocalRoleSessionId() ?? this.sessionId
                // Include session marker so remote side can ignore stale ICE
                // after reload/reconnect. Generation is kept only for debug.
                const candidatePayload = {
                    ...ev.candidate.toJSON(),
                    epoch: this.signalingEpoch,
                    pcGeneration: generation,
                    gen: generation,
                    sessionId: localRoleSessionId ?? undefined,
                    icePhase: this.icePhase,
                } as RTCIceCandidateInit & {
                    epoch: number
                    pcGeneration: number
                    gen: number
                    sessionId?: string
                    icePhase: IcePhase
                }
                if (!(await this.ensureOwnSlotActive('send-candidate'))) return
                this.dbg.p('signaling-send:candidate', {
                    sessionId: localRoleSessionId ?? null,
                    generation,
                    type: candidateType,
                    phase: this.icePhase,
                })
                if (this.role === 'caller')
                    await this.streams.addCallerIceCandidate(candidatePayload)
                else await this.streams.addCalleeIceCandidate(candidatePayload)
            } catch (e) {
                if (await this.handleTakeoverWriteError('send-candidate', e)) return
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
            if (!this.isCurrentGeneration(generation)) return
            if (this.takeoverStopping) return
            if (!this.roomId || this.phase === 'closing' || this.phase === 'idle') return
            void this.publishOfferIfStable(generation, 'onnegotiationneeded')
        }

        if (this.role === 'caller') {
            // Fail-safe for very fast reload races where negotiationneeded can be missed.
            void this.publishOfferIfStable(generation, 'bootstrap')
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
            this.syncPingLifecycle()
            this.syncNetRttLifecycle()
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
                if (this.role === 'caller') {
                    this.scheduleCallerDcRecovery(this.pcGeneration, `dc-close:${ch.label}`)
                }
            }
            if (reliable) this.onReliableClose()
            else this.onFastClose()
            this.syncPingLifecycle()
            this.syncNetRttLifecycle()
            this.emitDebug(`dc-close:${ch.label}`)
        }
        ch.onmessage = (ev) => {
            const text = typeof ev.data === 'string' ? ev.data : String(ev.data)
            if (this.pingService.handleIncoming(text)) return
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
            if (this.takeoverStopping) {
                throw this.raiseError(
                    new Error('waitReady aborted after takeover'),
                    RTCErrorCode.INVALID_STATE,
                    'transport',
                    false,
                    'waitReady aborted after takeover',
                    false,
                    { inspect: this.inspect(), timeoutMs },
                )
            }
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
        const hadPc = !!this.pc
        if (hadPc) this.pcGeneration += 1
        this.clearLanFirstTimer()
        this.clearStunOnlyTimer()
        this.clearDcRecoveryTimer()
        this.dcRecoveryGeneration = undefined
        this.clearConnectingWatchdogTimer()
        this.connectingWatchdogGeneration = undefined
        this.pingService.pause()
        this.netRttService?.stop()
        this.netRttService = undefined
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
            if (
                e instanceof RTCError &&
                e.code === RTCErrorCode.WAIT_READY_TIMEOUT &&
                e.phase === 'transport'
            ) {
                return
            }
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
            sessionId: this.sessionId,
            participantId: this.participantId,
            candidateStats: this.candidateStats,
            selectedPath: this.selectedPath,
            ping: this.pingService.getSnapshot(),
            netRtt: this.netRttService
                ? this.netRttService.getSnapshot()
                : createInitialNetRttSnapshot(),
            lastEvent,
            lastError: this.lastErrorText,
        }
        this.onDebug(st)
    }
}
