import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionConnectProgress } from '@/features/demo/hooks/useSessionConnectProgress'
import {
    CONNECT_PROGRESS_MAX_BEFORE_READY,
    CONNECT_PROGRESS_STEP,
    CONNECT_PROGRESS_TICK_MS,
} from '@/features/demo/model/constants'

describe('useSessionConnectProgress', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('ticks connect progress on interval while not ready and not errored', () => {
        const setConnectProgressRatio = vi.fn()
        const tickConnectProgress = vi.fn()

        renderHook(() =>
            useSessionConnectProgress({
                channelReadyForMessages: false,
                overallStatus: 'connecting',
                setConnectProgressRatio,
                tickConnectProgress,
            }),
        )

        vi.advanceTimersByTime(CONNECT_PROGRESS_TICK_MS * 3)

        expect(tickConnectProgress).toHaveBeenCalledTimes(3)
        expect(tickConnectProgress).toHaveBeenNthCalledWith(
            1,
            CONNECT_PROGRESS_STEP,
            CONNECT_PROGRESS_MAX_BEFORE_READY,
        )
        expect(setConnectProgressRatio).toHaveBeenCalledWith(0)
    })

    it('resets progress and does not tick when channel is ready', () => {
        const setConnectProgressRatio = vi.fn()
        const tickConnectProgress = vi.fn()

        renderHook(() =>
            useSessionConnectProgress({
                channelReadyForMessages: true,
                overallStatus: 'connected',
                setConnectProgressRatio,
                tickConnectProgress,
            }),
        )

        vi.advanceTimersByTime(CONNECT_PROGRESS_TICK_MS * 2)

        expect(setConnectProgressRatio).toHaveBeenCalledWith(0)
        expect(tickConnectProgress).not.toHaveBeenCalled()
    })

    it('resets progress on transition into connecting state', () => {
        const setConnectProgressRatio = vi.fn()
        const tickConnectProgress = vi.fn()

        const { rerender } = renderHook(
            (overallStatus: string) =>
                useSessionConnectProgress({
                    channelReadyForMessages: false,
                    overallStatus,
                    setConnectProgressRatio,
                    tickConnectProgress,
                }),
            { initialProps: 'idle' },
        )

        rerender('connecting')

        expect(setConnectProgressRatio).toHaveBeenCalledWith(0)
    })
})
