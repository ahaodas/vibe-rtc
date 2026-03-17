import { fireEvent, render, screen } from '@testing-library/react'
import type { VibeRTCOperationLogEntry } from '@vibe-rtc/rtc-react'
import { describe, expect, it, vi } from 'vitest'
import { OperationLog } from '@/features/demo/components/OperationLog'
import { isChannelMessage } from '@/features/demo/model/sessionLog'

function makeEntry(
    at: number,
    scope: VibeRTCOperationLogEntry['scope'],
    message: string,
    event?: string,
): VibeRTCOperationLogEntry {
    return { at, scope, message, event }
}

describe('OperationLog', () => {
    it('renders empty state when there are no visible entries', () => {
        render(
            <OperationLog
                entries={[]}
                hideConnectionMessages
                onHideConnectionMessagesChange={vi.fn()}
                isChannelMessage={isChannelMessage}
            />,
        )

        expect(screen.getByTestId('operation-log-empty')).toBeInTheDocument()
        expect(screen.queryByTestId('operation-log-item-0')).not.toBeInTheDocument()
    })

    it('renders scope labels and channel marker for message events', () => {
        render(
            <OperationLog
                entries={[
                    makeEntry(1, 'data', 'fast message', 'message:in-fast'),
                    makeEntry(2, 'webrtc', 'ice connected', 'ice=connected'),
                ]}
                hideConnectionMessages={false}
                onHideConnectionMessagesChange={vi.fn()}
                isChannelMessage={isChannelMessage}
            />,
        )

        expect(screen.getByTestId('operation-log-item-0')).toHaveTextContent('CHANNEL')
        expect(screen.getByTestId('operation-log-item-0')).toHaveTextContent('fast message')

        expect(screen.getByTestId('operation-log-item-1')).toHaveTextContent('webrtc')
        expect(screen.getByTestId('operation-log-item-1')).toHaveTextContent('ice connected')
    })

    it('calls hide-toggle callback with checkbox value', () => {
        const onHideConnectionMessagesChange = vi.fn()

        render(
            <OperationLog
                entries={[]}
                hideConnectionMessages
                onHideConnectionMessagesChange={onHideConnectionMessagesChange}
                isChannelMessage={isChannelMessage}
            />,
        )

        fireEvent.click(screen.getByTestId('hide-connection-messages-toggle'))

        expect(onHideConnectionMessagesChange).toHaveBeenCalledTimes(1)
        expect(onHideConnectionMessagesChange).toHaveBeenCalledWith(false)
    })
})
