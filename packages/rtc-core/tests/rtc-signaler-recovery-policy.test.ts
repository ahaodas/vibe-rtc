import { describe, expect, it } from 'vitest'
import {
    CONNECTING_WATCHDOG_MS_LAN,
    CONNECTING_WATCHDOG_MS_PUBLIC,
    canRunWatchdogHardReconnect,
    DEFAULT_HARD_RECONNECT_DELAY_MS,
    DEFAULT_SOFT_RECONNECT_DELAY_MS,
    getConnectingWatchdogTimeoutMs,
    hasRecentRemoteProgress,
    nextHardReconnectDelayMs,
    nextSoftReconnectDelayMs,
    nextTurnWatchdogReconnectCount,
} from '../src/internal/rtc-signaler/recovery/recovery-policy'

describe('rtc-signaler recovery policy helpers', () => {
    it('provides per-phase watchdog timeout', () => {
        expect(getConnectingWatchdogTimeoutMs('LAN')).toBe(CONNECTING_WATCHDOG_MS_LAN)
        expect(getConnectingWatchdogTimeoutMs('STUN_ONLY')).toBe(CONNECTING_WATCHDOG_MS_PUBLIC)
    })

    it('limits watchdog reconnects in TURN_ENABLED phase', () => {
        expect(canRunWatchdogHardReconnect('TURN_ENABLED', 0)).toBe(true)
        expect(canRunWatchdogHardReconnect('TURN_ENABLED', 1)).toBe(true)
        expect(canRunWatchdogHardReconnect('TURN_ENABLED', 2)).toBe(false)
        expect(canRunWatchdogHardReconnect('STUN_ONLY', 999)).toBe(true)
    })

    it('increments reconnect counter only in TURN_ENABLED phase', () => {
        expect(nextTurnWatchdogReconnectCount('TURN_ENABLED', 1)).toBe(2)
        expect(nextTurnWatchdogReconnectCount('STUN_ONLY', 1)).toBe(1)
    })

    it('computes bounded reconnect backoff delays', () => {
        expect(DEFAULT_SOFT_RECONNECT_DELAY_MS).toBe(250)
        expect(DEFAULT_HARD_RECONNECT_DELAY_MS).toBe(6000)
        expect(nextSoftReconnectDelayMs(250)).toBe(500)
        expect(nextSoftReconnectDelayMs(2000)).toBe(2500)
        expect(nextHardReconnectDelayMs(6000)).toBe(12000)
        expect(nextHardReconnectDelayMs(30000)).toBe(30000)
    })

    it('detects recent remote signaling progress', () => {
        expect(hasRecentRemoteProgress(2, 3, 10_000, 11_500)).toBe(true)
        expect(hasRecentRemoteProgress(2, 2, 10_000, 10_100)).toBe(false)
        expect(hasRecentRemoteProgress(2, 3, 10_000, 20_500)).toBe(false)
    })
})
