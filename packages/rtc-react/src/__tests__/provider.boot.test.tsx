import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVibeRTC, VibeRTCProvider } from '../context'
import { createMockSignalDB, createMockSignaler, type MockSignaler } from './test-utils'

let mockSignalerInstance: MockSignaler

vi.mock('@vibe-rtc/rtc-core', () => {
    class RTCSignaler {
        constructor() {
            Object.assign(this, mockSignalerInstance)
        }
    }
    return { RTCSignaler }
})

describe('VibeRTCProvider - Boot', () => {
    beforeEach(() => {
        mockSignalerInstance = createMockSignaler()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('renders with signalServer prop (immediate boot)', () => {
        const mockSignalDB = createMockSignalDB()

        function TestComponent() {
            const { booting, bootError } = useVibeRTC()
            return (
                <div>
                    <div data-testid="booting">{String(booting)}</div>
                    <div data-testid="bootError">{bootError ? bootError.message : 'none'}</div>
                </div>
            )
        }

        render(
            <VibeRTCProvider signalServer={mockSignalDB}>
                <TestComponent />
            </VibeRTCProvider>,
        )

        expect(screen.getByTestId('booting').textContent).toBe('false')
        expect(screen.getByTestId('bootError').textContent).toBe('none')
    })

    it('renders with createSignalServer (async boot with loading state)', async () => {
        const mockSignalDB = createMockSignalDB()
        const createSignalServer = vi.fn().mockResolvedValue(mockSignalDB)

        function TestComponent() {
            const { booting, bootError } = useVibeRTC()
            return (
                <div>
                    <div data-testid="booting">{String(booting)}</div>
                    <div data-testid="bootError">{bootError ? bootError.message : 'none'}</div>
                </div>
            )
        }

        render(
            <VibeRTCProvider
                createSignalServer={createSignalServer}
                renderLoading={<div>Loading...</div>}
            >
                <TestComponent />
            </VibeRTCProvider>,
        )

        // Initially not booting (lazy init)
        expect(screen.getByTestId('booting').textContent).toBe('false')
    })

    it('createSignalServer rejects → bootError state, renderBootError called', async () => {
        const error = new Error('Firebase init failed')
        const createSignalServer = vi.fn().mockRejectedValue(error)
        const renderBootError = vi.fn((err) => <div data-testid="boot-error">{err.message}</div>)

        function TestComponent() {
            const { createChannel } = useVibeRTC()
            return (
                <button
                    type="button"
                    onClick={async () => {
                        try {
                            await createChannel()
                        } catch {
                            // Expected error
                        }
                    }}
                >
                    Create
                </button>
            )
        }

        const { getByText } = render(
            <VibeRTCProvider
                createSignalServer={createSignalServer}
                renderBootError={renderBootError}
            >
                <TestComponent />
            </VibeRTCProvider>,
        )

        // Trigger boot by calling createChannel
        await act(async () => {
            getByText('Create').click()
        })

        await waitFor(() => {
            expect(createSignalServer).toHaveBeenCalled()
        })

        await waitFor(() => {
            expect(renderBootError).toHaveBeenCalled()
            expect(screen.getByTestId('boot-error').textContent).toContain('Firebase init failed')
        })
    })

    it('missing both signalServer and createSignalServer → boot error on first use', async () => {
        function TestComponent() {
            const { createChannel, bootError } = useVibeRTC()
            return (
                <div>
                    <button
                        type="button"
                        onClick={async () => {
                            try {
                                await createChannel()
                            } catch {
                                // Expected error
                            }
                        }}
                    >
                        Create
                    </button>
                    <div data-testid="bootError">{bootError ? bootError.message : 'none'}</div>
                </div>
            )
        }

        const { getByText } = render(
            <VibeRTCProvider>
                <TestComponent />
            </VibeRTCProvider>,
        )

        await act(async () => {
            getByText('Create').click()
        })

        await waitFor(() => {
            expect(screen.getByTestId('bootError').textContent).toContain(
                'provide either signalServer or createSignalServer',
            )
        })
    })

    it('renderLoading displayed during booting=true', async () => {
        const mockSignalDB = createMockSignalDB()
        let resolveInit: (db: typeof mockSignalDB) => void
        const createSignalServer = vi.fn(
            () =>
                new Promise<typeof mockSignalDB>((resolve) => {
                    resolveInit = resolve
                }),
        )

        function TestComponent() {
            const { createChannel } = useVibeRTC()
            return (
                <button type="button" onClick={() => createChannel()}>
                    Create
                </button>
            )
        }

        const { getByText } = render(
            <VibeRTCProvider
                createSignalServer={createSignalServer}
                renderLoading={<div data-testid="loading">Initializing...</div>}
            >
                <TestComponent />
            </VibeRTCProvider>,
        )

        await act(async () => {
            getByText('Create').click()
        })

        await waitFor(() => {
            expect(createSignalServer).toHaveBeenCalled()
        })

        await waitFor(() => {
            expect(screen.getByTestId('loading').textContent).toBe('Initializing...')
        })

        // Resolve init
        resolveInit?.(mockSignalDB)

        await waitFor(() => {
            expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
        })
    })

    it('getSignalDB() caches instance, does not re-initialize', async () => {
        const mockSignalDB = createMockSignalDB()
        const createSignalServer = vi.fn().mockResolvedValue(mockSignalDB)
        mockSignalerInstance.createRoom.mockResolvedValue('test-room-id')

        function TestComponent() {
            const { createChannel } = useVibeRTC()
            return (
                <button
                    type="button"
                    onClick={async () => {
                        try {
                            await createChannel()
                        } catch {
                            // Ignore errors
                        }
                    }}
                >
                    Create
                </button>
            )
        }

        const { getByText } = render(
            <VibeRTCProvider createSignalServer={createSignalServer}>
                <TestComponent />
            </VibeRTCProvider>,
        )

        // First call
        await act(async () => {
            getByText('Create').click()
        })
        await waitFor(() => {
            expect(createSignalServer).toHaveBeenCalledTimes(1)
        })

        // Second call should not re-initialize
        await act(async () => {
            getByText('Create').click()
        })
        await waitFor(() => {
            expect(createSignalServer).toHaveBeenCalledTimes(1)
        })
    })

    it('cleanup on unmount disposes signaler and stops auto-heartbeat', async () => {
        const mockSignalDB = createMockSignalDB({
            auth: { currentUser: { uid: 'test-uid' } },
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-cleanup',
                callerUid: 'test-uid',
                calleeUid: null,
            }),
        })
        let ctx: ReturnType<typeof useVibeRTC> | null = null

        function TestComponent() {
            ctx = useVibeRTC()
            return null
        }

        const { unmount } = render(
            <VibeRTCProvider signalServer={mockSignalDB}>
                <TestComponent />
            </VibeRTCProvider>,
        )

        await waitFor(() => {
            expect(ctx).not.toBeNull()
        })

        vi.useFakeTimers()

        await act(async () => {
            await ctx?.attachAuto('room-cleanup')
        })
        await act(async () => {
            await Promise.resolve()
        })
        expect(mockSignalDB.heartbeat).toHaveBeenCalledTimes(1)

        await act(async () => {
            unmount()
        })
        expect(mockSignalerInstance.hangup).toHaveBeenCalledTimes(1)

        await act(async () => {
            vi.advanceTimersByTime(30_000)
            await Promise.resolve()
        })
        expect(mockSignalDB.heartbeat).toHaveBeenCalledTimes(1)
    })
})
