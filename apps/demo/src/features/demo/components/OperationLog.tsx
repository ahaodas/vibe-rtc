import type { VibeRTCOperationLogEntry } from '@vibe-rtc/rtc-react'
import { useEffect, useRef } from 'react'
import { AppCheckbox } from '@/shared/ui/AppCheckbox'

type OperationLogProps = {
    entries: VibeRTCOperationLogEntry[]
    hideConnectionMessages: boolean
    onHideConnectionMessagesChange: (value: boolean) => void
    isChannelMessage: (entry: VibeRTCOperationLogEntry) => boolean
}

export function OperationLog({
    entries,
    hideConnectionMessages,
    onHideConnectionMessagesChange,
    isChannelMessage,
}: OperationLogProps) {
    const listRef = useRef<HTMLUListElement | null>(null)

    useEffect(() => {
        const node = listRef.current
        if (!node || entries.length === 0) return

        const animationId = window.requestAnimationFrame(() => {
            node.scrollTop = node.scrollHeight
        })

        return () => window.cancelAnimationFrame(animationId)
    }, [entries])

    return (
        <section className="chatCard" data-testid="operation-log-card">
            <div className="chatHeader">
                <div className="chatTitle" data-testid="operation-log-title">
                    Operation Log
                </div>
                <AppCheckbox
                    label="Hide connection messages"
                    wrapperClassName="logFilter"
                    checked={hideConnectionMessages}
                    onChange={(event) => onHideConnectionMessagesChange(event.target.checked)}
                    testId="hide-connection-messages-toggle-wrap"
                    inputTestId="hide-connection-messages-toggle"
                />
            </div>
            <ul ref={listRef} className="logList" data-testid="operation-log-list">
                {entries.length === 0 ? (
                    <li className="logEmpty" data-testid="operation-log-empty">
                        No visible activity yet.
                    </li>
                ) : null}
                {entries.map((entry, index) => {
                    const isMessageEntry = isChannelMessage(entry)
                    const scopeLabel = isMessageEntry ? 'CHANNEL' : entry.scope

                    return (
                        <li
                            key={`${entry.at}-${entry.scope}-${entry.event ?? 'evt'}-${index}`}
                            className={`logItem scope-${entry.scope} ${isMessageEntry ? 'isMessage' : ''}`}
                            data-testid={`operation-log-item-${index}`}
                        >
                            <span className="logMeta">
                                {new Date(entry.at).toLocaleTimeString()} | {scopeLabel}
                            </span>
                            <span className="logText">{entry.message}</span>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
