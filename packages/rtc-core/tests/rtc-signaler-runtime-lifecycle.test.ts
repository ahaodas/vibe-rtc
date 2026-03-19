import { describe, expect, it } from 'vitest'
import {
    resolveNetRttLifecycleAction,
    shouldRunPingLifecycle,
} from '../src/internal/rtc-signaler/metrics/runtime-lifecycle'

describe('rtc-signaler runtime lifecycle', () => {
    it('enables ping only in active phase with room and open channel', () => {
        expect(shouldRunPingLifecycle('connected', 'room-1', true)).toBe(true)
        expect(shouldRunPingLifecycle('idle', 'room-1', true)).toBe(false)
        expect(shouldRunPingLifecycle('connected', null, true)).toBe(false)
        expect(shouldRunPingLifecycle('connected', 'room-1', false)).toBe(false)
    })

    it('selects netRtt lifecycle action by phase and transport state', () => {
        expect(
            resolveNetRttLifecycleAction({
                phase: 'connected',
                roomId: 'room-1',
                connectionState: 'connected',
                iceConnectionState: 'connected',
            }),
        ).toBe('start')

        expect(
            resolveNetRttLifecycleAction({
                phase: 'connected',
                roomId: 'room-1',
                connectionState: 'disconnected',
                iceConnectionState: 'failed',
            }),
        ).toBe('stop')

        expect(
            resolveNetRttLifecycleAction({
                phase: 'negotiating',
                roomId: 'room-1',
                connectionState: 'connecting',
                iceConnectionState: 'checking',
            }),
        ).toBe('pause')

        expect(
            resolveNetRttLifecycleAction({
                phase: 'closing',
                roomId: 'room-1',
                connectionState: 'connected',
                iceConnectionState: 'connected',
            }),
        ).toBe('pause')
    })
})
