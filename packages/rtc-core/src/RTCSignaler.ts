// RTCSignaler.ts

import type { Subscription } from 'rxjs'
import type { CandidateType, ConnectionStrategy, IcePhase } from './connection-strategy'
import { type RTCError, RTCErrorCode, type RTCErrorPhase, toRTCError } from './errors'
import {
    DEFAULT_ICE_SERVERS,
    extractStunOnlyIceServers,
    extractTurnOnlyIceServers,
} from './ice-config'
import {
    flushChannelQueue,
    waitForBackpressure,
} from './internal/rtc-signaler/connection/channel-io'
import { ConnectionLifecycleService } from './internal/rtc-signaler/connection/connection-lifecycle-service'
import { PeerNegotiationService } from './internal/rtc-signaler/connection/peer-negotiation-service'
import { PeerRuntimeService } from './internal/rtc-signaler/connection/peer-runtime-service'
import { PeerTransportService } from './internal/rtc-signaler/connection/peer-transport-service'
import { ReadinessService } from './internal/rtc-signaler/connection/readiness-service'
import {
    areBothDataChannelsOpen,
    isAnyDataChannelOpen,
    isConnectedTransportState,
} from './internal/rtc-signaler/connection/transport-state'
import { DebugEmitterService } from './internal/rtc-signaler/debug/debug-emitter-service'
import type { DebugStateSnapshot } from './internal/rtc-signaler/debug/debug-state'
import { createSignalerDebugger } from './internal/rtc-signaler/debug/debug-utils'
import { IcePhaseLifecycleService } from './internal/rtc-signaler/ice/ice-phase-lifecycle-service'
import {
    buildRtcConfigForPhase,
    type IcePhasePolicyContext,
    resolveInitialIcePhase,
} from './internal/rtc-signaler/ice/ice-phase-policy'
import {
    bumpCandidateCounter,
    createCandidateStatsSnapshot,
} from './internal/rtc-signaler/metrics/candidate-stats'
import { MetricsLifecycleService } from './internal/rtc-signaler/metrics/metrics-lifecycle-service'
import { SelectedPathService } from './internal/rtc-signaler/metrics/selected-path-service'
import { RecoveryLifecycleService } from './internal/rtc-signaler/recovery/recovery-lifecycle-service'
import { DEFAULT_STUN_ONLY_TIMEOUT_MS } from './internal/rtc-signaler/recovery/recovery-policy'
import { createRecoveryBackoffState } from './internal/rtc-signaler/recovery/recovery-state'
import { SessionOwnershipService } from './internal/rtc-signaler/session/session-ownership-service'
import { EpochSyncService } from './internal/rtc-signaler/signaling/epoch-sync-service'
import { IncomingSignalService } from './internal/rtc-signaler/signaling/incoming-signal-service'
import type { NetRttService, NetRttSnapshot } from './metrics/netRtt'
import { createPingService, type PingService } from './protocol/ping'
import { createSignalStreams } from './signal-rx'
import type { AnswerSDP, OfferSDP, RoomDoc, SignalDB } from './types'

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

export type DebugState = DebugStateSnapshot

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

    private stunWatchdogReconnects = 0
    private recovery = createRecoveryBackoffState()

    private phase: Phase = 'idle'
    private lastErrorText: string | undefined
    private signalingEpoch = 0
    private sessionId: string | null = null
    private participantId: string | null = null
    private seenRemoteOfferSessions = new Set<string>()
    private readonly connectionStrategy: ConnectionStrategy
    private readonly lanFirstTimeoutMs: number
    private readonly stunOnlyTimeoutMs: number
    private readonly netRttIntervalMs: number
    private icePhase: IcePhase
    private pcGeneration = 0
    private controlledPeerRebuild = false
    private readonly pingService: PingService
    private netRttService?: NetRttService
    private remoteProgressSeq = 0
    private remoteProgressLastAt = 0
    private signalSequence = 0
    private candidateStats = createCandidateStatsSnapshot()

    // --- New: RxJS wrapper over signaling + subscription list ---
    private streams
    private rxSubs: Subscription[] = []
    private readonly epochSyncService: EpochSyncService
    private readonly incomingSignalService: IncomingSignalService
    private readonly icePhaseLifecycleService: IcePhaseLifecycleService
    private readonly connectionLifecycleService: ConnectionLifecycleService
    private readonly debugEmitterService: DebugEmitterService
    private readonly metricsLifecycleService: MetricsLifecycleService
    private readonly peerNegotiationService: PeerNegotiationService
    private readonly peerRuntimeService: PeerRuntimeService
    private readonly peerTransportService: PeerTransportService
    private readonly readinessService: ReadinessService
    private readonly selectedPathService: SelectedPathService
    private readonly recoveryLifecycleService: RecoveryLifecycleService
    private readonly sessionOwnershipService: SessionOwnershipService
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
        this.dbg = createSignalerDebugger({
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
        this.icePhase = resolveInitialIcePhase(
            this.connectionStrategy,
            this.getIcePhasePolicyContext(),
        )

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
        this.epochSyncService = new EpochSyncService(this.createEpochSyncServiceDeps())
        this.incomingSignalService = new IncomingSignalService(
            this.createIncomingSignalServiceDeps(),
        )
        this.icePhaseLifecycleService = new IcePhaseLifecycleService(
            this.createIcePhaseLifecycleServiceDeps(),
        )
        this.connectionLifecycleService = new ConnectionLifecycleService(
            this.createConnectionLifecycleServiceDeps(),
        )
        this.debugEmitterService = new DebugEmitterService(this.createDebugEmitterServiceDeps())
        this.metricsLifecycleService = new MetricsLifecycleService(
            this.createMetricsLifecycleServiceDeps(),
        )
        this.peerNegotiationService = new PeerNegotiationService(
            this.createPeerNegotiationServiceDeps(),
        )
        this.peerRuntimeService = new PeerRuntimeService(this.createPeerRuntimeServiceDeps())
        this.peerTransportService = new PeerTransportService(this.createPeerTransportServiceDeps())
        this.readinessService = new ReadinessService(this.createReadinessServiceDeps())
        this.selectedPathService = new SelectedPathService({
            getPcGeneration: () => this.pcGeneration,
            getNetRttService: () => this.netRttService,
            dbg: this.dbg,
            emitDebug: (lastEvent) => this.emitDebug(lastEvent),
        })
        this.recoveryLifecycleService = new RecoveryLifecycleService(
            this.createRecoveryLifecycleServiceDeps(),
        )
        this.sessionOwnershipService = new SessionOwnershipService({
            signalDb: this.signalDb as SignalDB & {
                getParticipantId?: () => string | null
                getRoleSessionId?: (role: Role) => string | null
            },
            role: this.role,
            getParticipantId: () => this.participantId,
            setParticipantId: (participantId) => {
                this.participantId = participantId
            },
            getSessionId: () => this.sessionId,
            setSessionId: (sessionId) => {
                this.sessionId = sessionId
            },
            getPhase: () => this.phase,
            getRoomId: () => this.roomId,
            dbg: this.dbg,
            emitDebug: (lastEvent) => this.emitDebug(lastEvent),
            onError: (error) => this.onError(error),
            raiseError: (err, fallbackCode, phase, retriable, message, rethrow) =>
                this.raiseError(err, fallbackCode, phase, retriable, message, rethrow),
            hangup: async () => this.hangup(),
        })
        const participantId = (
            this.signalDb as SignalDB & { getParticipantId?: () => string | null }
        ).getParticipantId?.()
        if (participantId) this.participantId = participantId
    }

    private createEpochSyncServiceDeps(): ConstructorParameters<typeof EpochSyncService>[0] {
        const signaler = this
        return {
            get signalingEpoch() {
                return signaler.signalingEpoch
            },
            set signalingEpoch(value) {
                signaler.signalingEpoch = value
            },
            get lastHandledOfferSdp() {
                return signaler.lastHandledOfferSdp
            },
            set lastHandledOfferSdp(value) {
                signaler.lastHandledOfferSdp = value
            },
            get lastHandledAnswerSdp() {
                return signaler.lastHandledAnswerSdp
            },
            set lastHandledAnswerSdp(value) {
                signaler.lastHandledAnswerSdp = value
            },
            get lastSeenOfferSdp() {
                return signaler.lastSeenOfferSdp
            },
            set lastSeenOfferSdp(value) {
                signaler.lastSeenOfferSdp = value
            },
            get lastSeenAnswerSdp() {
                return signaler.lastSeenAnswerSdp
            },
            set lastSeenAnswerSdp(value) {
                signaler.lastSeenAnswerSdp = value
            },
            get lastLocalOfferSdp() {
                return signaler.lastLocalOfferSdp
            },
            set lastLocalOfferSdp(value) {
                signaler.lastLocalOfferSdp = value
            },
            get answering() {
                return signaler.answering
            },
            set answering(value) {
                signaler.answering = value
            },
            get remoteDescSet() {
                return signaler.remoteDescSet
            },
            set remoteDescSet(value) {
                signaler.remoteDescSet = value
            },
            pendingIce: signaler.pendingIce,
            get pc() {
                return signaler.pc
            },
            signalDb: {
                getRoom: async () => signaler.signalDb.getRoom(),
            },
            cleanupPeerOnly: () => signaler.cleanupPeerOnly(),
            initPeer: () => signaler.initPeer(),
            emitDebug: (lastEvent) => signaler.emitDebug(lastEvent),
            acceptEpoch: (epochLike) => signaler.acceptEpoch(epochLike),
            raiseError: (err, fallbackCode, phase, retriable, message) =>
                signaler.raiseError(err, fallbackCode, phase, retriable, message),
        }
    }

    private createDebugEmitterServiceDeps(): ConstructorParameters<typeof DebugEmitterService>[0] {
        const signaler = this
        return {
            get roomId() {
                return signaler.roomId
            },
            role: signaler.role,
            get phase() {
                return signaler.phase
            },
            get makingOffer() {
                return signaler.makingOffer
            },
            polite: signaler.polite,
            get pc() {
                return signaler.pc
            },
            get dcFast() {
                return signaler.dcFast
            },
            get dcReliable() {
                return signaler.dcReliable
            },
            get pendingIce() {
                return signaler.pendingIce
            },
            get recovery() {
                return signaler.recovery
            },
            isSoftTimerPending: () => signaler.recoveryLifecycleService.isSoftTimerPending(),
            isHardTimerPending: () => signaler.recoveryLifecycleService.isHardTimerPending(),
            connectionStrategy: signaler.connectionStrategy,
            get icePhase() {
                return signaler.icePhase
            },
            get pcGeneration() {
                return signaler.pcGeneration
            },
            get sessionId() {
                return signaler.sessionId
            },
            get participantId() {
                return signaler.participantId
            },
            get candidateStats() {
                return signaler.candidateStats
            },
            getSelectedPath: () => signaler.getSelectedPath(),
            getTakeoverBySessionId: () => signaler.getTakeoverBySessionId(),
            pingService: signaler.pingService,
            get netRttService() {
                return signaler.netRttService
            },
            get lastErrorText() {
                return signaler.lastErrorText
            },
            onDebug: (state) => signaler.onDebug(state),
            dbg: signaler.dbg,
        }
    }

    private createConnectionLifecycleServiceDeps(): ConstructorParameters<
        typeof ConnectionLifecycleService
    >[0] {
        const signaler = this
        return {
            dbg: signaler.dbg,
            role: signaler.role,
            signalDb: {
                createRoom: async () => signaler.signalDb.createRoom(),
                getRoom: async () => signaler.signalDb.getRoom(),
                joinRoom: async (id, role) => signaler.signalDb.joinRoom(id, role),
                leaveRoom: async (role) => signaler.signalDb.leaveRoom?.(role),
                endRoom: async () => signaler.signalDb.endRoom(),
            },
            get roomId() {
                return signaler.roomId
            },
            set roomId(value) {
                signaler.roomId = value
            },
            get signalingEpoch() {
                return signaler.signalingEpoch
            },
            set signalingEpoch(value) {
                signaler.signalingEpoch = value
            },
            get participantId() {
                return signaler.participantId
            },
            get sessionId() {
                return signaler.sessionId
            },
            get phase() {
                return signaler.phase
            },
            set phase(value) {
                signaler.phase = value
            },
            get connectedOrSubbed() {
                return signaler.connectedOrSubbed
            },
            set connectedOrSubbed(value) {
                signaler.connectedOrSubbed = value
            },
            resetSelectedPath: () => signaler.resetSelectedPath(),
            seenRemoteOfferSessions: signaler.seenRemoteOfferSessions,
            get stunWatchdogReconnects() {
                return signaler.stunWatchdogReconnects
            },
            set stunWatchdogReconnects(value) {
                signaler.stunWatchdogReconnects = value
            },
            resetSessionOwnershipState: () => signaler.resetSessionOwnershipState(),
            clearTakeoverBySessionId: () => signaler.clearTakeoverBySessionId(),
            isTakeoverStopping: () => signaler.isTakeoverStopping(),
            get remoteProgressSeq() {
                return signaler.remoteProgressSeq
            },
            set remoteProgressSeq(value) {
                signaler.remoteProgressSeq = value
            },
            get remoteProgressLastAt() {
                return signaler.remoteProgressLastAt
            },
            set remoteProgressLastAt(value) {
                signaler.remoteProgressLastAt = value
            },
            get signalSequence() {
                return signaler.signalSequence
            },
            set signalSequence(value) {
                signaler.signalSequence = value
            },
            pingService: signaler.pingService,
            get netRttService() {
                return signaler.netRttService
            },
            get candidateStats() {
                return signaler.candidateStats
            },
            set candidateStats(value) {
                signaler.candidateStats = value
            },
            connectionStrategy: signaler.connectionStrategy,
            get icePhase() {
                return signaler.icePhase
            },
            set icePhase(value) {
                signaler.icePhase = value
            },
            get makingOffer() {
                return signaler.makingOffer
            },
            set makingOffer(value) {
                signaler.makingOffer = value
            },
            get remoteDescSet() {
                return signaler.remoteDescSet
            },
            set remoteDescSet(value) {
                signaler.remoteDescSet = value
            },
            get lastLocalOfferSdp() {
                return signaler.lastLocalOfferSdp
            },
            set lastLocalOfferSdp(value) {
                signaler.lastLocalOfferSdp = value
            },
            get pcGeneration() {
                return signaler.pcGeneration
            },
            get controlledPeerRebuild() {
                return signaler.controlledPeerRebuild
            },
            set controlledPeerRebuild(value) {
                signaler.controlledPeerRebuild = value
            },
            defaultWaitReadyTimeoutMs: signaler.defaultWaitReadyTimeoutMs,
            streams: {
                setOffer: async (payload) =>
                    signaler.streams.setOffer(
                        payload as Parameters<typeof signaler.streams.setOffer>[0],
                    ),
            },
            rxSubs: signaler.rxSubs,
            get unsubscribes() {
                return signaler.unsubscribes
            },
            set unsubscribes(value) {
                signaler.unsubscribes = value
            },
            get pc() {
                return signaler.pc
            },
            syncIdentityFromRoom: (room) => signaler.syncIdentityFromRoom(room),
            emitDebug: (lastEvent) => signaler.emitDebug(lastEvent),
            onError: (error) => signaler.onError(error),
            raiseError: (err, fallbackCode, phase, retriable, message, rethrow) =>
                signaler.raiseError(err, fallbackCode, phase, retriable, message, rethrow),
            clearLanFirstTimer: () => signaler.clearLanFirstTimer(),
            clearStunOnlyTimer: () => signaler.clearStunOnlyTimer(),
            getIcePhasePolicyContext: () => signaler.getIcePhasePolicyContext(),
            initPeer: () => signaler.initPeer(),
            attachSignalingSubscriptions: () => signaler.attachSignalingSubscriptions(),
            ensureOwnSlotActive: async (source) => signaler.ensureOwnSlotActive(source),
            startStunOnlyTimer: (generation) => signaler.startStunOnlyTimer(generation),
            refreshSignalingEpoch: async () => signaler.refreshSignalingEpoch(),
            getLocalRoleSessionId: () => signaler.getLocalRoleSessionId(),
            nextSignalSequence: () => signaler.nextSignalSequence(),
            handleTakeoverWriteError: async (source, error) =>
                signaler.handleTakeoverWriteError(source, error),
            resetNegotiationStateForPeerRebuild: () =>
                signaler.resetNegotiationStateForPeerRebuild(),
            cleanupPeerOnly: () => signaler.cleanupPeerOnly(),
            waitReady: async (opts) => signaler.waitReady(opts),
            clearRecoveryTimers: () => signaler.clearRecoveryTimers(),
            reconnectSoft: async () => signaler.reconnectSoft(),
            hangup: async () => signaler.hangup(),
        }
    }

    private createIcePhaseLifecycleServiceDeps(): ConstructorParameters<
        typeof IcePhaseLifecycleService
    >[0] {
        const signaler = this
        return {
            connectionStrategy: signaler.connectionStrategy,
            role: signaler.role,
            turnOnlyIceServers: signaler.turnOnlyIceServers,
            get icePhase() {
                return signaler.icePhase
            },
            set icePhase(value) {
                signaler.icePhase = value
            },
            lanFirstTimeoutMs: signaler.lanFirstTimeoutMs,
            stunOnlyTimeoutMs: signaler.stunOnlyTimeoutMs,
            get roomId() {
                return signaler.roomId
            },
            get phase() {
                return signaler.phase
            },
            get stunWatchdogReconnects() {
                return signaler.stunWatchdogReconnects
            },
            set stunWatchdogReconnects(value) {
                signaler.stunWatchdogReconnects = value
            },
            get remoteProgressSeq() {
                return signaler.remoteProgressSeq
            },
            get remoteProgressLastAt() {
                return signaler.remoteProgressLastAt
            },
            get makingOffer() {
                return signaler.makingOffer
            },
            set makingOffer(value) {
                signaler.makingOffer = value
            },
            get answering() {
                return signaler.answering
            },
            set answering(value) {
                signaler.answering = value
            },
            get controlledPeerRebuild() {
                return signaler.controlledPeerRebuild
            },
            set controlledPeerRebuild(value) {
                signaler.controlledPeerRebuild = value
            },
            get pc() {
                return signaler.pc
            },
            dbg: signaler.dbg,
            emitDebug: (lastEvent) => signaler.emitDebug(lastEvent),
            getIcePhasePolicyContext: () => signaler.getIcePhasePolicyContext(),
            resetNegotiationStateForPeerRebuild: () =>
                signaler.resetNegotiationStateForPeerRebuild(),
            clearConnectingWatchdogTimer: () => signaler.clearConnectingWatchdogTimer(),
            cleanupPeerOnly: () => signaler.cleanupPeerOnly(),
            initPeer: () => signaler.initPeer(),
            isCurrentGeneration: (generation) => signaler.isCurrentGeneration(generation),
            isConnectedState: () => signaler.isConnectedState(),
        }
    }

    private createMetricsLifecycleServiceDeps(): ConstructorParameters<
        typeof MetricsLifecycleService
    >[0] {
        const signaler = this
        return {
            get phase() {
                return signaler.phase
            },
            get roomId() {
                return signaler.roomId
            },
            isAnyDataChannelsOpen: () => signaler.isAnyDataChannelsOpen(),
            pingService: signaler.pingService,
            get netRttService() {
                return signaler.netRttService
            },
            get pc() {
                return signaler.pc
            },
        }
    }

    private createRecoveryLifecycleServiceDeps(): ConstructorParameters<
        typeof RecoveryLifecycleService
    >[0] {
        const signaler = this
        return {
            get pc() {
                return signaler.pc
            },
            get roomId() {
                return signaler.roomId
            },
            role: signaler.role,
            get phase() {
                return signaler.phase
            },
            set phase(value) {
                signaler.phase = value
            },
            defaultWaitReadyTimeoutMs: signaler.defaultWaitReadyTimeoutMs,
            get icePhase() {
                return signaler.icePhase
            },
            get stunWatchdogReconnects() {
                return signaler.stunWatchdogReconnects
            },
            set stunWatchdogReconnects(value) {
                signaler.stunWatchdogReconnects = value
            },
            get makingOffer() {
                return signaler.makingOffer
            },
            get dcFast() {
                return signaler.dcFast
            },
            get dcReliable() {
                return signaler.dcReliable
            },
            get recovery() {
                return signaler.recovery
            },
            set recovery(value) {
                signaler.recovery = value
            },
            dbg: signaler.dbg,
            emitDebug: (lastEvent) => signaler.emitDebug(lastEvent),
            onError: (error) => signaler.onError(error),
            raiseError: (err, fallbackCode, phase, retriable, message, rethrow) =>
                signaler.raiseError(err, fallbackCode, phase, retriable, message, rethrow),
            reconnectSoft: async () => signaler.reconnectSoft(),
            reconnectHard: async (opts) => signaler.reconnectHard(opts),
            clearConnectingWatchdogTimer: () => signaler.clearConnectingWatchdogTimer(),
            isCurrentGeneration: (generation) => signaler.isCurrentGeneration(generation),
            isConnectedState: () => signaler.isConnectedState(),
            areDataChannelsOpen: () => signaler.areDataChannelsOpen(),
        }
    }

    private createPeerNegotiationServiceDeps(): ConstructorParameters<
        typeof PeerNegotiationService
    >[0] {
        const signaler = this
        return {
            get pc() {
                return signaler.pc
            },
            set pc(value) {
                signaler.pc = value
            },
            role: signaler.role,
            get phase() {
                return signaler.phase
            },
            set phase(value) {
                signaler.phase = value
            },
            get roomId() {
                return signaler.roomId
            },
            isTakeoverStopping: () => signaler.isTakeoverStopping(),
            get makingOffer() {
                return signaler.makingOffer
            },
            set makingOffer(value) {
                signaler.makingOffer = value
            },
            get remoteDescSet() {
                return signaler.remoteDescSet
            },
            set remoteDescSet(value) {
                signaler.remoteDescSet = value
            },
            get lastLocalOfferSdp() {
                return signaler.lastLocalOfferSdp
            },
            set lastLocalOfferSdp(value) {
                signaler.lastLocalOfferSdp = value
            },
            get icePhase() {
                return signaler.icePhase
            },
            get signalingEpoch() {
                return signaler.signalingEpoch
            },
            get sessionId() {
                return signaler.sessionId
            },
            get candidateStats() {
                return signaler.candidateStats
            },
            set candidateStats(value) {
                signaler.candidateStats = value
            },
            streams: {
                setOffer: async (payload) =>
                    signaler.streams.setOffer(
                        payload as Parameters<typeof signaler.streams.setOffer>[0],
                    ),
                addCallerIceCandidate: async (payload) =>
                    signaler.streams.addCallerIceCandidate(
                        payload as Parameters<typeof signaler.streams.addCallerIceCandidate>[0],
                    ),
                addCalleeIceCandidate: async (payload) =>
                    signaler.streams.addCalleeIceCandidate(
                        payload as Parameters<typeof signaler.streams.addCalleeIceCandidate>[0],
                    ),
            },
            dbg: signaler.dbg,
            emitDebug: (lastEvent) => signaler.emitDebug(lastEvent),
            onError: (error) => signaler.onError(error),
            isCurrentGeneration: (generation) => signaler.isCurrentGeneration(generation),
            ensureOwnSlotActive: (source) => signaler.ensureOwnSlotActive(source),
            startStunOnlyTimer: (generation) => signaler.startStunOnlyTimer(generation),
            refreshSignalingEpoch: async () => signaler.refreshSignalingEpoch(),
            getLocalRoleSessionId: () => signaler.getLocalRoleSessionId(),
            nextSignalSequence: () => signaler.nextSignalSequence(),
            handleTakeoverWriteError: async (source, error) =>
                signaler.handleTakeoverWriteError(source, error),
            bumpCandidateCounter: (counter, type) => signaler.bumpCandidateCounter(counter, type),
            raiseError: (err, fallbackCode, phase, retriable, message, rethrow) =>
                signaler.raiseError(err, fallbackCode, phase, retriable, message, rethrow),
        }
    }

    private createPeerRuntimeServiceDeps(): ConstructorParameters<typeof PeerRuntimeService>[0] {
        const signaler = this
        return {
            dbg: signaler.dbg,
            get pc() {
                return signaler.pc
            },
            set pc(value) {
                signaler.pc = value
            },
            get sessionId() {
                return signaler.sessionId
            },
            set sessionId(value) {
                signaler.sessionId = value
            },
            get pcGeneration() {
                return signaler.pcGeneration
            },
            set pcGeneration(value) {
                signaler.pcGeneration = value
            },
            get icePhase() {
                return signaler.icePhase
            },
            netRttIntervalMs: signaler.netRttIntervalMs,
            get netRttService() {
                return signaler.netRttService
            },
            set netRttService(value) {
                signaler.netRttService = value
            },
            get remoteDescSet() {
                return signaler.remoteDescSet
            },
            set remoteDescSet(value) {
                signaler.remoteDescSet = value
            },
            pendingIce: signaler.pendingIce,
            get dcFast() {
                return signaler.dcFast
            },
            set dcFast(value) {
                signaler.dcFast = value
            },
            get dcReliable() {
                return signaler.dcReliable
            },
            set dcReliable(value) {
                signaler.dcReliable = value
            },
            get peerTransportService() {
                return signaler.peerTransportService
            },
            get peerNegotiationService() {
                return signaler.peerNegotiationService
            },
            pingService: signaler.pingService,
            emitDebug: (lastEvent) => signaler.emitDebug(lastEvent),
            clearDcRecoveryTimer: () => signaler.clearDcRecoveryTimer(),
            clearConnectingWatchdogTimer: () => signaler.clearConnectingWatchdogTimer(),
            buildRtcConfigForPhase: (phase) => signaler.buildRtcConfigForPhase(phase),
            isCurrentGeneration: (generation) => signaler.isCurrentGeneration(generation),
            updateSelectedPathFromNetRtt: (snapshot, source) =>
                signaler.updateSelectedPathFromNetRtt(snapshot, source),
            resetSelectedPathDiagnosticsKey: () => signaler.resetSelectedPathDiagnosticsKey(),
            startLanFirstTimer: (generation) => signaler.startLanFirstTimer(generation),
            clearLanFirstTimer: () => signaler.clearLanFirstTimer(),
            clearStunOnlyTimer: () => signaler.clearStunOnlyTimer(),
        }
    }

    private createPeerTransportServiceDeps(): ConstructorParameters<
        typeof PeerTransportService
    >[0] {
        const signaler = this
        return {
            get pc() {
                return signaler.pc
            },
            role: signaler.role,
            connectionStrategy: signaler.connectionStrategy,
            get icePhase() {
                return signaler.icePhase
            },
            get roomId() {
                return signaler.roomId
            },
            get phase() {
                return signaler.phase
            },
            set phase(value) {
                signaler.phase = value
            },
            get controlledPeerRebuild() {
                return signaler.controlledPeerRebuild
            },
            fastLabel: signaler.fastLabel,
            reliableLabel: signaler.reliableLabel,
            fastInit: signaler.fastInit,
            reliableInit: signaler.reliableInit,
            fastBALow: signaler.fastBALow,
            reliableBALow: signaler.reliableBALow,
            fastQueue: signaler.fastQueue,
            reliableQueue: signaler.reliableQueue,
            fastOpenWaiters: signaler.fastOpenWaiters,
            reliableOpenWaiters: signaler.reliableOpenWaiters,
            get dcFast() {
                return signaler.dcFast
            },
            set dcFast(value) {
                signaler.dcFast = value
            },
            get dcReliable() {
                return signaler.dcReliable
            },
            set dcReliable(value) {
                signaler.dcReliable = value
            },
            get pcGeneration() {
                return signaler.pcGeneration
            },
            get recovery() {
                return signaler.recovery
            },
            set recovery(value) {
                signaler.recovery = value
            },
            get stunWatchdogReconnects() {
                return signaler.stunWatchdogReconnects
            },
            set stunWatchdogReconnects(value) {
                signaler.stunWatchdogReconnects = value
            },
            pingService: signaler.pingService,
            dbg: signaler.dbg,
            onConnectionStateChange: (state) => signaler.onConnectionStateChange(state),
            onReliableOpen: () => signaler.onReliableOpen(),
            onFastOpen: () => signaler.onFastOpen(),
            onReliableClose: () => signaler.onReliableClose(),
            onFastClose: () => signaler.onFastClose(),
            onMessage: (text, meta) => signaler.onMessage(text, meta),
            emitDebug: (lastEvent) => signaler.emitDebug(lastEvent),
            syncNetRttLifecycle: () => signaler.syncNetRttLifecycle(),
            syncPingLifecycle: () => signaler.syncPingLifecycle(),
            clearRecoveryTimers: () => signaler.clearRecoveryTimers(),
            clearLanFirstTimer: () => signaler.clearLanFirstTimer(),
            clearStunOnlyTimer: () => signaler.clearStunOnlyTimer(),
            startStunOnlyTimer: (generation, delayMs, allowCheckingGrace, allowProgressExtension) =>
                signaler.startStunOnlyTimer(
                    generation,
                    delayMs,
                    allowCheckingGrace,
                    allowProgressExtension,
                ),
            captureSelectedPath: (source) => signaler.captureSelectedPath(source),
            scheduleCallerDcRecovery: (generation, reason) =>
                signaler.scheduleCallerDcRecovery(generation, reason),
            clearConnectingWatchdogTimer: () => signaler.clearConnectingWatchdogTimer(),
            scheduleCallerConnectingWatchdog: (generation, reason) =>
                signaler.scheduleCallerConnectingWatchdog(generation, reason),
            transitionToNextIcePhase: (reason) => signaler.transitionToNextIcePhase(reason),
            scheduleSoftThenMaybeHard: () => signaler.scheduleSoftThenMaybeHard(),
            tryHardNow: async () => signaler.tryHardNow(),
            clearDcRecoveryTimer: () => signaler.clearDcRecoveryTimer(),
            areDataChannelsOpen: () => signaler.areDataChannelsOpen(),
            isCurrentGeneration: (generation) => signaler.isCurrentGeneration(generation),
            isActive: () => signaler.isActive(),
            getIcePhasePolicyContext: () => signaler.getIcePhasePolicyContext(),
        }
    }

    private createIncomingSignalServiceDeps(): ConstructorParameters<
        typeof IncomingSignalService
    >[0] {
        const signaler = this
        return {
            role: signaler.role,
            streams: {
                callerIce$: signaler.streams.callerIce$,
                calleeIce$: signaler.streams.calleeIce$,
                offer$: {
                    subscribe: (next) =>
                        signaler.streams.offer$.subscribe((value) => {
                            if (value.type !== 'offer') return
                            void next(value as OfferSDP)
                        }),
                },
                answer$: {
                    subscribe: (next) =>
                        signaler.streams.answer$.subscribe((value) => {
                            if (value.type !== 'answer') return
                            void next(value as AnswerSDP)
                        }),
                },
                setAnswer: async (payload) =>
                    signaler.streams.setAnswer(
                        payload as Parameters<typeof signaler.streams.setAnswer>[0],
                    ),
            },
            rxSubs: signaler.rxSubs,
            connectionStrategy: signaler.connectionStrategy,
            get sessionId() {
                return signaler.sessionId
            },
            set sessionId(value) {
                signaler.sessionId = value
            },
            get signalingEpoch() {
                return signaler.signalingEpoch
            },
            get icePhase() {
                return signaler.icePhase
            },
            set icePhase(value) {
                signaler.icePhase = value
            },
            get phase() {
                return signaler.phase
            },
            set phase(value) {
                signaler.phase = value
            },
            get makingOffer() {
                return signaler.makingOffer
            },
            set makingOffer(value) {
                signaler.makingOffer = value
            },
            polite: signaler.polite,
            get remoteDescSet() {
                return signaler.remoteDescSet
            },
            set remoteDescSet(value) {
                signaler.remoteDescSet = value
            },
            get answering() {
                return signaler.answering
            },
            set answering(value) {
                signaler.answering = value
            },
            get pcGeneration() {
                return signaler.pcGeneration
            },
            get lastLocalOfferSdp() {
                return signaler.lastLocalOfferSdp
            },
            get lastSeenOfferSdp() {
                return signaler.lastSeenOfferSdp
            },
            set lastSeenOfferSdp(value) {
                signaler.lastSeenOfferSdp = value
            },
            get lastHandledOfferSdp() {
                return signaler.lastHandledOfferSdp
            },
            set lastHandledOfferSdp(value) {
                signaler.lastHandledOfferSdp = value
            },
            get lastSeenAnswerSdp() {
                return signaler.lastSeenAnswerSdp
            },
            set lastSeenAnswerSdp(value) {
                signaler.lastSeenAnswerSdp = value
            },
            get lastHandledAnswerSdp() {
                return signaler.lastHandledAnswerSdp
            },
            set lastHandledAnswerSdp(value) {
                signaler.lastHandledAnswerSdp = value
            },
            seenRemoteOfferSessions: signaler.seenRemoteOfferSessions,
            get controlledPeerRebuild() {
                return signaler.controlledPeerRebuild
            },
            set controlledPeerRebuild(value) {
                signaler.controlledPeerRebuild = value
            },
            pendingIce: signaler.pendingIce,
            get pc() {
                return signaler.pc
            },
            get candidateStats() {
                return signaler.candidateStats
            },
            dbg: signaler.dbg,
            emitDebug: (lastEvent) => signaler.emitDebug(lastEvent),
            onError: (error) => signaler.onError(error),
            acceptEpoch: (epochLike) => signaler.acceptEpoch(epochLike),
            isCurrentRemoteRoleSession: async (remoteSessionId) =>
                signaler.isCurrentRemoteRoleSession(remoteSessionId),
            logStaleSessionOnce: (source, remoteSessionId) =>
                signaler.logStaleSessionOnce(source, remoteSessionId),
            transitionToNextIcePhase: (reason) => signaler.transitionToNextIcePhase(reason),
            bumpCandidateCounter: (counter, type) => signaler.bumpCandidateCounter(counter, type),
            markRemoteProgress: () => signaler.markRemoteProgress(),
            raiseError: (err, fallbackCode, phase, retriable, message, rethrow) =>
                signaler.raiseError(err, fallbackCode, phase, retriable, message, rethrow),
            drainPendingIceCandidates: async () => signaler.drainPendingIceCandidates(),
            isCurrentGeneration: (generation) => signaler.isCurrentGeneration(generation),
            startStunOnlyTimer: (generation) => signaler.startStunOnlyTimer(generation),
            refreshSignalingEpoch: async () => signaler.refreshSignalingEpoch(),
            ensureOwnSlotActive: async (source) => signaler.ensureOwnSlotActive(source),
            getLocalRoleSessionId: () => signaler.getLocalRoleSessionId(),
            nextSignalSequence: () => signaler.nextSignalSequence(),
            handleTakeoverWriteError: async (source, error) =>
                signaler.handleTakeoverWriteError(source, error),
            tryHardNow: async () => signaler.tryHardNow(),
            getIcePhasePolicyContext: () => signaler.getIcePhasePolicyContext(),
            resetNegotiationStateForPeerRebuild: () =>
                signaler.resetNegotiationStateForPeerRebuild(),
            clearLanFirstTimer: () => signaler.clearLanFirstTimer(),
            clearStunOnlyTimer: () => signaler.clearStunOnlyTimer(),
            clearConnectingWatchdogTimer: () => signaler.clearConnectingWatchdogTimer(),
            cleanupPeerOnly: () => signaler.cleanupPeerOnly(),
            initPeer: () => signaler.initPeer(),
        }
    }

    private createReadinessServiceDeps(): ConstructorParameters<typeof ReadinessService>[0] {
        const signaler = this
        return {
            get pc() {
                return signaler.pc
            },
            get dcFast() {
                return signaler.dcFast
            },
            get dcReliable() {
                return signaler.dcReliable
            },
            defaultWaitReadyTimeoutMs: signaler.defaultWaitReadyTimeoutMs,
            isTakeoverStopping: () => signaler.isTakeoverStopping(),
            raiseError: (err, fallbackCode, phase, retriable, message, rethrow, details) =>
                signaler.raiseError(err, fallbackCode, phase, retriable, message, rethrow, details),
        }
    }

    // ————————————————————————————————————————————————————————————————
    // Public API
    // ————————————————————————————————————————————————————————————————

    async createRoom(): Promise<string> {
        return this.connectionLifecycleService.createRoom()
    }

    async joinRoom(id: string): Promise<void> {
        await this.connectionLifecycleService.joinRoom(id)
    }

    async connect(): Promise<void> {
        await this.connectionLifecycleService.connect()
    }

    private attachSignalingSubscriptions() {
        this.incomingSignalService.attachSignalingSubscriptions()
    }

    private async drainPendingIceCandidates() {
        while (this.pendingIce.length) {
            const candidate = this.pendingIce.shift()
            if (!candidate) continue
            try {
                await this.pc?.addIceCandidate(candidate)
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
    }

    async sendFast(text: string) {
        if (this.dcFast && this.dcFast.readyState === 'open') {
            await waitForBackpressure(this.dcFast, this.fastBALow)
            this.dcFast.send(text)
            return
        }
        this.fastQueue.push(text)
        const ch = await this.waitChannelReady(false)
        await waitForBackpressure(ch, this.fastBALow)
        flushChannelQueue(ch, this.fastQueue)
    }

    async sendReliable(text: string) {
        if (this.dcReliable && this.dcReliable.readyState === 'open') {
            await waitForBackpressure(this.dcReliable, this.reliableBALow)
            this.dcReliable.send(text)
            return
        }
        this.reliableQueue.push(text)
        const ch = await this.waitChannelReady(true)
        await waitForBackpressure(ch, this.reliableBALow)
        flushChannelQueue(ch, this.reliableQueue)
    }

    async reconnectSoft(): Promise<void> {
        await this.connectionLifecycleService.reconnectSoft()
    }

    async reconnectHard(opts: { awaitReadyMs?: number } = {}) {
        await this.connectionLifecycleService.reconnectHard(opts)
    }

    async hangup(): Promise<void> {
        await this.connectionLifecycleService.hangup()
    }

    async endRoom(): Promise<void> {
        await this.connectionLifecycleService.endRoom()
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

    private getIcePhasePolicyContext(): IcePhasePolicyContext {
        return {
            baseRtcConfig: this.baseRtcConfig,
            nativeIceServers: this.nativeIceServers,
            stunOnlyIceServers: this.stunOnlyIceServers,
            turnOnlyIceServers: this.turnOnlyIceServers,
        }
    }

    private syncIdentityFromRoom(room: RoomDoc | null | undefined) {
        this.sessionOwnershipService.syncIdentityFromRoom(room)
    }

    private async isCurrentRemoteRoleSession(remoteSessionId: string): Promise<boolean> {
        return this.sessionOwnershipService.isCurrentRemoteRoleSession(remoteSessionId)
    }

    private logStaleSessionOnce(
        source: 'offer' | 'answer' | 'candidate',
        remoteSessionId: string | undefined,
    ) {
        this.sessionOwnershipService.logStaleSessionOnce(source, remoteSessionId)
    }

    private async handleTakeoverWriteError(source: string, error: unknown): Promise<boolean> {
        return this.sessionOwnershipService.handleTakeoverWriteError(source, error)
    }

    private getLocalRoleSessionId(): string | null {
        return this.sessionOwnershipService.getLocalRoleSessionId()
    }

    private async ensureOwnSlotActive(source: string): Promise<boolean> {
        return this.sessionOwnershipService.ensureOwnSlotActive(source)
    }

    private markRemoteProgress() {
        this.remoteProgressSeq += 1
        this.remoteProgressLastAt = Date.now()
    }

    private nextSignalSequence(): number {
        this.signalSequence += 1
        return this.signalSequence
    }

    private buildRtcConfigForPhase(phase: IcePhase): RTCConfiguration {
        return buildRtcConfigForPhase(phase, this.getIcePhasePolicyContext())
    }

    private isCurrentGeneration(generation: number): boolean {
        return this.pcGeneration === generation
    }

    private isConnectedState(): boolean {
        return isConnectedTransportState(this.pc?.connectionState, this.pc?.iceConnectionState)
    }

    private areDataChannelsOpen(): boolean {
        return areBothDataChannelsOpen(this.dcFast, this.dcReliable)
    }

    private isAnyDataChannelsOpen(): boolean {
        return isAnyDataChannelOpen(this.dcFast, this.dcReliable)
    }

    private resetSelectedPath() {
        this.selectedPathService.resetSelection()
    }

    private resetSelectedPathDiagnosticsKey() {
        this.selectedPathService.resetDiagnosticsKey()
    }

    private getSelectedPath(): CandidateType | undefined {
        return this.selectedPathService.getSelectedPath()
    }

    private resetSessionOwnershipState() {
        this.sessionOwnershipService.resetForConnect()
    }

    private isTakeoverStopping(): boolean {
        return this.sessionOwnershipService.isTakeoverStopping()
    }

    private clearTakeoverBySessionId() {
        this.sessionOwnershipService.clearTakeoverBySessionId()
    }

    private getTakeoverBySessionId(): string | null {
        return this.sessionOwnershipService.getTakeoverBySessionId()
    }

    private syncPingLifecycle() {
        this.metricsLifecycleService.syncPingLifecycle()
    }

    private syncNetRttLifecycle() {
        this.metricsLifecycleService.syncNetRttLifecycle()
    }

    private clearDcRecoveryTimer() {
        this.recoveryLifecycleService.clearDcRecoveryTimer()
    }

    private clearConnectingWatchdogTimer() {
        this.recoveryLifecycleService.clearConnectingWatchdogTimer()
    }

    private scheduleCallerConnectingWatchdog(generation: number, reason: string) {
        this.recoveryLifecycleService.scheduleCallerConnectingWatchdog(generation, reason)
    }

    private scheduleCallerDcRecovery(generation: number, reason: string) {
        this.recoveryLifecycleService.scheduleCallerDcRecovery(generation, reason)
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

    private transitionToNextIcePhase(reason: string): boolean {
        return this.icePhaseLifecycleService.transitionToNextIcePhase(reason)
    }

    private startLanFirstTimer(generation: number) {
        this.icePhaseLifecycleService.startLanFirstTimer(generation)
    }

    private clearLanFirstTimer() {
        this.icePhaseLifecycleService.clearLanFirstTimer()
    }

    private startStunOnlyTimer(
        generation: number,
        delayMs: number = this.stunOnlyTimeoutMs,
        allowCheckingGrace = true,
        allowProgressExtension = true,
    ) {
        this.icePhaseLifecycleService.startStunOnlyTimer(
            generation,
            delayMs,
            allowCheckingGrace,
            allowProgressExtension,
        )
    }

    private clearStunOnlyTimer() {
        this.icePhaseLifecycleService.clearStunOnlyTimer()
    }

    private bumpCandidateCounter(counter: Record<CandidateType, number>, type: CandidateType) {
        bumpCandidateCounter(counter, type)
    }

    private updateSelectedPathFromNetRtt(snapshot: NetRttSnapshot, source: string) {
        this.selectedPathService.updateSelectedPathFromNetRtt(snapshot, source)
    }

    private captureSelectedPath(source: string) {
        this.selectedPathService.captureSelectedPath(source)
    }

    private initPeer(nextSessionId?: string) {
        this.peerRuntimeService.initPeer(nextSessionId)
    }

    private waitChannelReady(reliable: boolean): Promise<RTCDataChannel> {
        return this.peerTransportService.waitChannelReady(reliable)
    }

    async waitReady(opts: { timeoutMs?: number } = {}) {
        await this.readinessService.waitReady(opts)
    }

    inspect() {
        return this.readinessService.inspect()
    }

    private cleanupPeerOnly() {
        this.peerRuntimeService.cleanupPeerOnly()
    }

    private isActive() {
        return this.recoveryLifecycleService.isActive()
    }

    private clearRecoveryTimers() {
        this.recoveryLifecycleService.clearRecoveryTimers()
    }

    private scheduleSoftThenMaybeHard() {
        this.recoveryLifecycleService.scheduleSoftThenMaybeHard()
    }

    private async tryHardNow() {
        await this.recoveryLifecycleService.tryHardNow()
    }

    private acceptEpoch(epochLike: unknown): boolean {
        return this.epochSyncService.acceptEpoch(epochLike)
    }

    private async refreshSignalingEpoch(): Promise<boolean> {
        return this.epochSyncService.refreshSignalingEpoch()
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
        this.debugEmitterService.emitDebug(lastEvent)
    }
}
