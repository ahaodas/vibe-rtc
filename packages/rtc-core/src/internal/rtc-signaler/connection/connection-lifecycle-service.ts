import type { ConnectionStrategy, IcePhase } from '../../../connection-strategy'
import { RTCError, RTCErrorCode, type RTCError as RTCErrorShape } from '../../../errors'
import type { OfferSDP, RoomDoc } from '../../../types'
import { sdpHash } from '../debug/debug-utils'
import { type IcePhasePolicyContext, resolveInitialIcePhase } from '../ice/ice-phase-policy'
import { createCandidateStatsSnapshot } from '../metrics/candidate-stats'
import { buildOfferPayload } from '../signaling/signal-payloads'

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
}

interface ConnectionLifecycleDeps {
    dbg: SignalerDebugger
    role: 'caller' | 'callee'
    signalDb: {
        createRoom: () => Promise<string>
        getRoom: () => Promise<RoomDoc | null>
        joinRoom: (id: string, role: 'caller' | 'callee') => Promise<void>
        leaveRoom?: (role: 'caller' | 'callee') => Promise<void>
        endRoom: () => Promise<void>
    }
    roomId: string | null
    signalingEpoch: number
    participantId: string | null
    sessionId: string | null
    phase:
        | 'idle'
        | 'subscribed'
        | 'negotiating'
        | 'connected'
        | 'soft-reconnect'
        | 'hard-reconnect'
        | 'closing'
    connectedOrSubbed: boolean
    resetSelectedPath: () => void
    seenRemoteOfferSessions: Set<string>
    stunWatchdogReconnects: number
    resetSessionOwnershipState: () => void
    clearTakeoverBySessionId: () => void
    isTakeoverStopping: () => boolean
    remoteProgressSeq: number
    remoteProgressLastAt: number
    signalSequence: number
    pingService: { stop: () => void; reset: () => void }
    netRttService?: { stop: () => void; reset: () => void }
    candidateStats: ReturnType<typeof createCandidateStatsSnapshot>
    connectionStrategy: ConnectionStrategy
    icePhase: IcePhase
    makingOffer: boolean
    remoteDescSet: boolean
    lastLocalOfferSdp: string | null
    pcGeneration: number
    controlledPeerRebuild: boolean
    defaultWaitReadyTimeoutMs: number
    streams: { setOffer: (payload: unknown) => Promise<void> }
    rxSubs: Array<{ unsubscribe: () => void }>
    unsubscribes: Array<() => void>
    pc?: RTCPeerConnection
    syncIdentityFromRoom: (room: RoomDoc | null) => void
    emitDebug: (lastEvent?: string) => void
    onError: (error: RTCErrorShape) => void
    raiseError: (
        err: unknown,
        fallbackCode: RTCErrorCode,
        phase: 'room' | 'reconnect' | 'signaling',
        retriable: boolean,
        message?: string,
        rethrow?: boolean,
    ) => RTCErrorShape
    clearLanFirstTimer: () => void
    clearStunOnlyTimer: () => void
    getIcePhasePolicyContext: () => IcePhasePolicyContext
    initPeer: () => void
    attachSignalingSubscriptions: () => void
    ensureOwnSlotActive: (source: string) => Promise<boolean>
    startStunOnlyTimer: (generation: number) => void
    refreshSignalingEpoch: () => Promise<boolean>
    getLocalRoleSessionId: () => string | null
    nextSignalSequence: () => number
    handleTakeoverWriteError: (source: string, error: unknown) => Promise<boolean>
    resetNegotiationStateForPeerRebuild: () => void
    cleanupPeerOnly: () => void
    waitReady: (opts?: { timeoutMs?: number }) => Promise<void>
    clearRecoveryTimers: () => void
    reconnectSoft: () => Promise<void>
    hangup: () => Promise<void>
}

// Encapsulates room/session lifecycle orchestration for RTCSignaler public API.
// Deps remains loosely typed to avoid coupling to RTCSignaler private surface.
export class ConnectionLifecycleService {
    constructor(private readonly deps: ConnectionLifecycleDeps) {}

    async createRoom(): Promise<string> {
        let id: string
        this.deps.dbg.p('join-start', { role: this.deps.role, mode: 'create' })
        this.deps.emitDebug('join-start')
        try {
            id = await this.deps.signalDb.createRoom()
        } catch (e) {
            throw this.deps.raiseError(
                e,
                RTCErrorCode.DB_UNAVAILABLE,
                'room',
                true,
                'createRoom failed',
            )
        }
        this.deps.roomId = id
        try {
            const room = await this.deps.signalDb.getRoom()
            this.deps.signalingEpoch = room?.epoch ?? 0
            this.deps.syncIdentityFromRoom(room)
        } catch (e) {
            this.deps.onError(
                this.deps.raiseError(
                    e,
                    RTCErrorCode.DB_UNAVAILABLE,
                    'room',
                    true,
                    'createRoom: failed to sync room epoch',
                    false,
                ),
            )
        }
        this.deps.dbg.p('join-success', {
            role: this.deps.role,
            participantId: this.deps.participantId,
            sessionId: this.deps.sessionId,
            roomId: id,
        })
        this.deps.emitDebug('join-success')
        // Align lifecycle with joinRoom(): connect() flow expects non-idle pre-subscribed state.
        this.deps.phase = 'subscribed'
        this.deps.dbg.p(`createRoom -> ${id}`)
        this.deps.emitDebug('createRoom')
        return id
    }

    async joinRoom(id: string): Promise<void> {
        this.deps.roomId = id
        this.deps.dbg.p('join-start', {
            role: this.deps.role,
            participantId: this.deps.participantId,
            roomId: id,
        })
        this.deps.emitDebug('join-start')
        this.deps.dbg.p(`joinRoom -> ${id}`)
        try {
            await this.deps.signalDb.joinRoom(id, this.deps.role)
        } catch (e) {
            throw this.deps.raiseError(
                e,
                RTCErrorCode.DB_UNAVAILABLE,
                'room',
                true,
                'joinRoom failed',
            )
        }
        try {
            const room = await this.deps.signalDb.getRoom()
            this.deps.signalingEpoch = room?.epoch ?? 0
            this.deps.syncIdentityFromRoom(room)
        } catch (e) {
            this.deps.signalingEpoch = 0
            this.deps.onError(
                this.deps.raiseError(
                    e,
                    RTCErrorCode.DB_UNAVAILABLE,
                    'room',
                    true,
                    'joinRoom: failed to load room snapshot',
                    false,
                ),
            )
        }
        this.deps.dbg.p('join-success', {
            role: this.deps.role,
            participantId: this.deps.participantId,
            sessionId: this.deps.sessionId,
            roomId: id,
        })
        this.deps.emitDebug('join-success')
        this.deps.phase = 'subscribed'
        this.deps.emitDebug('joinRoom')
    }

    async connect(): Promise<void> {
        if (!this.deps.roomId) {
            throw this.deps.raiseError(
                new Error('Room not selected'),
                RTCErrorCode.ROOM_NOT_SELECTED,
                'room',
                false,
            )
        }
        try {
            const room = await this.deps.signalDb.getRoom()
            if (!room) {
                throw this.deps.raiseError(
                    new Error('Room not found'),
                    RTCErrorCode.ROOM_NOT_FOUND,
                    'room',
                    false,
                )
            }
        } catch (e) {
            if (e instanceof RTCError) throw e
            throw this.deps.raiseError(
                e,
                RTCErrorCode.DB_UNAVAILABLE,
                'room',
                true,
                'connect failed',
            )
        }
        if (this.deps.connectedOrSubbed) {
            this.deps.dbg.p('connect() skipped (already connected/subscribed)')
            return
        }
        this.deps.connectedOrSubbed = true
        this.deps.resetSelectedPath()
        this.deps.seenRemoteOfferSessions.clear()
        this.deps.stunWatchdogReconnects = 0
        this.deps.resetSessionOwnershipState()
        this.deps.remoteProgressSeq = 0
        this.deps.remoteProgressLastAt = 0
        this.deps.signalSequence = 0
        this.deps.pingService.stop()
        this.deps.pingService.reset()
        this.deps.netRttService?.stop()
        this.deps.netRttService?.reset()
        this.deps.candidateStats = createCandidateStatsSnapshot()
        this.deps.clearLanFirstTimer()
        this.deps.clearStunOnlyTimer()
        this.deps.icePhase = resolveInitialIcePhase(
            this.deps.connectionStrategy,
            this.deps.getIcePhasePolicyContext(),
        )

        this.deps.initPeer()
        this.deps.emitDebug('initPeer')
        this.deps.attachSignalingSubscriptions()
    }

    async reconnectSoft(): Promise<void> {
        if (!(await this.deps.ensureOwnSlotActive('reconnect-soft'))) return
        if (!this.deps.roomId) {
            throw this.deps.raiseError(
                new Error('Room not selected'),
                RTCErrorCode.ROOM_NOT_SELECTED,
                'reconnect',
                false,
            )
        }
        if (!this.deps?.pc) return
        if (this.deps.makingOffer || this.deps.pc.signalingState !== 'stable') {
            this.deps.dbg.p('reconnectSoft skipped (makingOffer or !stable)')
            return
        }
        this.deps.phase = 'soft-reconnect'
        this.deps.emitDebug('soft-reconnect')
        try {
            this.deps.makingOffer = true
            this.deps.remoteDescSet = false
            const offer = await this.deps.pc.createOffer({ iceRestart: true })
            this.deps.lastLocalOfferSdp = offer.sdp ?? null
            this.deps.dbg.p('SLD(offer,iceRestart) start', { sdp: sdpHash(offer.sdp) })
            await this.deps.pc.setLocalDescription(offer)
            if (this.deps.icePhase === 'STUN_ONLY')
                this.deps.startStunOnlyTimer(this.deps.pcGeneration)
            const epochChanged = await this.deps.refreshSignalingEpoch()
            if (epochChanged) {
                this.deps.dbg.p('skip offer(iceRestart) publish after epoch sync')
                return
            }
            if (!(await this.deps.ensureOwnSlotActive('reconnect-soft:publish'))) return
            const localRoleSessionId = this.deps.getLocalRoleSessionId() ?? this.deps.sessionId
            const signalSeq = this.deps.nextSignalSequence()
            this.deps.dbg.p('signaling-send:offer', {
                sessionId: localRoleSessionId ?? null,
                generation: this.deps.pcGeneration,
                signalSeq,
                phase: this.deps.icePhase,
                source: 'reconnectSoft',
            })
            await this.deps.streams.setOffer(
                buildOfferPayload({
                    offer: offer as OfferSDP,
                    epoch: this.deps.signalingEpoch,
                    generation: this.deps.pcGeneration,
                    signalSeq,
                    sessionId: localRoleSessionId,
                    icePhase: this.deps.icePhase,
                }),
            )
            this.deps.dbg.p('offer(iceRestart) published')
        } catch (e) {
            if (await this.deps.handleTakeoverWriteError('send-offer:reconnect-soft', e)) return
            throw this.deps.raiseError(
                e,
                RTCErrorCode.SIGNALING_FAILED,
                'reconnect',
                true,
                'reconnectSoft failed',
            )
        } finally {
            this.deps.makingOffer = false
        }
    }

    async reconnectHard(opts: { awaitReadyMs?: number } = {}) {
        if (!this.deps.roomId) {
            throw this.deps.raiseError(
                new Error('Room not selected'),
                RTCErrorCode.ROOM_NOT_SELECTED,
                'reconnect',
                false,
            )
        }
        this.deps.phase = 'hard-reconnect'
        this.deps.emitDebug('hard-reconnect start')
        this.deps.controlledPeerRebuild = true
        try {
            this.deps.makingOffer = false
            this.deps.resetNegotiationStateForPeerRebuild()
            this.deps.cleanupPeerOnly()
            this.deps.initPeer()
        } finally {
            this.deps.controlledPeerRebuild = false
        }
        this.deps.emitDebug('hard-reconnect initPeer')

        const waitMs = opts.awaitReadyMs ?? this.deps.defaultWaitReadyTimeoutMs
        await this.deps.waitReady({ timeoutMs: waitMs })
        this.deps.dbg.p('reconnectHard done')
        this.deps.phase = 'connected'
        this.deps.emitDebug('hard-reconnect done')
    }

    async hangup(): Promise<void> {
        this.deps.phase = 'closing'
        this.deps.emitDebug('hangup')
        this.deps.clearRecoveryTimers()
        this.deps.clearLanFirstTimer()
        this.deps.pingService.stop()
        this.deps.netRttService?.stop()

        // Rx subscriptions
        for (const s of this.deps.rxSubs.splice(0)) {
            try {
                s.unsubscribe()
            } catch {}
        }

        // legacy subscriptions (in case one gets added somewhere)
        this.deps.unsubscribes.forEach((u: () => void) => {
            try {
                u()
            } catch {}
        })
        this.deps.unsubscribes = []

        this.deps.cleanupPeerOnly()

        // Best-effort presence signal so remote peer can react quickly to manual leave.
        // Skip it during takeover shutdown: stale tabs must not write into role docs.
        if (!this.deps.isTakeoverStopping()) {
            try {
                void this.deps.signalDb.leaveRoom?.(this.deps.role).catch(() => {})
            } catch {}
        }

        this.deps.connectedOrSubbed = false
        this.deps.clearTakeoverBySessionId()
        this.deps.phase = 'idle'
        this.deps.emitDebug('hangup done')
    }

    async endRoom(): Promise<void> {
        this.deps.dbg.p('endRoom')
        await this.hangup()
        try {
            await this.deps.signalDb.endRoom()
        } catch (e) {
            throw this.deps.raiseError(
                e,
                RTCErrorCode.DB_UNAVAILABLE,
                'room',
                true,
                'endRoom failed',
            )
        }
        this.deps.roomId = null
        this.deps.emitDebug('endRoom')
    }
}
