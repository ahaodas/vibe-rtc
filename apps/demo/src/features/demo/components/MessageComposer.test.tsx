import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageComposer } from '@/features/demo/components/MessageComposer'

describe('MessageComposer', () => {
    it('reflects disabled and send-availability state', () => {
        render(
            <MessageComposer
                value="hello"
                disabled
                canSendFast={false}
                canSendReliable
                onChange={vi.fn()}
                onSendFast={vi.fn()}
                onSendReliable={vi.fn()}
            />,
        )

        expect(screen.getByTestId('message-composer-input')).toBeDisabled()
        expect(screen.getByTestId('message-composer-fast-btn')).toBeDisabled()
        expect(screen.getByTestId('message-composer-reliable-btn')).toBeEnabled()
    })

    it('forwards change and send callbacks', () => {
        const onChange = vi.fn()
        const onSendFast = vi.fn()
        const onSendReliable = vi.fn()

        render(
            <MessageComposer
                value=""
                disabled={false}
                canSendFast
                canSendReliable
                onChange={onChange}
                onSendFast={onSendFast}
                onSendReliable={onSendReliable}
            />,
        )

        fireEvent.change(screen.getByTestId('message-composer-input'), {
            target: { value: 'new-message' },
        })
        fireEvent.click(screen.getByTestId('message-composer-fast-btn'))
        fireEvent.click(screen.getByTestId('message-composer-reliable-btn'))

        expect(onChange).toHaveBeenCalledWith('new-message')
        expect(onSendFast).toHaveBeenCalledTimes(1)
        expect(onSendReliable).toHaveBeenCalledTimes(1)
    })
})
