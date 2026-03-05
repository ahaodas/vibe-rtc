import { AppButton } from '@/shared/ui/AppButton'
import { AppInput } from '@/shared/ui/AppInput'

type MessageComposerProps = {
    value: string
    disabled: boolean
    canSendFast: boolean
    canSendReliable: boolean
    onChange: (value: string) => void
    onSendFast: () => void
    onSendReliable: () => void
}

export function MessageComposer({
    value,
    disabled,
    canSendFast,
    canSendReliable,
    onChange,
    onSendFast,
    onSendReliable,
}: MessageComposerProps) {
    return (
        <div className="composer" data-testid="message-composer">
            <AppInput
                className="composerInput"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="Type a message..."
                disabled={disabled}
                testId="message-composer-input"
            />
            <AppButton
                onClick={onSendFast}
                disabled={!canSendFast}
                testId="message-composer-fast-btn"
            >
                Fast
            </AppButton>
            <AppButton
                onClick={onSendReliable}
                disabled={!canSendReliable}
                testId="message-composer-reliable-btn"
            >
                Reliable
            </AppButton>
        </div>
    )
}
