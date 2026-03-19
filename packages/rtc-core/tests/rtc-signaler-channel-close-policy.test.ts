import { describe, expect, it } from 'vitest'
import { resolveChannelClosePolicy } from '../src/internal/rtc-signaler/connection/channel-close-policy'

describe('rtc-signaler channel close policy', () => {
    it('ignores stale channel close events', () => {
        const decision = resolveChannelClosePolicy({
            ownerIsCurrent: false,
            isActive: true,
            role: 'caller',
            iceConnectionState: 'connected',
            connectionState: 'connected',
        })
        expect(decision).toEqual({
            ignoreAsStale: true,
            shouldScheduleSoftReconnect: false,
            shouldScheduleDcRecovery: false,
        })
    })

    it('schedules recovery for active caller on unhealthy transport', () => {
        const decision = resolveChannelClosePolicy({
            ownerIsCurrent: true,
            isActive: true,
            role: 'caller',
            iceConnectionState: 'disconnected',
            connectionState: 'connected',
        })
        expect(decision).toEqual({
            ignoreAsStale: false,
            shouldScheduleSoftReconnect: true,
            shouldScheduleDcRecovery: true,
        })
    })

    it('does not schedule soft reconnect for healthy transport', () => {
        const decision = resolveChannelClosePolicy({
            ownerIsCurrent: true,
            isActive: true,
            role: 'caller',
            iceConnectionState: 'connected',
            connectionState: 'connected',
        })
        expect(decision).toEqual({
            ignoreAsStale: false,
            shouldScheduleSoftReconnect: false,
            shouldScheduleDcRecovery: true,
        })
    })

    it('does not schedule caller-specific recovery for callee', () => {
        const decision = resolveChannelClosePolicy({
            ownerIsCurrent: true,
            isActive: true,
            role: 'callee',
            iceConnectionState: 'failed',
            connectionState: 'failed',
        })
        expect(decision).toEqual({
            ignoreAsStale: false,
            shouldScheduleSoftReconnect: true,
            shouldScheduleDcRecovery: false,
        })
    })

    it('does not schedule anything for inactive transport', () => {
        const decision = resolveChannelClosePolicy({
            ownerIsCurrent: true,
            isActive: false,
            role: 'caller',
            iceConnectionState: 'failed',
            connectionState: 'failed',
        })
        expect(decision).toEqual({
            ignoreAsStale: false,
            shouldScheduleSoftReconnect: false,
            shouldScheduleDcRecovery: false,
        })
    })
})
