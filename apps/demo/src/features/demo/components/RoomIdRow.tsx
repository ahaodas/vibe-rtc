import { AppButton } from '@/shared/ui/AppButton'
import { AppInput } from '@/shared/ui/AppInput'

type RoomIdRowProps = {
    roomId: string
    showQrButton?: boolean
    qrButtonDisabled?: boolean
    onShowQr?: () => void
    inputId?: string
    inputTestId?: string
}

export function RoomIdRow({
    roomId,
    showQrButton = false,
    qrButtonDisabled = false,
    onShowQr,
    inputId = 'room-id',
    inputTestId = 'session-room-id-input',
}: RoomIdRowProps) {
    return (
        <div className="roomRow" data-testid="session-room-row">
            <label htmlFor={inputId} className="roomLabel">
                Room ID
            </label>
            <div className="roomRowMain">
                <AppInput
                    id={inputId}
                    className="roomInput"
                    readOnly
                    value={roomId}
                    testId={inputTestId}
                />
                {showQrButton ? (
                    <AppButton
                        className="roomQrBtn"
                        onClick={onShowQr}
                        disabled={qrButtonDisabled}
                        testId="show-qr-btn"
                    >
                        Show QR
                    </AppButton>
                ) : null}
            </div>
        </div>
    )
}
