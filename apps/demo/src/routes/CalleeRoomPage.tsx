import { useVibeRTC } from '@vibe-rtc/rtc-react'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

export default function CalleeRoomPage() {
    const { roomId } = useParams<{ roomId: string }>()
    const [searchParams] = useSearchParams()

    const [messages, setMessages] = useState<string[]>([])
    const {
        status,
        lastError,
        attachAsCallee,
        sendFast,
        sendReliable,
        disconnect,
        lastFastMessage,
        lastReliableMessage,
    } = useVibeRTC()
    const strategyMode = searchParams.get('strategy') === 'native' ? 'native' : 'default'

    useEffect(() => {
        setMessages((x) => [`Fast: ${JSON.stringify(lastFastMessage)}`, ...x])
    }, [lastFastMessage])
    useEffect(() => {
        setMessages((x) => [`Reliable: ${JSON.stringify(lastReliableMessage)}`, ...x])
    }, [lastReliableMessage])

    useEffect(() => {
        if (!roomId) return
        let cancelled = false
        ;(async () => {
            try {
                await attachAsCallee(
                    roomId,
                    strategyMode === 'native'
                        ? ({ connectionStrategy: 'BROWSER_NATIVE' } as const)
                        : undefined,
                )
            } catch (e) {
                console.error(e)
            }
            if (!cancelled) {
                // noop
            }
        })()
        return () => {
            cancelled = true
        }
    }, [roomId, attachAsCallee, strategyMode])

    return (
        <div style={{ padding: 16 }}>
            <h2>Callee / Room: {roomId}</h2>

            <div style={{ marginBottom: 8 }}>
                Status: <b>{status}</b>
            </div>
            {lastError && (
                <div style={{ color: 'crimson', marginBottom: 8 }}>{lastError.message}</div>
            )}
            {status === 'connected' && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button type="button" onClick={() => sendFast('callee-fast')}>
                        Send fast
                    </button>
                    <button type="button" onClick={() => sendReliable('callee-rel')}>
                        Send reliable
                    </button>
                    <button type="button" onClick={() => disconnect()}>
                        Disconnect
                    </button>
                </div>
            )}
            <ul>
                {messages.map((m) => (
                    <li key={m}>{m}</li>
                ))}
            </ul>
        </div>
    )
}
