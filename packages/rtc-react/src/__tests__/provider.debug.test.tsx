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
        fast: { state: 'closed' as const },
        reliable: { state: 'closed' as const },
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

describe('VibeRTCProvider - Debug', () => {
    beforeEach(() => {
        signalerQueue = []
        vi.clearAllMocks()
    })

    it('setDebugHandler updates debugState in context', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-debug-state')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        const debugState = makeDebugState(1, 'phase=LAN')

        await act(async () => {
            getHandlers(signaler).debug?.(debugState)
        })

        expect(getContext().debugState).toMatchObject(debugState)
    })

    it('deduplicates debug log entries with identical debug key', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-debug-dedup')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getContext().clearOperationLog()
        })

        const repeated = makeDebugState(7, 'dup-event')

        await act(async () => {
            getHandlers(signaler).debug?.(repeated)
            getHandlers(signaler).debug?.(repeated)
        })

        const dupEntries = getContext().operationLog.filter((entry) => entry.event === 'dup-event')
        expect(dupEntries).toHaveLength(1)
    })

    it('formats debug operation log line with key diagnostics fields', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-debug-line')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getContext().clearOperationLog()
            getHandlers(signaler).debug?.(makeDebugState(42, 'onOffer'))
        })

        const entry = getContext().operationLog.find((row) => row.event === 'onOffer')
        expect(entry).toBeDefined()
        expect(entry?.message).toContain('onOffer')
        expect(entry?.message).toContain('phase=LAN')
        expect(entry?.message).toContain('pc=connecting')
        expect(entry?.message).toContain('ice=checking')
        expect(entry?.message).toContain('icePhase=LAN')
        expect(entry?.message).toContain('gen=42')
    })

    it('maps known debug event descriptions into overallStatusText', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-debug-status-text')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).debug?.(makeDebugState(2, 'phase-transition:LAN->STUN'))
        })

        expect(getContext().overallStatus).toBe('connecting')
        expect(getContext().overallStatusText).toBe(
            'LAN-first did not complete in time, switching to STUN fallback.',
        )
    })

    it('uses generic operation text for unknown debug events', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-debug-generic')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).debug?.(makeDebugState(3, 'my-custom-debug-event'))
        })

        expect(getContext().overallStatusText).toBe('Current operation: my-custom-debug-event.')
    })
})
