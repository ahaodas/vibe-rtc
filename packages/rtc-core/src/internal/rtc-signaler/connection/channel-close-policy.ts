export interface ChannelClosePolicyInput {
    ownerIsCurrent: boolean
    isActive: boolean
    role: 'caller' | 'callee'
    iceConnectionState: string | undefined
    connectionState: string | undefined
}

export interface ChannelClosePolicyDecision {
    ignoreAsStale: boolean
    shouldScheduleSoftReconnect: boolean
    shouldScheduleDcRecovery: boolean
}

const isUnhealthyState = (state: string | undefined): boolean =>
    state === 'disconnected' || state === 'failed' || state === 'closed'

export const resolveChannelClosePolicy = (
    input: ChannelClosePolicyInput,
): ChannelClosePolicyDecision => {
    if (!input.ownerIsCurrent) {
        return {
            ignoreAsStale: true,
            shouldScheduleSoftReconnect: false,
            shouldScheduleDcRecovery: false,
        }
    }

    if (!input.isActive) {
        return {
            ignoreAsStale: false,
            shouldScheduleSoftReconnect: false,
            shouldScheduleDcRecovery: false,
        }
    }

    const shouldScheduleSoftReconnect =
        isUnhealthyState(input.iceConnectionState) || isUnhealthyState(input.connectionState)

    return {
        ignoreAsStale: false,
        shouldScheduleSoftReconnect,
        shouldScheduleDcRecovery: input.role === 'caller',
    }
}
