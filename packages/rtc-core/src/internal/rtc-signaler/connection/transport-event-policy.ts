import type { ConnectionStrategy, IcePhase } from '../../../connection-strategy'

export type TransportEventKind = 'ice' | 'connection'

export interface TransportEventPolicyInput {
    connectionStrategy: ConnectionStrategy
    role: 'caller' | 'callee'
    icePhase: IcePhase
    hasTurnEnabledPhase: boolean
    kind: TransportEventKind
    state: string | undefined
}

export interface TransportEventPolicyDecision {
    markConnected: boolean
    markCompleted: boolean
    scheduleConnectingWatchdog: boolean
    transitionToNextIcePhase: boolean
    startStunOnlyDisconnectGraceTimer: boolean
    scheduleSoftReconnect: boolean
    triggerHardReconnect: boolean
}

const isLanFirstCallerStunOnly = (input: TransportEventPolicyInput): boolean =>
    input.connectionStrategy === 'LAN_FIRST' &&
    input.role === 'caller' &&
    input.icePhase === 'STUN_ONLY'

export const resolveTransportEventPolicy = (
    input: TransportEventPolicyInput,
): TransportEventPolicyDecision => {
    const markConnected =
        (input.kind === 'ice' && input.state === 'connected') ||
        (input.kind === 'connection' && input.state === 'connected')
    const markCompleted = input.kind === 'ice' && input.state === 'completed'
    const scheduleConnectingWatchdog =
        (input.kind === 'ice' && input.state === 'checking') ||
        (input.kind === 'connection' && input.state === 'connecting')

    const transitionToNextIcePhase = isLanFirstCallerStunOnly(input) && input.state === 'failed'

    const startStunOnlyDisconnectGraceTimer =
        isLanFirstCallerStunOnly(input) &&
        input.state === 'disconnected' &&
        input.hasTurnEnabledPhase

    const scheduleSoftReconnect = input.role === 'caller' && input.state === 'disconnected'
    const triggerHardReconnect =
        input.role === 'caller' && (input.state === 'failed' || input.state === 'closed')

    return {
        markConnected,
        markCompleted,
        scheduleConnectingWatchdog,
        transitionToNextIcePhase,
        startStunOnlyDisconnectGraceTimer,
        scheduleSoftReconnect,
        triggerHardReconnect,
    }
}
