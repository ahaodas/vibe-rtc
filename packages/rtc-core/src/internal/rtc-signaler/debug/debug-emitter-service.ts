import type { CandidateType, ConnectionStrategy, IcePhase } from '../../../connection-strategy'
import type { NetRttSnapshot } from '../../../metrics/netRtt'
import type { PingSnapshot } from '../../../protocol/ping'
import { buildDebugStateSnapshot } from './debug-state'

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
    pe: (message: string, error: unknown) => void
}

interface DebugEmitterDeps {
    roomId: string | null
    role: 'caller' | 'callee'
    phase:
        | 'idle'
        | 'subscribed'
        | 'negotiating'
        | 'connected'
        | 'soft-reconnect'
        | 'hard-reconnect'
        | 'closing'
    makingOffer: boolean
    polite: boolean
    pc?: RTCPeerConnection
    dcFast?: RTCDataChannel
    dcReliable?: RTCDataChannel
    pendingIce: RTCIceCandidateInit[]
    recovery: {
        softRetries: number
        hardRetries: number
        softDelayMs: number
        hardDelayMs: number
    }
    isSoftTimerPending: () => boolean
    isHardTimerPending: () => boolean
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
    getSelectedPath: () => CandidateType | undefined
    getTakeoverBySessionId: () => string | null
    pingService: { getSnapshot: () => PingSnapshot }
    netRttService?: { getSnapshot: () => NetRttSnapshot }
    lastErrorText: string | undefined
    onDebug: (state: ReturnType<typeof buildDebugStateSnapshot>) => void
    dbg: SignalerDebugger
}

// Builds and emits debug snapshots without mixing orchestration logic into RTCSignaler.
// Deps stays loosely typed to remain decoupled from RTCSignaler private surface.
export class DebugEmitterService {
    constructor(private readonly deps: DebugEmitterDeps) {}

    emitDebug(lastEvent?: string) {
        const state = buildDebugStateSnapshot({
            ts: Date.now(),
            roomId: this.deps.roomId,
            role: this.deps.role,
            phase: this.deps.phase,
            makingOffer: this.deps.makingOffer,
            polite: this.deps.polite,
            pcState: this.deps.pc?.connectionState ?? 'none',
            iceState: this.deps.pc?.iceConnectionState ?? 'none',
            signalingState: this.deps.pc?.signalingState ?? 'none',
            fast: this.deps.dcFast
                ? { state: this.deps.dcFast.readyState, ba: this.deps.dcFast.bufferedAmount }
                : undefined,
            reliable: this.deps.dcReliable
                ? {
                      state: this.deps.dcReliable.readyState,
                      ba: this.deps.dcReliable.bufferedAmount,
                  }
                : undefined,
            pendingIce: this.deps.pendingIce.length,
            retries: {
                soft: this.deps.recovery.softRetries,
                hard: this.deps.recovery.hardRetries,
            },
            timers: {
                softPending: this.deps.isSoftTimerPending(),
                hardPending: this.deps.isHardTimerPending(),
                softInMs: this.deps.recovery.softDelayMs,
                hardInMs: this.deps.recovery.hardDelayMs,
            },
            connectionStrategy: this.deps.connectionStrategy,
            icePhase: this.deps.icePhase,
            pcGeneration: this.deps.pcGeneration,
            sessionId: this.deps.sessionId,
            participantId: this.deps.participantId,
            candidateStats: this.deps.candidateStats,
            selectedPath: this.deps.getSelectedPath(),
            takeoverBySessionId: this.deps.getTakeoverBySessionId(),
            ping: this.deps.pingService.getSnapshot(),
            netRtt: this.deps.netRttService?.getSnapshot(),
            lastEvent,
            lastError: this.deps.lastErrorText,
        })
        this.deps.onDebug(state)
    }
}
