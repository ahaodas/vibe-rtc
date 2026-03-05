import type { ReactNode } from 'react'
import { AppButton } from '@/shared/ui/AppButton'

type AppModalProps = {
    title: string
    children: ReactNode
    footer?: ReactNode
    onClose?: () => void
    closeLabel?: string
    variant?: 'default' | 'error'
    size?: 'default' | 'leave' | 'qr'
    backdropClassName?: string
    modalClassName?: string
    testId?: string
    titleTestId?: string
}

export function AppModal({
    title,
    children,
    footer,
    onClose,
    closeLabel = 'Close dialog',
    variant = 'default',
    size = 'default',
    backdropClassName,
    modalClassName,
    testId,
    titleTestId,
}: AppModalProps) {
    const backdropClasses = backdropClassName ?? 'qrModalBackdrop'
    const baseClass = size === 'qr' ? 'qrModal' : 'appModal'
    const errorClass = variant === 'error' && size !== 'qr' ? ' appModalError' : ''
    const leaveClass = size === 'leave' ? ' leaveModal' : ''
    const composedClassName = `${baseClass}${errorClass}${leaveClass}${modalClassName ? ` ${modalClassName}` : ''}`

    return (
        <div className={backdropClasses} role="dialog" aria-modal="true" data-testid={testId}>
            <section className={composedClassName}>
                <div className="qrModalHeader">
                    <h2 className="qrModalTitle" data-testid={titleTestId}>
                        {title}
                    </h2>
                    {onClose ? (
                        <AppButton
                            className="close"
                            aria-label={closeLabel}
                            onClick={onClose}
                            testId={testId ? `${testId}-close` : undefined}
                        />
                    ) : null}
                </div>
                {children}
                {footer}
            </section>
        </div>
    )
}
