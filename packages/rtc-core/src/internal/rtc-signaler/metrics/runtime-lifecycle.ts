export type SignalerPhase =
    | 'idle'
    | 'subscribed'
    | 'negotiating'
    | 'connected'
    | 'soft-reconnect'
    | 'hard-reconnect'
    | 'closing'

export type NetRttLifecycleAction = 'start' | 'pause' | 'stop'

const isInactivePhase = (phase: SignalerPhase): boolean => phase === 'closing' || phase === 'idle'

export const shouldRunPingLifecycle = (
    phase: SignalerPhase,
    roomId: string | null,
    hasAnyOpenChannel: boolean,
): boolean => !isInactivePhase(phase) && !!roomId && hasAnyOpenChannel

export const resolveNetRttLifecycleAction = (input: {
    phase: SignalerPhase
    roomId: string | null
    connectionState?: RTCPeerConnectionState | null
    iceConnectionState?: RTCIceConnectionState | null
}): NetRttLifecycleAction => {
    if (isInactivePhase(input.phase) || !input.roomId) return 'pause'

    const conn = input.connectionState
    const ice = input.iceConnectionState
    const connected = conn === 'connected' || ice === 'connected' || ice === 'completed'
    if (connected) return 'start'

    const closedOrFailed =
        conn === 'disconnected' ||
        conn === 'failed' ||
        conn === 'closed' ||
        ice === 'disconnected' ||
        ice === 'failed' ||
        ice === 'closed'
    if (closedOrFailed) return 'stop'

    return 'pause'
}
