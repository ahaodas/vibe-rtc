import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toSessionPath } from '@/features/demo/model/routes'
import { HomePage } from '@/features/demo/pages/HomePage'

const mockNavigate = vi.fn()
const mockUseVibeRTCSession = vi.fn()

vi.mock('@vibe-rtc/rtc-react', () => ({
    useVibeRTCSession: (options: unknown) => mockUseVibeRTCSession(options),
}))

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    }
})

describe('HomePage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockUseVibeRTCSession.mockImplementation((options: Record<string, unknown>) => {
            const connectionStrategy =
                options.connectionStrategy === 'BROWSER_NATIVE' ? 'BROWSER_NATIVE' : 'LAN_FIRST'
            const invite =
                options.autoCreate === true
                    ? {
                          roomId:
                              connectionStrategy === 'BROWSER_NATIVE'
                                  ? 'room-native'
                                  : 'room-default',
                          sessionId:
                              connectionStrategy === 'BROWSER_NATIVE'
                                  ? 'session-native'
                                  : 'session-default',
                          connectionStrategy,
                      }
                    : null

            return {
                invite,
                joinUrl: null,
                status: 'idle',
                overallStatus: 'none',
                overallStatusText: '',
                lastError: undefined,
                debugState: undefined,
                operationLog: [],
                clearOperationLog: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                endRoom: vi.fn(),
                sendFast: vi.fn(),
                sendReliable: vi.fn(),
                reconnectSoft: vi.fn(),
                reconnectHard: vi.fn(),
            }
        })
    })

    it('creates default room and navigates to caller attach route', async () => {
        render(<HomePage />)

        fireEvent.click(screen.getByTestId('create-room-default-btn'))

        expect(screen.getByTestId('create-room-overlay')).toBeInTheDocument()
        await waitFor(() => {
            expect(mockUseVibeRTCSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    role: 'caller',
                    invite: null,
                    autoStart: true,
                    autoCreate: true,
                    debug: true,
                    logMessages: true,
                    onPing: expect.any(Function),
                }),
            )
        })
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(
                toSessionPath('caller', 'room-default', 'default', 'session-default'),
            )
        })
    })

    it('creates native room and navigates with native strategy query', async () => {
        render(<HomePage />)

        fireEvent.click(screen.getByTestId('create-room-native-btn'))

        await waitFor(() => {
            expect(mockUseVibeRTCSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    connectionStrategy: 'BROWSER_NATIVE',
                    autoStart: true,
                    autoCreate: true,
                }),
            )
        })
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(
                toSessionPath('caller', 'room-native', 'native', 'session-native'),
            )
        })
    })

    it('opens join modal and submits trimmed room id', async () => {
        render(<HomePage />)

        fireEvent.click(screen.getByTestId('open-join-room-btn'))

        const submitButton = screen.getByTestId('join-room-submit-btn')
        expect(screen.getByTestId('join-room-modal')).toBeInTheDocument()
        expect(submitButton).toBeDisabled()

        fireEvent.change(screen.getByTestId('join-room-input'), {
            target: { value: '  room-join  ' },
        })
        expect(submitButton).toBeEnabled()

        fireEvent.click(submitButton)

        expect(mockNavigate).toHaveBeenCalledWith(toSessionPath('callee', 'room-join', 'default'))
        await waitFor(() => {
            expect(screen.queryByTestId('join-room-modal')).not.toBeInTheDocument()
        })
    })
})
