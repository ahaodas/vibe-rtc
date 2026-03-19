import type { TransportEventKind, TransportEventPolicyDecision } from './transport-event-policy'

export interface TransportEventExecutionPlan {
    connectingWatchdogReason?: string
    transitionReason?: string
    stunDisconnectMessage?: string
}

export const resolveTransportEventExecutionPlan = (input: {
    kind: TransportEventKind
    state: string | undefined
    decision: TransportEventPolicyDecision
}): TransportEventExecutionPlan => {
    const connectingWatchdogReason = input.decision.scheduleConnectingWatchdog
        ? input.kind === 'ice'
            ? 'ice=checking'
            : 'connection=connecting'
        : undefined

    const transitionReason = input.decision.transitionToNextIcePhase
        ? `stun-${input.state}`
        : undefined

    const stunDisconnectMessage = input.decision.startStunOnlyDisconnectGraceTimer
        ? input.kind === 'ice'
            ? 'STUN-only disconnected: wait before TURN_ENABLED transition'
            : 'STUN-only disconnected(connection): wait before TURN_ENABLED transition'
        : undefined

    return {
        connectingWatchdogReason,
        transitionReason,
        stunDisconnectMessage,
    }
}
