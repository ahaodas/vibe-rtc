import { useVibeRTC } from '@vibe-rtc/rtc-react'
import { useEffect, useMemo, useRef, useState } from 'react'

type LogLine = {
    at: string
    lane: 'fast' | 'reliable' | 'event'
    text: string
}

const APP_BASE_PATH = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
const toBasePath = (path: string) => `${APP_BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`
const readHashPath = () => {
    const raw = window.location.hash.replace(/^#/, '')
    if (!raw) return '/'
    return raw.startsWith('/') ? raw : `/${raw}`
}
const setHashPath = (path: string) => {
    const normalized = path.startsWith('/') ? path : `/${path}`
    window.location.hash = normalized
}

export function App() {
    const rtc = useVibeRTC()
    const [fastText, setFastText] = useState('ping-fast')
    const [reliableText, setReliableText] = useState('ping-reliable')
    const [logs, setLogs] = useState<LogLine[]>([])
    const autoRouteHandledRef = useRef<string | null>(null)
    const [hashPath, setHashPathState] = useState(readHashPath)

    useEffect(() => {
        const onHashChange = () => setHashPathState(readHashPath())
        window.addEventListener('hashchange', onHashChange)
        return () => window.removeEventListener('hashchange', onHashChange)
    }, [])

    const match = hashPath.match(/\/attach\/(caller|callee)\/([^/]+)$/)
    const routeRole = match?.[1] as 'caller' | 'callee' | undefined
    const routeRoomId = match?.[2] ? decodeURIComponent(match[2]) : ''
    const mode: 'initial' | 'caller' | 'callee' = routeRole ?? 'initial'

    const hasChannel = Boolean(rtc.signaler && rtc.roomId)
    const canSend = rtc.status === 'connected'

    const signalingState = rtc.booting
        ? 'Initializing signaling'
        : rtc.bootError
          ? 'Signaling boot error'
          : 'Signaling ready'
    const roomBusy = rtc.booting || rtc.status === 'connecting'
    const roomState = !rtc.roomId
        ? 'No room'
        : rtc.lastError?.code === 'ROOM_NOT_FOUND'
          ? 'Room removed'
          : 'Room active'
    const channelState = !hasChannel
        ? 'No channel'
        : rtc.status === 'connecting'
          ? 'Connecting'
          : rtc.status === 'connected'
            ? 'Connected'
            : rtc.status === 'disconnected'
              ? 'Disconnected'
              : rtc.status === 'error'
                ? 'Error'
                : 'Idle'
    const sendState = !hasChannel ? 'No channel' : canSend ? 'Ready to send' : 'Waiting to send'

    const callerUrl = useMemo(() => {
        if (!rtc.roomId) return ''
        return `${window.location.origin}${toBasePath('/')}#/attach/caller/${rtc.roomId}`
    }, [rtc.roomId])

    const calleeUrl = useMemo(() => {
        if (!rtc.roomId) return ''
        return `${window.location.origin}${toBasePath('/')}#/attach/callee/${rtc.roomId}`
    }, [rtc.roomId])
    const calleeQrUrl = useMemo(() => {
        if (!calleeUrl) return ''
        return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(calleeUrl)}`
    }, [calleeUrl])

    useEffect(() => {
        if (!rtc.lastFastMessage) return
        const msg = rtc.lastFastMessage
        setLogs((prev) => [
            {
                at: new Date(msg.at).toLocaleTimeString(),
                lane: 'fast',
                text: msg.data,
            },
            ...prev,
        ])
    }, [rtc.lastFastMessage])

    useEffect(() => {
        if (!rtc.lastReliableMessage) return
        const msg = rtc.lastReliableMessage
        setLogs((prev) => [
            {
                at: new Date(msg.at).toLocaleTimeString(),
                lane: 'reliable',
                text: msg.data,
            },
            ...prev,
        ])
    }, [rtc.lastReliableMessage])

    useEffect(() => {
        setLogs((prev) => [
            {
                at: new Date().toLocaleTimeString(),
                lane: 'event',
                text: `status: ${rtc.status}`,
            },
            ...prev,
        ])
    }, [rtc.status])

    useEffect(() => {
        if (!routeRole || !routeRoomId) return
        const key = `${routeRole}:${routeRoomId}`
        if (autoRouteHandledRef.current === key) return
        autoRouteHandledRef.current = key

        if (routeRole === 'caller') {
            void rtc.attachAsCaller(routeRoomId)
        } else {
            void rtc.attachAsCallee(routeRoomId)
        }
    }, [routeRole, routeRoomId, rtc.attachAsCaller, rtc.attachAsCallee])

    const createRoom = async () => {
        const roomId = await rtc.createChannel()
        setHashPath(`/attach/caller/${encodeURIComponent(roomId)}`)
        autoRouteHandledRef.current = `caller:${roomId}`
    }

    const attachCurrentRole = async () => {
        if (!routeRoomId) return
        if (mode === 'caller') await rtc.attachAsCaller(routeRoomId)
        if (mode === 'callee') await rtc.attachAsCallee(routeRoomId)
    }

    const endRoomAndReturnInitial = async () => {
        await rtc.endRoom()
        autoRouteHandledRef.current = null
        setHashPath('/')
    }

    return (
        <main className={`lab ${roomBusy ? 'isBusy' : ''}`}>
            <header className="hero">
                <div className="heroTop">
                    <h1>Vibe RTC Manual Lab</h1>
                    <div className="roleBadge">Screen: {mode.toUpperCase()}</div>
                </div>
                <p>Manual reconnect/reload and messaging checks on top of rtc-core.</p>
                <div className="flowStatus">
                    <div className="flowItem">
                        <span className="flowKey">Signaling</span>
                        <span className="flowVal">{signalingState}</span>
                    </div>
                    <div className="flowItem">
                        <span className="flowKey">Room</span>
                        <span className="flowVal">{roomState}</span>
                    </div>
                    <div className="flowItem">
                        <span className="flowKey">Channel</span>
                        <span className="flowVal">{channelState}</span>
                    </div>
                    <div className="flowItem">
                        <span className="flowKey">Send</span>
                        <span className="flowVal">{sendState}</span>
                    </div>
                </div>
                {rtc.lastError?.code === 'ROOM_NOT_FOUND' && (
                    <p className="error">
                        The room no longer exists. Ask host to create a new one.
                    </p>
                )}
            </header>

            <section className="panel">
                {mode === 'initial' && (
                    <>
                        <div className="actions">
                            <button type="button" onClick={() => void createRoom()}>
                                Create Room
                            </button>
                        </div>
                        {rtc.roomId ? (
                            <div className="actions">
                                <div className="linkbox">
                                    <a href={callerUrl} target="_blank" rel="noreferrer">
                                        {callerUrl}
                                    </a>
                                </div>
                                <div className="linkbox">
                                    <a href={calleeUrl} target="_blank" rel="noreferrer">
                                        {calleeUrl}
                                    </a>
                                </div>
                            </div>
                        ) : (
                            <p className="label">Create a room to get caller/callee links.</p>
                        )}
                    </>
                )}

                {mode !== 'initial' && (
                    <>
                        <div className="row">
                            <span className="label">Room ID</span>
                            <div className="input">{routeRoomId}</div>
                            <button type="button" onClick={() => void attachCurrentRole()}>
                                Attach as {mode}
                            </button>
                        </div>

                        <div className="actions">
                            {hasChannel && (
                                <>
                                    <button type="button" onClick={() => void rtc.disconnect()}>
                                        Disconnect Channel
                                    </button>
                                    {mode === 'caller' && (
                                        <button
                                            type="button"
                                            onClick={() => void endRoomAndReturnInitial()}
                                        >
                                            End Room (Host)
                                        </button>
                                    )}
                                </>
                            )}
                            {hasChannel && (
                                <>
                                    <button type="button" onClick={() => void rtc.reconnectSoft()}>
                                        Reconnect Soft
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            void rtc.reconnectHard({ awaitReadyMs: 12_000 })
                                        }
                                    >
                                        Reconnect Hard
                                    </button>
                                </>
                            )}
                        </div>

                        {mode === 'caller' && (
                            <>
                                <div className="linkbox">
                                    <a href={calleeUrl} target="_blank" rel="noreferrer">
                                        {calleeUrl}
                                    </a>
                                </div>
                                {calleeQrUrl && (
                                    <div className="qrbox">
                                        <img src={calleeQrUrl} alt="QR code for callee link" />
                                        <p>Scan to open callee screen on another device.</p>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </section>

            <section className="grid">
                <article className="panel">
                    <h2>Transport</h2>
                    <p>
                        Status: <b>{rtc.status}</b>
                    </p>
                    {rtc.lastError && (
                        <p className="error">
                            {rtc.lastError.code ? `${rtc.lastError.code}: ` : ''}
                            {rtc.lastError.message}
                        </p>
                    )}

                    {hasChannel ? (
                        <>
                            <div className="row">
                                <label className="label" htmlFor="fast-input">
                                    Fast
                                </label>
                                <input
                                    id="fast-input"
                                    className="input"
                                    value={fastText}
                                    onChange={(e) => setFastText(e.target.value)}
                                />
                                <button
                                    type="button"
                                    onClick={() => void rtc.sendFast(fastText)}
                                    disabled={!canSend}
                                >
                                    Send
                                </button>
                            </div>

                            <div className="row">
                                <label className="label" htmlFor="reliable-input">
                                    Reliable
                                </label>
                                <input
                                    id="reliable-input"
                                    className="input"
                                    value={reliableText}
                                    onChange={(e) => setReliableText(e.target.value)}
                                />
                                <button
                                    type="button"
                                    onClick={() => void rtc.sendReliable(reliableText)}
                                    disabled={!canSend}
                                >
                                    Send
                                </button>
                            </div>
                        </>
                    ) : (
                        <p className="label">Attach to room to enable message sending.</p>
                    )}
                </article>

                <article className="panel">
                    <h2>Debug State</h2>
                    <pre className="debug">{JSON.stringify(rtc.debugState ?? {}, null, 2)}</pre>
                </article>
            </section>

            <section className="panel">
                <h2>Message/Event Log</h2>
                <ul className="log">
                    {logs.map((l, i) => (
                        <li key={`${l.at}-${i}`}>
                            <span className={`lane lane-${l.lane}`}>{l.lane}</span>
                            <span className="time">{l.at}</span>
                            <span>{l.text}</span>
                        </li>
                    ))}
                </ul>
            </section>
        </main>
    )
}
