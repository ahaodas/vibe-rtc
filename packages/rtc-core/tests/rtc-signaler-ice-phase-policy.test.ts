import { describe, expect, it } from 'vitest'
import {
    buildRtcConfigForPhase,
    getNextIcePhase,
    hasIcePhase,
    type IcePhasePolicyContext,
    normalizeSignalIcePhase,
    resolveInitialIcePhase,
} from '../src/internal/rtc-signaler/ice/ice-phase-policy'

const makeContext = (overrides: Partial<IcePhasePolicyContext> = {}): IcePhasePolicyContext => ({
    baseRtcConfig: {},
    nativeIceServers: [{ urls: 'stun:stun.example.com:3478' }],
    stunOnlyIceServers: [{ urls: 'stun:stun.example.com:3478' }],
    turnOnlyIceServers: [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }],
    ...overrides,
})

describe('rtc-signaler ice phase policy', () => {
    it('resolves initial phase by strategy', () => {
        const context = makeContext()
        expect(resolveInitialIcePhase('LAN_FIRST', context)).toBe('LAN')
        expect(resolveInitialIcePhase('BROWSER_NATIVE', context)).toBe('STUN')
        expect(resolveInitialIcePhase('DEFAULT', context)).toBe('STUN_ONLY')
    })

    it('falls back to TURN_ENABLED for DEFAULT strategy when STUN_ONLY is unavailable', () => {
        const context = makeContext({ stunOnlyIceServers: [] })
        expect(resolveInitialIcePhase('DEFAULT', context)).toBe('TURN_ENABLED')
    })

    it('computes next phase transitions', () => {
        const context = makeContext()
        expect(getNextIcePhase('LAN', context)).toBe('STUN_ONLY')
        expect(getNextIcePhase('STUN_ONLY', context)).toBe('TURN_ENABLED')
        expect(getNextIcePhase('TURN_ENABLED', context)).toBeUndefined()
    })

    it('normalizes legacy TURN_ONLY phase marker', () => {
        expect(normalizeSignalIcePhase('TURN_ONLY')).toBe('TURN_ENABLED')
        expect(normalizeSignalIcePhase('LAN')).toBe('LAN')
        expect(normalizeSignalIcePhase('unknown')).toBeUndefined()
    })

    it('builds per-phase RTC configuration without mutating source arrays', () => {
        const context = makeContext({
            baseRtcConfig: {
                iceTransportPolicy: 'all',
            },
        })

        const lanConfig = buildRtcConfigForPhase('LAN', context)
        expect(lanConfig.iceServers).toEqual([])

        const stunConfig = buildRtcConfigForPhase('STUN', context)
        expect(stunConfig.iceServers).toEqual(context.nativeIceServers)
        expect(stunConfig.iceServers).not.toBe(context.nativeIceServers)

        const turnConfig = buildRtcConfigForPhase('TURN_ENABLED', context)
        expect(turnConfig.iceServers).toEqual(context.turnOnlyIceServers)
        expect(turnConfig.iceServers).not.toBe(context.turnOnlyIceServers)

        const stunOnlyConfig = buildRtcConfigForPhase('STUN_ONLY', context)
        expect(stunOnlyConfig.iceServers).toEqual(context.stunOnlyIceServers)
        expect(stunOnlyConfig.iceTransportPolicy).toBe('all')
    })

    it('reports unavailable phases from configured server sets', () => {
        const context = makeContext({
            nativeIceServers: [],
            stunOnlyIceServers: [],
            turnOnlyIceServers: [],
        })
        expect(hasIcePhase('LAN', context)).toBe(true)
        expect(hasIcePhase('STUN', context)).toBe(false)
        expect(hasIcePhase('STUN_ONLY', context)).toBe(false)
        expect(hasIcePhase('TURN_ENABLED', context)).toBe(false)
    })
})
