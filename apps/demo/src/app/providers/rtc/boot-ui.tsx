import type { ReactNode } from 'react'
import { PROGRESS_STEP_PX } from '@/features/demo/model/constants'
import { SegmentedProgressBar } from '@/shared/ui/SegmentedProgressBar'

export function BootLoadingOverlay() {
    return (
        <div className="appModalBackdrop" aria-live="polite" data-testid="rtc-boot-loading">
            <section className="appModal">
                <h2 className="appModalTitle" data-testid="rtc-boot-loading-title">
                    Loading signaling...
                </h2>
                <p className="appModalMessage" data-testid="rtc-boot-loading-message">
                    Initializing signaling adapter and auth.
                </p>
                <div className="appProgressMeta" data-testid="rtc-boot-loading-progress-meta">
                    100%
                </div>
                <SegmentedProgressBar
                    ratio={1}
                    stepPx={PROGRESS_STEP_PX}
                    className="cs-progress-bar appProgress"
                    testId="rtc-boot-loading-progress"
                    barTestId="rtc-boot-loading-progress-bar"
                />
            </section>
        </div>
    )
}

export function renderRtcBootError(error: { message: string }): ReactNode {
    return (
        <div
            className="appModalBackdrop"
            role="alert"
            aria-live="assertive"
            data-testid="rtc-boot-error"
        >
            <section className="appModal appModalError">
                <h2 className="appModalTitle" data-testid="rtc-boot-error-title">
                    Signaling initialization failed
                </h2>
                <p className="appModalMessage" data-testid="rtc-boot-error-message">
                    {error.message}
                </p>
            </section>
        </div>
    )
}
