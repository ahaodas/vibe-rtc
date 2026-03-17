import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVibeRTC, VibeRTCProvider } from '../context'
import type { VibeRTCContextValue } from '../types'
import { createMockSignalDB, createMockSignaler, type MockSignaler } from './test-utils'

type SignalerHandlers = {
    message?: (text: string, meta?: { reliable?: boolean }) => void
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

describe('VibeRTCProvider - Messaging', () => {
    beforeEach(() => {
        signalerQueue = []
        vi.clearAllMocks()
    })

    it('sendFast delegates to signaler and writes operation log entry', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-msg-fast')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await invoke(() => getContext().sendFast('hello-fast'))

        expect(signaler.sendFast).toHaveBeenCalledWith('hello-fast')
        const entry = getContext().operationLog.find((row) => row.event === 'message:out-fast')
        expect(entry).toBeDefined()
        expect(entry?.scope).toBe('data')
        expect(entry?.message).toContain('hello-fast')
    })

    it('sendReliable delegates to signaler and writes operation log entry', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-msg-reliable')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await invoke(() => getContext().sendReliable('hello-reliable'))

        expect(signaler.sendReliable).toHaveBeenCalledWith('hello-reliable')
        const entry = getContext().operationLog.find((row) => row.event === 'message:out-reliable')
        expect(entry).toBeDefined()
        expect(entry?.scope).toBe('data')
        expect(entry?.message).toContain('hello-reliable')
    })

    it('send without active signaler throws not-connected error', async () => {
        const { getContext } = await renderProvider()

        await expect(invoke(() => getContext().sendFast('x'))).rejects.toThrow(
            '[rtc-react] Not connected',
        )
        await expect(invoke(() => getContext().sendReliable('y'))).rejects.toThrow(
            '[rtc-react] Not connected',
        )
    })

    it('incoming message handler updates fast/reliable state and counters', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-msg-in')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        await act(async () => {
            getHandlers(signaler).message?.('fast-1')
        })
        expect(getContext().lastFastMessage?.data).toBe('fast-1')
        expect(getContext().messageSeqFast).toBe(1)
        expect(getContext().messageSeqReliable).toBe(0)

        await act(async () => {
            getHandlers(signaler).message?.('reliable-1', { reliable: true })
        })
        expect(getContext().lastReliableMessage?.data).toBe('reliable-1')
        expect(getContext().messageSeqReliable).toBe(1)
        expect(getContext().messageSeqFast).toBe(1)
    })

    it('new session (joinChannel) resets last messages and counters', async () => {
        const first = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-msg-old')
        })
        const second = enqueueSignaler()
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(first).message?.('old-fast')
            getHandlers(first).message?.('old-reliable', { reliable: true })
        })
        expect(getContext().messageSeqFast).toBe(1)
        expect(getContext().messageSeqReliable).toBe(1)

        await invoke(() => getContext().joinChannel('room-msg-new'))

        expect(first.hangup).toHaveBeenCalledTimes(1)
        expect(second.joinRoom).toHaveBeenCalledWith('room-msg-new')
        expect(getContext().roomId).toBe('room-msg-new')
        expect(getContext().lastFastMessage).toBeUndefined()
        expect(getContext().lastReliableMessage).toBeUndefined()
        expect(getContext().messageSeqFast).toBe(0)
        expect(getContext().messageSeqReliable).toBe(0)
    })
})
