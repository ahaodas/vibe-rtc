import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toSessionPath } from '@/features/demo/model/routes'
import { HomePage } from '@/features/demo/pages/HomePage'

const mockNavigate = vi.fn()
const mockCreateChannel = vi.fn()

const mockRtc = {
    createChannel: mockCreateChannel,
    overallStatusText: '',
    booting: false,
}

vi.mock('@vibe-rtc/rtc-react', () => ({
    useVibeRTC: () => mockRtc,
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
        mockRtc.booting = false
        mockRtc.overallStatusText = ''
    })

    it('creates default room and navigates to caller attach route', async () => {
        mockCreateChannel.mockResolvedValueOnce('room-default')
        render(<HomePage />)

        fireEvent.click(screen.getByTestId('create-room-default-btn'))

        expect(screen.getByTestId('create-room-overlay')).toBeInTheDocument()
        await waitFor(() => {
            expect(mockCreateChannel).toHaveBeenCalledWith()
        })
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(
                toSessionPath('caller', 'room-default', 'default'),
                {
                    state: { alreadyAttached: true },
                },
            )
        })
    })

    it('creates native room and navigates with native strategy query', async () => {
        mockCreateChannel.mockResolvedValueOnce('room-native')
        render(<HomePage />)

        fireEvent.click(screen.getByTestId('create-room-native-btn'))

        await waitFor(() => {
            expect(mockCreateChannel).toHaveBeenCalledWith({
                connectionStrategy: 'BROWSER_NATIVE',
            })
        })
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(
                toSessionPath('caller', 'room-native', 'native'),
                {
                    state: { alreadyAttached: true },
                },
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
