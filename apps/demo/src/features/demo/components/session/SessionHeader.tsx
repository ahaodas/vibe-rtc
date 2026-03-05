import { LatencyHud } from '@/features/demo/components/LatencyHud'
import { RoomIdRow } from '@/features/demo/components/RoomIdRow'
import { PROGRESS_STEP_PX } from '@/features/demo/model/constants'
import type { LatencyTone } from '@/features/demo/model/latency'
import type { AttachRole } from '@/features/demo/model/types'
import { AppButton } from '@/shared/ui/AppButton'
import { SegmentedProgressBar } from '@/shared/ui/SegmentedProgressBar'

type SelectedRoute = {
    localCandidateType?: string | null
    remoteCandidateType?: string | null
    isRelay?: boolean
}

type SessionHeaderProps = {
    role: AttachRole
    roomId: string
    netLatencyTone: LatencyTone
    netRttMs: number | null
    appPingMs: number | null
    selectedRoute?: SelectedRoute
    statusText: string
    statusClassName: string
    netWarningMessage: string | null
    connectProgressRatio: number
    showQrButton: boolean
    qrButtonDisabled: boolean
    onShowQr: () => void
    onOpenLeaveConfirm: () => void
}

export function SessionHeader({
    role,
    roomId,
    netLatencyTone,
    netRttMs,
    appPingMs,
    selectedRoute,
    statusText,
    statusClassName,
    netWarningMessage,
    connectProgressRatio,
    showQrButton,
    qrButtonDisabled,
    onShowQr,
    onOpenLeaveConfirm,
}: SessionHeaderProps) {
    return (
        <header className="screenHeader" data-testid="session-header">
            <div className="screenHeaderTop">
                <h1 data-testid="session-role-title">{role.toUpperCase()}</h1>
                <div className="screenHeaderActions">
                    <LatencyHud
                        netLatencyTone={netLatencyTone}
                        netRttMs={netRttMs}
                        appPingMs={appPingMs}
                        selectedRoute={selectedRoute}
                    />
                    <AppButton
                        className="close screenCloseBtn"
                        aria-label="Close session"
                        onClick={onOpenLeaveConfirm}
                        testId="session-close-btn"
                    />
                </div>
            </div>

            <RoomIdRow
                roomId={roomId}
                showQrButton={showQrButton}
                qrButtonDisabled={qrButtonDisabled}
                onShowQr={onShowQr}
            />

            <p className={statusClassName} data-testid="session-status-text">
                {statusText}
            </p>

            {netWarningMessage ? (
                <p className="statusWarning" data-testid="session-net-warning">
                    {netWarningMessage}
                </p>
            ) : null}

            <SegmentedProgressBar
                ratio={connectProgressRatio}
                stepPx={PROGRESS_STEP_PX}
                className="cs-progress-bar statusProgress"
                testId="session-connect-progress"
                barTestId="session-connect-progress-bar"
            />
        </header>
    )
}
