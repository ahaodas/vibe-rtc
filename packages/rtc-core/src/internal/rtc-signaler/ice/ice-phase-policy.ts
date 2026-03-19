import type { ConnectionStrategy, IcePhase } from '../../../connection-strategy'

export interface IcePhasePolicyContext {
    baseRtcConfig: RTCConfiguration
    nativeIceServers: RTCIceServer[]
    stunOnlyIceServers: RTCIceServer[]
    turnOnlyIceServers: RTCIceServer[]
}

export const hasIcePhase = (phase: IcePhase, context: IcePhasePolicyContext): boolean => {
    if (phase === 'LAN') return true
    if (phase === 'STUN') return context.nativeIceServers.length > 0
    if (phase === 'STUN_ONLY') return context.stunOnlyIceServers.length > 0
    return context.turnOnlyIceServers.length > 0
}

export const resolveInitialIcePhase = (
    strategy: ConnectionStrategy,
    context: IcePhasePolicyContext,
): IcePhase => {
    if (strategy === 'LAN_FIRST') return 'LAN'
    if (strategy === 'BROWSER_NATIVE') return 'STUN'
    if (hasIcePhase('STUN_ONLY', context)) return 'STUN_ONLY'
    if (hasIcePhase('TURN_ENABLED', context)) return 'TURN_ENABLED'
    return 'STUN_ONLY'
}

export const getNextIcePhase = (
    from: IcePhase,
    context: IcePhasePolicyContext,
): IcePhase | undefined => {
    if (from === 'LAN') {
        if (hasIcePhase('STUN_ONLY', context)) return 'STUN_ONLY'
        if (hasIcePhase('TURN_ENABLED', context)) return 'TURN_ENABLED'
        return undefined
    }
    if (from === 'STUN' || from === 'STUN_ONLY') {
        if (hasIcePhase('TURN_ENABLED', context)) return 'TURN_ENABLED'
        return undefined
    }
    return undefined
}

export const normalizeSignalIcePhase = (value: unknown): IcePhase | undefined => {
    if (value === 'TURN_ONLY') return 'TURN_ENABLED'
    if (value === 'LAN' || value === 'STUN' || value === 'STUN_ONLY' || value === 'TURN_ENABLED') {
        return value
    }
    return undefined
}

const cloneServers = (servers: RTCIceServer[]): RTCIceServer[] => servers.map((s) => ({ ...s }))

export const buildRtcConfigForPhase = (
    phase: IcePhase,
    context: IcePhasePolicyContext,
): RTCConfiguration => {
    if (phase === 'LAN') {
        return {
            ...context.baseRtcConfig,
            iceServers: [],
        }
    }

    if (phase === 'STUN') {
        return {
            ...context.baseRtcConfig,
            iceServers: cloneServers(context.nativeIceServers),
            iceTransportPolicy: context.baseRtcConfig.iceTransportPolicy ?? 'all',
        }
    }

    if (phase === 'TURN_ENABLED') {
        return {
            ...context.baseRtcConfig,
            iceServers: cloneServers(context.turnOnlyIceServers),
            iceTransportPolicy: context.baseRtcConfig.iceTransportPolicy ?? 'all',
        }
    }

    return {
        ...context.baseRtcConfig,
        iceServers: cloneServers(context.stunOnlyIceServers),
        iceTransportPolicy: 'all',
    }
}
