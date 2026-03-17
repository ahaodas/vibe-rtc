import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVibeRTC, VibeRTCProvider } from '../context'
import type { VibeRTCContextValue } from '../types'
import { createMockSignalDB, createMockSignaler, type MockSignaler } from './test-utils'

type SignalerHandlers = {
    error?: (err: unknown) => void
}

let signalerQueue: MockSignaler[] = []

vi.mock('@vibe-rtc/rtc-core', () => {
    class RTCSignaler {
        constructor() {
            const instance = signalerQueue.shift() ?? createMockSignaler()
            Object.assign(this, instance)
        }
    }
    return { RTCSignaler }
})

function enqueueSignaler(setup?: (signaler: MockSignaler) => void): MockSignaler {
    const signaler = createMockSignaler()
    setup?.(signaler)
    signalerQueue.push(signaler)
    return signaler
}

function getHandlers(signaler: MockSignaler): SignalerHandlers {
    return (signaler as MockSignaler & { __handlers?: SignalerHandlers }).__handlers ?? {}
}

function ContextProbe(props: { onChange: (value: VibeRTCContextValue) => void }) {
    const ctx = useVibeRTC()
    useEffect(() => {
        props.onChange(ctx)
    }, [ctx, props])
    return null
}

async function renderProvider() {
    let currentContext: VibeRTCContextValue | null = null

    render(
        <VibeRTCProvider signalServer={createMockSignalDB()}>
            <ContextProbe
                onChange={(ctx) => {
                    currentContext = ctx
                }}
            />
        </VibeRTCProvider>,
    )

    await waitFor(() => {
        expect(currentContext).not.toBeNull()
    })

    const getContext = () => {
        if (!currentContext) throw new Error('Context is not initialized')
        return currentContext
    }

    return { getContext }
}

async function invoke<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T
    await act(async () => {
        result = await fn()
    })
    return result
}

describe('VibeRTCProvider - Reconnection', () => {
    beforeEach(() => {
        signalerQueue = []
        vi.clearAllMocks()
    })

    it('reconnectSoft delegates to signaler, clears lastError and logs operation', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-reconnect-soft')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'TEMP',
                message: 'temporary failure',
            })
        })
        expect(getContext().lastError?.code).toBe('TEMP')

        await invoke(() => getContext().reconnectSoft())

        expect(signaler.reconnectSoft).toHaveBeenCalledTimes(1)
        expect(getContext().lastError).toBeUndefined()
        const softEntry = getContext().operationLog.find(
            (entry) => entry.event === 'reconnect:soft',
        )
        expect(softEntry?.scope).toBe('webrtc')
    })

    it('reconnectHard delegates to signaler with opts, clears lastError and logs operation', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-reconnect-hard')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'TEMP2',
                message: 'temporary failure',
            })
        })

        await invoke(() => getContext().reconnectHard({ awaitReadyMs: 2500 }))

        expect(signaler.reconnectHard).toHaveBeenCalledWith({ awaitReadyMs: 2500 })
        expect(getContext().lastError).toBeUndefined()
        const hardEntry = getContext().operationLog.find(
            (entry) => entry.event === 'reconnect:hard',
        )
        expect(hardEntry?.scope).toBe('webrtc')
    })

    it('reconnect without signaler throws not-connected error', async () => {
        const { getContext } = await renderProvider()

        await expect(invoke(() => getContext().reconnectSoft())).rejects.toThrow(
            '[rtc-react] Not connected',
        )
        await expect(invoke(() => getContext().reconnectHard())).rejects.toThrow(
            '[rtc-react] Not connected',
        )
    })
})
