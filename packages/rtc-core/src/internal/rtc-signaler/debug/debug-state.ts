import { createInitialNetRttSnapshot, type NetRttSnapshot } from '../../../metrics/netRtt'
import type { PingSnapshot } from '../../../protocol/ping'

type CandidateType = 'host' | 'srflx' | 'relay' | 'unknown'
type Role = 'caller' | 'callee'
type Phase =
    | 'idle'
    | 'subscribed'
    | 'negotiating'
    | 'connected'
    | 'soft-reconnect'
    | 'hard-reconnect'
    | 'closing'
type ConnectionStrategy = 'LAN_FIRST' | 'DEFAULT' | 'BROWSER_NATIVE'
type IcePhase = 'LAN' | 'STUN' | 'STUN_ONLY' | 'TURN_ENABLED'

export interface DebugStateSnapshot {
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
    takeoverBySessionId?: string | null
    ping: PingSnapshot
    netRtt: NetRttSnapshot
    lastEvent?: string
    lastError?: string
}

export interface BuildDebugStateInput {
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
    candidateStats: DebugStateSnapshot['candidateStats']
    selectedPath?: CandidateType
    takeoverBySessionId?: string | null
    ping: PingSnapshot
    netRtt?: NetRttSnapshot
    lastEvent?: string
    lastError?: string
}

export const buildDebugStateSnapshot = (input: BuildDebugStateInput): DebugStateSnapshot => ({
    ts: input.ts,
    roomId: input.roomId,
    role: input.role,
    phase: input.phase,
    makingOffer: input.makingOffer,
    polite: input.polite,
    pcState: input.pcState,
    iceState: input.iceState,
    signalingState: input.signalingState,
    fast: input.fast,
    reliable: input.reliable,
    pendingIce: input.pendingIce,
    retries: input.retries,
    timers: input.timers,
    connectionStrategy: input.connectionStrategy,
    icePhase: input.icePhase,
    pcGeneration: input.pcGeneration,
    sessionId: input.sessionId,
    participantId: input.participantId,
    candidateStats: input.candidateStats,
    selectedPath: input.selectedPath,
    takeoverBySessionId: input.takeoverBySessionId,
    ping: input.ping,
    netRtt: input.netRtt ?? createInitialNetRttSnapshot(),
    lastEvent: input.lastEvent,
    lastError: input.lastError,
})
