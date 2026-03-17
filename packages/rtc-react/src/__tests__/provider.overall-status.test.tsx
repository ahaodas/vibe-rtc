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
    connection?: (state: RTCPeerConnectionState) => void
    error?: (err: unknown) => void
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

describe('VibeRTCProvider - Overall Status', () => {
    beforeEach(() => {
        signalerQueue = []
        vi.clearAllMocks()
    })

    it('idle state maps to overallStatus=none', async () => {
        const { getContext } = await renderProvider()
        expect(getContext().status).toBe('idle')
        expect(getContext().overallStatus).toBe('none')
    })

    it('bootError maps to overallStatus=error', async () => {
        const createSignalServer = vi.fn().mockRejectedValue(new Error('boot failed'))
        const { getContext } = await renderProvider({ createSignalServer })

        await act(async () => {
            try {
                await getContext().createChannel()
            } catch {
                // expected
            }
        })

        expect(getContext().bootError?.message).toBe('boot failed')
        expect(getContext().overallStatus).toBe('error')
    })

    it('lastError maps to overallStatus=error', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-overall-error')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'ANY',
                message: 'runtime fail',
            })
        })

        expect(getContext().lastError?.message).toBe('runtime fail')
        expect(getContext().overallStatus).toBe('error')
    })

    it('booting=true maps to overallStatus=connecting', async () => {
        const signalServer = createMockSignalDB()
        let resolveInit: ((db: MockSignalDB) => void) | null = null
        const createSignalServer = vi.fn(
            () =>
                new Promise<MockSignalDB>((resolve) => {
                    resolveInit = resolve
                }),
        )
        enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-overall-booting')
        })
        const { getContext } = await renderProvider({ createSignalServer })

        let pendingCreate: Promise<string> | null = null
        await act(async () => {
            pendingCreate = getContext().createChannel()
            await Promise.resolve()
        })

        expect(getContext().booting).toBe(true)
        expect(getContext().overallStatus).toBe('connecting')

        await act(async () => {
            resolveInit?.(signalServer)
            await pendingCreate
        })
    })

    it('status=connecting maps to overallStatus=connecting', async () => {
        enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-overall-connecting')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        expect(getContext().status).toBe('connecting')
        expect(getContext().overallStatus).toBe('connecting')
    })

    it('status=disconnected with roomId maps to overallStatus=connecting', async () => {
        enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-overall-disconnected')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await invoke(() => getContext().disconnect())

        expect(getContext().status).toBe('disconnected')
        expect(getContext().roomId).toBe('room-overall-disconnected')
        expect(getContext().overallStatus).toBe('connecting')
    })

    it('status=connected maps to overallStatus=connected', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-overall-connected')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).connection?.('connected')
        })

        expect(getContext().status).toBe('connected')
        expect(getContext().overallStatus).toBe('connected')
    })

    it('connecting without debug event uses fallback status text', async () => {
        enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-overall-fallback')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        expect(getContext().overallStatus).toBe('connecting')
        expect(getContext().overallStatusText).toBe('Establishing signaling and WebRTC transport.')
    })

    it('connected route text handles missing candidate types as unknown', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-overall-route')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).connection?.('connected')
            getHandlers(signaler).debug?.({
                pcState: 'connected' as RTCPeerConnectionState,
                iceState: 'completed' as RTCIceConnectionState,
                phase: 'LAN' as const,
                pcGeneration: 1,
                icePhase: 'LAN' as const,
                lastEvent: 'connected',
                netRtt: {
                    route: {
                        isRelay: true,
                        localCandidateType: null,
                        remoteCandidateType: null,
                    },
                },
            })
        })

        expect(getContext().overallStatus).toBe('connected')
        expect(getContext().overallStatusText).toBe(
            'Connected via TURN/relay route (unknown -> unknown).',
        )
    })
})
