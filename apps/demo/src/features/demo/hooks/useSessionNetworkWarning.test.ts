import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionNetworkWarning } from '@/features/demo/hooks/useSessionNetworkWarning'
import {
    HIGH_DIRECT_NET_RTT_MS,
    HIGH_DIRECT_NET_RTT_STREAK,
    WARNING_STICKY_MS,
} from '@/features/demo/model/constants'
import type { NetWarningState } from '@/features/demo/model/sessionReducer'

type HookProps = {
    isRelayRoute: boolean
    netRttMs: number | null
    netWarning: NetWarningState | null
    setNetWarning: (value: NetWarningState | null) => void
}

describe('useSessionNetworkWarning', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('shows high-direct warning after RTT streak and clears it after sticky timeout', () => {
        const setNetWarning = vi.fn()

        const { rerender } = renderHook((props: HookProps) => useSessionNetworkWarning(props), {
            initialProps: {
                isRelayRoute: false,
                netRttMs: HIGH_DIRECT_NET_RTT_MS + 1,
                netWarning: null,
                setNetWarning,
            },
        })

        for (let i = 0; i < HIGH_DIRECT_NET_RTT_STREAK - 1; i += 1) {
            rerender({
                isRelayRoute: false,
                netRttMs: HIGH_DIRECT_NET_RTT_MS + 2 + i,
                netWarning: null,
                setNetWarning,
            })
        }

        expect(setNetWarning).toHaveBeenCalledWith({
            key: 'high-direct',
            message:
                'High network RTT on direct connection — check Wi-Fi / power saving / device load.',
        })

        vi.advanceTimersByTime(WARNING_STICKY_MS)

        expect(setNetWarning).toHaveBeenCalledWith(null)
    })

    it('respects cooldown and does not re-emit high-direct warning too early', () => {
        const setNetWarning = vi.fn()

        const { rerender } = renderHook((props: HookProps) => useSessionNetworkWarning(props), {
            initialProps: {
                isRelayRoute: false,
                netRttMs: HIGH_DIRECT_NET_RTT_MS + 10,
                netWarning: null,
                setNetWarning,
            },
        })

        for (let i = 0; i < HIGH_DIRECT_NET_RTT_STREAK - 1; i += 1) {
            rerender({
                isRelayRoute: false,
                netRttMs: HIGH_DIRECT_NET_RTT_MS + 20 + i,
                netWarning: null,
                setNetWarning,
            })
        }

        vi.advanceTimersByTime(WARNING_STICKY_MS)

        for (let i = 0; i < HIGH_DIRECT_NET_RTT_STREAK; i += 1) {
            rerender({
                isRelayRoute: false,
                netRttMs: HIGH_DIRECT_NET_RTT_MS + 40 + i,
                netWarning: null,
                setNetWarning,
            })
        }

        const highDirectWarnings = setNetWarning.mock.calls.filter(
            ([value]) => value && value.key === 'high-direct',
        )
        expect(highDirectWarnings).toHaveLength(1)
    })

    it('clears relay warning immediately when route becomes direct-only', () => {
        const setNetWarning = vi.fn()

        renderHook(() =>
            useSessionNetworkWarning({
                isRelayRoute: true,
                netRttMs: null,
                netWarning: {
                    key: 'relay',
                    message: 'Relay in use',
                },
                setNetWarning,
            }),
        )

        expect(setNetWarning).toHaveBeenCalledWith(null)
    })
})
