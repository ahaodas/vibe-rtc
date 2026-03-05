import { RoomIdRow } from '@/features/demo/components/RoomIdRow'
import type { AttachRole } from '@/features/demo/model/types'
import { AppButton } from '@/shared/ui/AppButton'
import { AppCheckbox } from '@/shared/ui/AppCheckbox'
import { AppModal } from '@/shared/ui/AppModal'

type SessionOverlaysProps = {
    role: AttachRole
    roomId: string
    isRoomNotFoundError: boolean
    isTakeoverError: boolean
    roomNotFoundModalOpen: boolean
    roomOccupiedModalOpen: boolean
    takeoverModalOpen: boolean
    securityTakeoverDetected: boolean
    takeoverBySessionId: string | null
    leaveConfirmOpen: boolean
    leavePending: boolean
    removeRoomOnLeave: boolean
    qrModalOpen: boolean
    channelReadyForMessages: boolean
    calleeUrl: string
    calleeQrDataUrl: string
    onBackToMain: () => void
    onSetRoomNotFoundModalOpen: (value: boolean) => void
    onSetRoomOccupiedModalOpen: (value: boolean) => void
    onSetLeaveConfirmOpen: (value: boolean) => void
    onSetRemoveRoomOnLeave: (value: boolean) => void
    onCloseSession: () => void
    onSetQrModalOpen: (value: boolean) => void
}

export function SessionOverlays({
    role,
    roomId,
    isRoomNotFoundError,
    isTakeoverError,
    roomNotFoundModalOpen,
    roomOccupiedModalOpen,
    takeoverModalOpen,
    securityTakeoverDetected,
    takeoverBySessionId,
    leaveConfirmOpen,
    leavePending,
    removeRoomOnLeave,
    qrModalOpen,
    channelReadyForMessages,
    calleeUrl,
    calleeQrDataUrl,
    onBackToMain,
    onSetRoomNotFoundModalOpen,
    onSetRoomOccupiedModalOpen,
    onSetLeaveConfirmOpen,
    onSetRemoveRoomOnLeave,
    onCloseSession,
    onSetQrModalOpen,
}: SessionOverlaysProps) {
    return (
        <>
            {roomNotFoundModalOpen && isRoomNotFoundError ? (
                <AppModal
                    title="Room not found"
                    variant="error"
                    size="leave"
                    testId="room-not-found-modal"
                    titleTestId="room-not-found-title"
                    onClose={() => onSetRoomNotFoundModalOpen(false)}
                >
                    <p className="appModalMessage" data-testid="room-not-found-message">
                        The requested room does not exist or is already closed.
                    </p>
                    <menu className="leaveModalActions">
                        <AppButton onClick={onBackToMain} testId="room-not-found-back-btn">
                            Back to main
                        </AppButton>
                        <AppButton
                            onClick={() => onSetRoomNotFoundModalOpen(false)}
                            testId="room-not-found-close-btn"
                        >
                            Close
                        </AppButton>
                    </menu>
                </AppModal>
            ) : null}

            {roomOccupiedModalOpen ? (
                <AppModal
                    title="Room occupied"
                    variant="error"
                    size="leave"
                    testId="room-occupied-modal"
                    titleTestId="room-occupied-title"
                    onClose={() => onSetRoomOccupiedModalOpen(false)}
                >
                    <p className="appModalMessage" data-testid="room-occupied-message">
                        This room is already occupied by another active participant/session.
                    </p>
                    <menu className="leaveModalActions">
                        <AppButton onClick={onBackToMain} testId="room-occupied-back-btn">
                            Back to main
                        </AppButton>
                        <AppButton
                            onClick={() => onSetRoomOccupiedModalOpen(false)}
                            testId="room-occupied-close-btn"
                        >
                            Close
                        </AppButton>
                    </menu>
                </AppModal>
            ) : null}

            {takeoverModalOpen && (isTakeoverError || securityTakeoverDetected) ? (
                <AppModal
                    title="Session taken over"
                    variant="error"
                    size="leave"
                    testId="session-takeover-modal"
                    titleTestId="session-takeover-title"
                >
                    <p className="appModalMessage" data-testid="session-takeover-message">
                        This room slot was taken over in another tab or device. This page is now
                        inactive.
                    </p>
                    {takeoverBySessionId ? (
                        <p className="appModalMessage" data-testid="session-takeover-owner">
                            New owner session: {takeoverBySessionId}
                        </p>
                    ) : null}
                    <menu className="leaveModalActions">
                        <AppButton onClick={onBackToMain} testId="session-takeover-confirm-btn">
                            OK
                        </AppButton>
                    </menu>
                </AppModal>
            ) : null}

            {leaveConfirmOpen ? (
                <AppModal
                    title="Leave session"
                    size="leave"
                    testId="leave-session-modal"
                    titleTestId="leave-session-title"
                    onClose={() => onSetLeaveConfirmOpen(false)}
                >
                    <p className="appModalMessage" data-testid="leave-session-message">
                        Session will be interrupted. Current channel will be closed.
                        {role === 'caller' && removeRoomOnLeave ? ' Room will be removed.' : ''}
                    </p>
                    {role === 'caller' ? (
                        <AppCheckbox
                            label="Remove room"
                            wrapperClassName="leaveRoomCheckbox"
                            checked={removeRoomOnLeave}
                            onChange={(event) => onSetRemoveRoomOnLeave(event.target.checked)}
                            disabled={leavePending}
                            testId="leave-remove-room-checkbox"
                            inputTestId="leave-remove-room-checkbox-input"
                        />
                    ) : null}
                    <menu className="leaveModalActions">
                        <AppButton
                            onClick={() => onSetLeaveConfirmOpen(false)}
                            disabled={leavePending}
                            testId="leave-session-cancel-btn"
                        >
                            Cancel
                        </AppButton>
                        <AppButton
                            onClick={onCloseSession}
                            disabled={leavePending}
                            testId="leave-session-confirm-btn"
                        >
                            {leavePending ? 'Closing...' : 'End Session'}
                        </AppButton>
                    </menu>
                </AppModal>
            ) : null}

            {role === 'caller' &&
            !isTakeoverError &&
            !takeoverModalOpen &&
            !channelReadyForMessages &&
            qrModalOpen &&
            calleeUrl ? (
                <AppModal
                    title="Scan this QR code on callee device:"
                    size="qr"
                    testId="callee-qr-modal"
                    titleTestId="callee-qr-title"
                    onClose={() => onSetQrModalOpen(false)}
                    closeLabel="Hide QR dialog"
                >
                    <RoomIdRow
                        roomId={roomId}
                        inputId="qr-room-id"
                        inputTestId="qr-room-id-input"
                    />
                    <section className="qrContent" data-testid="callee-qr-content">
                        {calleeQrDataUrl ? (
                            <a
                                href={calleeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="qrLink"
                                data-testid="callee-qr-link"
                            >
                                <img
                                    className="qrImage"
                                    src={calleeQrDataUrl}
                                    alt="Callee link QR code"
                                    data-testid="callee-qr-image"
                                />
                            </a>
                        ) : (
                            <div className="qrLoading" data-testid="callee-qr-loading">
                                Generating QR...
                            </div>
                        )}
                    </section>
                </AppModal>
            ) : null}
        </>
    )
}
