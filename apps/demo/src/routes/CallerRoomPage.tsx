import { useVibeRTC } from '@vibe-rtc/rtc-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

export default function CallerRoomPage() {
    const { roomId } = useParams<{ roomId: string }>()
    const [searchParams] = useSearchParams()
    const [messages, setMessages] = useState<string[]>([])
    const {
        status,
        lastError,
        attachAsCaller,
        sendFast,
        sendReliable,
        endRoom,
        lastFastMessage,
        lastReliableMessage,
    } = useVibeRTC()
    const strategyMode = searchParams.get('strategy') === 'native' ? 'native' : 'default'

    useEffect(() => {
        if (!roomId) return
        let cancelled = false
        ;(async () => {
            try {
                await attachAsCaller(
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
    }, [roomId, attachAsCaller, strategyMode])

    useEffect(() => {
        setMessages((x) => [`Fast: ${JSON.stringify(lastFastMessage)}`, ...x])
    }, [lastFastMessage])
    useEffect(() => {
        setMessages((x) => [`Reliable: ${JSON.stringify(lastReliableMessage)}`, ...x])
    }, [lastReliableMessage])

    const calleeLink = roomId
        ? strategyMode === 'native'
            ? `/callee/${roomId}?strategy=native`
            : `/callee/${roomId}`
        : ''

    return (
        <div style={{ padding: 16 }}>
            <h2>Caller / Room: {roomId}</h2>

            <div style={{ marginBottom: 8 }}>
                Status: <b>{status}</b>
            </div>
            {lastError && (
                <div style={{ color: 'crimson', marginBottom: 8 }}>{lastError.message}</div>
            )}
            {status === 'connected' && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button type="button" onClick={() => sendFast('caller-fast')}>
                        Send fast
                    </button>
                    <button type="button" onClick={() => sendReliable('caller-rel')}>
                        Send reliable
                    </button>
                    <button type="button" onClick={() => endRoom()}>
                        End room
                    </button>
                </div>
            )}

            <div style={{ marginTop: 12 }}>
                Share this link with callee:&nbsp;
                {roomId ? (
                    <Link target={'_blank'} to={calleeLink}>
                        {calleeLink}
                    </Link>
                ) : (
                    <em>no room</em>
                )}
            </div>
            <ul>
                {messages.map((m) => (
                    <li key={m}>{m}</li>
                ))}
            </ul>
        </div>
    )
}
