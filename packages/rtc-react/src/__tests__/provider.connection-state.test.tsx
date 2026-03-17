import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVibeRTC, VibeRTCProvider } from '../context'
import type { VibeRTCContextValue } from '../types'
import { createMockSignalDB, createMockSignaler, type MockSignaler } from './test-utils'

type SignalerHandlers = {
    connection?: (state: RTCPeerConnectionState) => void
    error?: (err: unknown) => void
    fastOpen?: () => void
    reliableOpen?: () => void
    fastClose?: () => void
    reliableClose?: () => void
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

describe('VibeRTCProvider - Connection State Handlers', () => {
    beforeEach(() => {
        signalerQueue = []
        vi.clearAllMocks()
    })

    it('setConnectionStateHandler maps PeerConnection states', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-conn-1')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        await act(async () => {
            getHandlers(signaler).connection?.('connecting')
        })
        expect(getContext().status).toBe('connecting')

        await act(async () => {
            getHandlers(signaler).connection?.('disconnected')
        })
        expect(getContext().status).toBe('disconnected')

        await act(async () => {
            getHandlers(signaler).connection?.('connected')
        })
        expect(getContext().status).toBe('connected')
    })

    it('pcState=connected clears existing lastError', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-conn-2')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'TEMP',
                message: 'temporary issue',
            })
        })
        expect(getContext().lastError?.code).toBe('TEMP')

        await act(async () => {
            getHandlers(signaler).connection?.('connected')
        })

        expect(getContext().status).toBe('connected')
        expect(getContext().lastError).toBeUndefined()
    })

    it('fast/reliable open handlers set status=connected', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-conn-3')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        await act(async () => {
            getHandlers(signaler).fastOpen?.()
        })
        expect(getContext().status).toBe('connected')

        await act(async () => {
            getHandlers(signaler).reliableOpen?.()
        })
        expect(getContext().status).toBe('connected')
    })

    it('fast/reliable close handlers set status=disconnected', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-conn-4')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        await act(async () => {
            getHandlers(signaler).fastClose?.()
        })
        expect(getContext().status).toBe('disconnected')

        await act(async () => {
            getHandlers(signaler).reliableClose?.()
        })
        expect(getContext().status).toBe('disconnected')
    })
})
