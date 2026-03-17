import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVibeRTC, VibeRTCProvider } from '../context'
import type { VibeRTCContextValue } from '../types'
import { createMockSignalDB, createMockSignaler, type MockSignaler } from './test-utils'

type SignalerHandlers = {
    debug?: (state: unknown) => void
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

function makeDebugState(index: number, lastEvent: string) {
    return {
        pcState: 'connecting' as RTCPeerConnectionState,
        iceState: 'checking' as RTCIceConnectionState,
        phase: 'LAN' as const,
        pcGeneration: index,
        icePhase: 'LAN' as const,
        lastEvent,
    }
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

describe('VibeRTCProvider - Operation Log', () => {
    beforeEach(() => {
        signalerQueue = []
        vi.clearAllMocks()
    })

    it('pushOperation path is observable via outgoing message log', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-log-out')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await invoke(() => getContext().sendFast('log-me'))

        expect(signaler.sendFast).toHaveBeenCalledWith('log-me')
        const outEntry = getContext().operationLog.find(
            (entry) => entry.event === 'message:out-fast',
        )
        expect(outEntry).toBeDefined()
        expect(outEntry?.scope).toBe('data')
    })

    it('keeps max 200 entries and prepends newest entries first', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-log-cap')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getContext().clearOperationLog()
        })
        expect(getContext().operationLog).toHaveLength(0)

        await act(async () => {
            for (let i = 0; i < 205; i++) {
                getHandlers(signaler).debug?.(makeDebugState(i, `event-${i}`))
            }
        })

        expect(getContext().operationLog).toHaveLength(200)
        expect(getContext().operationLog[0]?.event).toBe('event-204')
        expect(getContext().operationLog.some((entry) => entry.event === 'event-0')).toBe(false)
    })

    it('clearOperationLog removes all entries', async () => {
        enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-log-clear')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        expect(getContext().operationLog.length).toBeGreaterThan(0)

        await act(async () => {
            getContext().clearOperationLog()
        })

        expect(getContext().operationLog).toHaveLength(0)
    })

    it('categorizes debug events into operation scopes via toOperationScope()', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-log-scopes')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getContext().clearOperationLog()
            getHandlers(signaler).debug?.(makeDebugState(1, 'error:boom'))
            getHandlers(signaler).debug?.(makeDebugState(2, 'onOffer'))
            getHandlers(signaler).debug?.(makeDebugState(3, 'selected-path:relay'))
            getHandlers(signaler).debug?.(makeDebugState(4, 'ice=completed'))
            getHandlers(signaler).debug?.(makeDebugState(5, 'custom-event'))
        })

        const byEvent = (event: string) =>
            getContext().operationLog.find((entry) => entry.event === event)

        expect(byEvent('error:boom')?.scope).toBe('error')
        expect(byEvent('onOffer')?.scope).toBe('signaling')
        expect(byEvent('selected-path:relay')?.scope).toBe('data')
        expect(byEvent('ice=completed')?.scope).toBe('webrtc')
        expect(byEvent('custom-event')?.scope).toBe('system')
    })
})
