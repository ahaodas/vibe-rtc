import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionOverlays } from '@/features/demo/components/session/SessionOverlays'

type OverlayProps = Parameters<typeof SessionOverlays>[0]

function makeProps(overrides: Partial<OverlayProps> = {}): OverlayProps {
    return {
        role: 'caller',
        roomId: 'room-1',
        isRoomNotFoundError: false,
        isTakeoverError: false,
        roomNotFoundModalOpen: false,
        roomOccupiedModalOpen: false,
        takeoverModalOpen: false,
        securityTakeoverDetected: false,
        takeoverBySessionId: null,
        leaveConfirmOpen: false,
        leavePending: false,
        removeRoomOnLeave: true,
        qrModalOpen: false,
        channelReadyForMessages: false,
        calleeUrl: '',
        calleeQrDataUrl: '',
        onBackToMain: vi.fn(),
        onSetRoomNotFoundModalOpen: vi.fn(),
        onSetRoomOccupiedModalOpen: vi.fn(),
        onSetLeaveConfirmOpen: vi.fn(),
        onSetRemoveRoomOnLeave: vi.fn(),
        onCloseSession: vi.fn(),
        onSetQrModalOpen: vi.fn(),
        ...overrides,
    }
}

describe('SessionOverlays', () => {
    it('shows room-not-found modal and wires actions', () => {
        const props = makeProps({
            roomNotFoundModalOpen: true,
            isRoomNotFoundError: true,
        })

        render(<SessionOverlays {...props} />)

        fireEvent.click(screen.getByTestId('room-not-found-back-btn'))
        fireEvent.click(screen.getByTestId('room-not-found-close-btn'))

        expect(screen.getByTestId('room-not-found-modal')).toBeInTheDocument()
        expect(props.onBackToMain).toHaveBeenCalledTimes(1)
        expect(props.onSetRoomNotFoundModalOpen).toHaveBeenCalledWith(false)
    })

    it('shows room-occupied modal and close action', () => {
        const props = makeProps({
            roomOccupiedModalOpen: true,
        })

        render(<SessionOverlays {...props} />)

        fireEvent.click(screen.getByTestId('room-occupied-close-btn'))

        expect(screen.getByTestId('room-occupied-modal')).toBeInTheDocument()
        expect(props.onSetRoomOccupiedModalOpen).toHaveBeenCalledWith(false)
    })

    it('shows takeover modal and owner session id when present', () => {
        const props = makeProps({
            takeoverModalOpen: true,
            isTakeoverError: true,
            takeoverBySessionId: 'session-2',
        })

        render(<SessionOverlays {...props} />)

        fireEvent.click(screen.getByTestId('session-takeover-confirm-btn'))

        expect(screen.getByTestId('session-takeover-modal')).toBeInTheDocument()
        expect(screen.getByTestId('session-takeover-owner')).toHaveTextContent(
            'New owner session: session-2',
        )
        expect(props.onBackToMain).toHaveBeenCalledTimes(1)
    })

    it('shows leave modal for caller with remove-room controls', () => {
        const props = makeProps({
            leaveConfirmOpen: true,
            removeRoomOnLeave: true,
        })

        render(<SessionOverlays {...props} />)

        fireEvent.click(screen.getByTestId('leave-remove-room-checkbox-input'))
        fireEvent.click(screen.getByTestId('leave-session-cancel-btn'))
        fireEvent.click(screen.getByTestId('leave-session-confirm-btn'))

        expect(screen.getByTestId('leave-session-modal')).toBeInTheDocument()
        expect(screen.getByTestId('leave-session-message')).toHaveTextContent(
            'Room will be removed.',
        )
        expect(props.onSetRemoveRoomOnLeave).toHaveBeenCalledWith(false)
        expect(props.onSetLeaveConfirmOpen).toHaveBeenCalledWith(false)
        expect(props.onCloseSession).toHaveBeenCalledTimes(1)
    })

    it('shows qr loading modal for caller before channel becomes ready', () => {
        const props = makeProps({
            qrModalOpen: true,
            calleeUrl: 'https://example.test/#/attach/callee/room-1',
            calleeQrDataUrl: '',
            channelReadyForMessages: false,
        })

        render(<SessionOverlays {...props} />)

        expect(screen.getByTestId('callee-qr-modal')).toBeInTheDocument()
        expect(screen.getByTestId('callee-qr-loading')).toBeInTheDocument()
    })

    it('hides qr modal once channel is ready', () => {
        const props = makeProps({
            qrModalOpen: true,
            calleeUrl: 'https://example.test/#/attach/callee/room-1',
            calleeQrDataUrl: 'data:image/png;base64,AAA',
            channelReadyForMessages: true,
        })

        render(<SessionOverlays {...props} />)

        expect(screen.queryByTestId('callee-qr-modal')).not.toBeInTheDocument()
    })
})
