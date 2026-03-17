import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVibeRTC, VibeRTCProvider } from '../context'
import type { VibeRTCContextValue } from '../types'
import {
    createMockSignalDB,
    createMockSignaler,
    type MockSignalDB,
    type MockSignaler,
} from './test-utils'

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

async function renderProvider(options?: {
    signalServer?: MockSignalDB
    createSignalServer?: () => Promise<MockSignalDB>
}) {
    const signalServer =
        options?.createSignalServer === undefined
            ? (options?.signalServer ?? createMockSignalDB())
            : undefined
    let currentContext: VibeRTCContextValue | null = null

    render(
        <VibeRTCProvider
            signalServer={signalServer}
            createSignalServer={options?.createSignalServer}
        >
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

    return { signalServer, getContext }
}

async function invoke<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T
    await act(async () => {
        result = await fn()
    })
    return result
}

describe('VibeRTCProvider - Error Handling', () => {
    beforeEach(() => {
        signalerQueue = []
        vi.clearAllMocks()
    })

    it('signaler error handler updates lastError and overallStatus', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-error-1')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'SIGNAL_TIMEOUT',
                message: 'timeout waiting remote answer',
            })
        })

        expect(getContext().lastError?.code).toBe('SIGNAL_TIMEOUT')
        expect(getContext().lastError?.message).toBe('timeout waiting remote answer')
        expect(getContext().status).toBe('error')
        expect(getContext().overallStatus).toBe('error')
    })

    it('normalizes takeover-like error to TAKEOVER_DETECTED', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-error-2')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'INVALID_STATE',
                message: 'slot was taken over by another tab',
            })
        })

        expect(getContext().lastError?.code).toBe('TAKEOVER_DETECTED')
        expect(getContext().lastError?.message).toBe('Room slot was taken over in another tab')
        expect(getContext().overallStatusText).toContain('TAKEOVER_DETECTED')
    })

    it('error with code is shown in overallStatusText and logged in operationLog', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-error-3')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'PEER_LEFT',
                message: 'callee ended session',
            })
        })

        expect(getContext().overallStatusText).toBe('PEER_LEFT: callee ended session')
        const errorEntry = getContext().operationLog.find(
            (entry) => entry.event === 'signaler:error',
        )
        expect(errorEntry).toBeDefined()
        expect(errorEntry?.scope).toBe('error')
        expect(errorEntry?.message).toContain('PEER_LEFT')
    })

    it('createSignalServer reject sets bootError and overallStatus=error', async () => {
        const createSignalServer = vi.fn().mockRejectedValue(new Error('Firebase init failed'))
        enqueueSignaler()
        const { getContext } = await renderProvider({ createSignalServer })

        let thrown: unknown
        await act(async () => {
            try {
                await getContext().createChannel()
            } catch (e) {
                thrown = e
            }
        })

        expect(thrown).toMatchObject({
            name: 'Error',
            message: 'Firebase init failed',
        })
        expect(getContext().bootError?.message).toBe('Firebase init failed')
        expect(getContext().overallStatus).toBe('error')
        expect(getContext().overallStatusText).toBe(
            'Signaling bootstrap failed: Firebase init failed',
        )
    })

    it('createChannel connect error is propagated and saved to lastError', async () => {
        enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-error-4')
            s.connect.mockRejectedValue(new Error('connect failed'))
        })
        const { getContext } = await renderProvider()

        let thrown: unknown
        await act(async () => {
            try {
                await getContext().createChannel()
            } catch (e) {
                thrown = e
            }
        })

        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toBe('connect failed')
        expect(getContext().lastError?.message).toBe('connect failed')
        expect(getContext().status).toBe('error')
    })

    it('reconnectSoft/reconnectHard clear lastError before reconnect', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-error-5')
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

        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'TEMP2',
                message: 'temporary failure 2',
            })
        })
        expect(getContext().lastError?.code).toBe('TEMP2')

        await invoke(() => getContext().reconnectHard({ awaitReadyMs: 4321 }))

        expect(signaler.reconnectHard).toHaveBeenCalledWith({ awaitReadyMs: 4321 })
        expect(getContext().lastError).toBeUndefined()
    })
})
