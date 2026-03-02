import { useVibeRTC, type VibeRTCOperationLogEntry } from '@vibe-rtc/rtc-react'
import * as QRCode from 'qrcode'
import { useEffect, useMemo, useRef, useState } from 'react'

const APP_BASE_PATH = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
const toBasePath = (path: string) => `${APP_BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`
const QR_FOREGROUND = '#c4b550ff'
const QR_BACKGROUND = '#3e4637'
const PROGRESS_STEP_PX = 10
const CREATE_PROGRESS_MAX_BEFORE_READY = 0.92
const CREATE_PROGRESS_IDLE_TICK_MS = 120
const CREATE_PROGRESS_IDLE_STEP = 0.008
const CREATE_PROGRESS_FINISH_TICK_MS = 40
const CREATE_PROGRESS_FINISH_STEP = 0.08
const CONNECT_PROGRESS_MAX_BEFORE_READY = 0.92
const CONNECT_PROGRESS_TICK_MS = 140
const CONNECT_PROGRESS_STEP = 0.01
const MAX_VISIBLE_LOG_ENTRIES = 120
const WARNING_STICKY_MS = 8000
const WARNING_COOLDOWN_MS = 15000
const HIGH_DIRECT_NET_RTT_MS = 120
const HIGH_DIRECT_NET_RTT_STREAK = 5
const readHashPath = () => {
    const raw = window.location.hash.replace(/^#/, '')
    if (!raw) return '/'
    return raw.startsWith('/') ? raw : `/${raw}`
}
const setHashPath = (path: string) => {
    const normalized = path.startsWith('/') ? path : `/${path}`
    window.location.hash = normalized
}

type ScreenMode = 'initial' | 'caller' | 'callee'

function isChannelMessage(entry: VibeRTCOperationLogEntry): boolean {
    return entry.event?.startsWith('message:') ?? false
}

type LatencyTone = 'none' | 'good' | 'ok' | 'warn' | 'bad'
type WarningKey = 'relay' | 'high-direct'

function resolveLatencyTone(latencyMs: number | null): LatencyTone {
    if (latencyMs == null) return 'none'
    if (latencyMs < 20) return 'good'
    if (latencyMs < 60) return 'ok'
    if (latencyMs < 120) return 'warn'
    return 'bad'
}

export function App() {
    const rtc = useVibeRTC()
    const [messageText, setMessageText] = useState('')
    const [createPending, setCreatePending] = useState(false)
    const [joinModalOpen, setJoinModalOpen] = useState(false)
    const [joinRoomIdInput, setJoinRoomIdInput] = useState('')
    const [roomNotFoundModalOpen, setRoomNotFoundModalOpen] = useState(false)
    const [createProgressRatio, setCreateProgressRatio] = useState(0)
    const [createProgressTrackWidthPx, setCreateProgressTrackWidthPx] = useState(0)
    const [connectProgressRatio, setConnectProgressRatio] = useState(0)
    const [connectProgressTrackWidthPx, setConnectProgressTrackWidthPx] = useState(0)
    const [hideConnectionMessages, setHideConnectionMessages] = useState(true)
    const [qrModalOpen, setQrModalOpen] = useState(false)
    const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
    const [leavePending, setLeavePending] = useState(false)
    const [removeRoomOnLeave, setRemoveRoomOnLeave] = useState(true)
    const [netWarning, setNetWarning] = useState<{ key: WarningKey; message: string } | null>(null)
    const [calleeQrDataUrl, setCalleeQrDataUrl] = useState('')
    const autoRouteHandledRef = useRef<string | null>(null)
    const createProgressTrackRef = useRef<HTMLDivElement | null>(null)
    const connectProgressTrackRef = useRef<HTMLDivElement | null>(null)
    const prevOverallStatusRef = useRef<string | null>(null)
    const warningTimerRef = useRef<number | undefined>(undefined)
    const warningCooldownRef = useRef<Record<WarningKey, number>>({ relay: 0, 'high-direct': 0 })
    const highDirectStreakRef = useRef(0)
    const prevModeRef = useRef<ScreenMode>('initial')
    const modeEffectBootRef = useRef(false)
    const [hashPath, setHashPathState] = useState(readHashPath)

    useEffect(() => {
        const onHashChange = () => setHashPathState(readHashPath())
        window.addEventListener('hashchange', onHashChange)
        return () => window.removeEventListener('hashchange', onHashChange)
    }, [])

    const match = hashPath.match(/\/attach\/(caller|callee)\/([^/]+)$/)
    const routeRole = match?.[1] as 'caller' | 'callee' | undefined
    const routeRoomId = match?.[2] ? decodeURIComponent(match[2]) : ''
    const mode: ScreenMode = routeRole ?? 'initial'

    const fastState = rtc.debugState?.fast?.state
    const reliableState = rtc.debugState?.reliable?.state
    const fastReady = fastState === 'open' || (rtc.overallStatus === 'connected' && !fastState)
    const reliableReady =
        reliableState === 'open' || (rtc.overallStatus === 'connected' && !reliableState)
    const channelReadyForMessages = fastReady || reliableReady
    const appSmoothedPing = rtc.debugState?.ping?.smoothedRttMs
    const appLastPing = rtc.debugState?.ping?.lastRttMs
    const appPingRaw = typeof appSmoothedPing === 'number' ? appSmoothedPing : appLastPing
    const appPingMs =
        typeof appPingRaw === 'number' && Number.isFinite(appPingRaw) && appPingRaw >= 0
            ? Math.round(appPingRaw)
            : null
    const netRttRaw = rtc.debugState?.netRtt?.rttMs
    const netRttMs =
        typeof netRttRaw === 'number' && Number.isFinite(netRttRaw) && netRttRaw >= 0
            ? Math.round(netRttRaw)
            : null
    const selectedPath = rtc.debugState?.selectedPath
    const isRelayRoute = rtc.debugState?.netRtt?.route?.isRelay === true || selectedPath === 'relay'
    const routeLabel =
        selectedPath === 'host' || selectedPath === 'srflx'
            ? 'DIRECT'
            : isRelayRoute
              ? 'TURN'
              : '--'
    const netLatencyTone = resolveLatencyTone(netRttMs)
    const hasMessage = messageText.trim().length > 0
    const normalizedJoinRoomId = joinRoomIdInput.trim()
    const canJoinRoom = normalizedJoinRoomId.length > 0
    const isRoomNotFoundError =
        rtc.lastError?.code === 'ROOM_NOT_FOUND' ||
        /room not found|no such document/i.test(rtc.lastError?.message ?? '')
    const orderedLog = useMemo(() => [...rtc.operationLog].reverse(), [rtc.operationLog])
    const visibleLog = useMemo(() => {
        const filtered = hideConnectionMessages
            ? orderedLog.filter((entry) => isChannelMessage(entry))
            : orderedLog
        return filtered.slice(-MAX_VISIBLE_LOG_ENTRIES)
    }, [orderedLog, hideConnectionMessages])

    const calleeUrl = useMemo(() => {
        if (!routeRoomId) return ''
        return `${window.location.origin}${toBasePath('/')}#/attach/callee/${encodeURIComponent(routeRoomId)}`
    }, [routeRoomId])

    useEffect(() => {
        let cancelled = false
        if (!calleeUrl) {
            setCalleeQrDataUrl('')
            return
        }

        void QRCode.toDataURL(calleeUrl, {
            width: 768,
            margin: 0,
            color: {
                dark: QR_FOREGROUND,
                light: QR_BACKGROUND,
            },
        })
            .then((dataUrl) => {
                if (!cancelled) setCalleeQrDataUrl(dataUrl)
            })
            .catch(() => {
                if (!cancelled) setCalleeQrDataUrl('')
            })

        return () => {
            cancelled = true
        }
    }, [calleeUrl])

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

    useEffect(() => {
        if (!isRoomNotFoundError) return
        setRoomNotFoundModalOpen(true)
    }, [isRoomNotFoundError])

    useEffect(() => {
        if (mode === 'caller' && routeRoomId && !channelReadyForMessages) {
            setQrModalOpen(true)
            return
        }
        setQrModalOpen(false)
    }, [mode, routeRoomId, channelReadyForMessages])

    useEffect(() => {
        return () => {
            if (warningTimerRef.current) {
                window.clearTimeout(warningTimerRef.current)
                warningTimerRef.current = undefined
            }
        }
    }, [])

    useEffect(() => {
        const showWarning = (key: WarningKey, message: string) => {
            const nowTs = Date.now()
            const lastTs = warningCooldownRef.current[key] ?? 0
            if (nowTs - lastTs < WARNING_COOLDOWN_MS) return

            warningCooldownRef.current[key] = nowTs
            setNetWarning({ key, message })

            if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)
            warningTimerRef.current = window.setTimeout(() => {
                setNetWarning((current) => (current?.key === key ? null : current))
                warningTimerRef.current = undefined
            }, WARNING_STICKY_MS)
        }

        if (isRelayRoute) {
            highDirectStreakRef.current = 0
            if (netWarning?.key === 'relay') setNetWarning(null)
            return
        }

        if (typeof netRttMs === 'number' && netRttMs > HIGH_DIRECT_NET_RTT_MS) {
            highDirectStreakRef.current += 1
            if (highDirectStreakRef.current >= HIGH_DIRECT_NET_RTT_STREAK) {
                showWarning(
                    'high-direct',
                    'High network RTT on direct connection — check Wi-Fi / power saving / device load.',
                )
                highDirectStreakRef.current = 0
            }
            return
        }

        highDirectStreakRef.current = 0
    }, [isRelayRoute, netRttMs, netWarning?.key])

    useEffect(() => {
        if (!createPending || rtc.booting) return
        const node = createProgressTrackRef.current
        if (!node) return

        const updateTrackWidth = () => {
            setCreateProgressTrackWidthPx(Math.max(0, Math.floor(node.clientWidth)))
        }
        updateTrackWidth()

        const resizeObserver = new ResizeObserver(updateTrackWidth)
        resizeObserver.observe(node)
        return () => resizeObserver.disconnect()
    }, [createPending, rtc.booting])

    useEffect(() => {
        if (mode === 'initial') return
        const node = connectProgressTrackRef.current
        if (!node) return

        const updateTrackWidth = () => {
            setConnectProgressTrackWidthPx(Math.max(0, Math.floor(node.clientWidth)))
        }
        updateTrackWidth()

        const resizeObserver = new ResizeObserver(updateTrackWidth)
        resizeObserver.observe(node)
        return () => resizeObserver.disconnect()
    }, [mode])

    useEffect(() => {
        if (mode === 'initial') return
        if (channelReadyForMessages || rtc.overallStatus === 'error') {
            setConnectProgressRatio(0)
            return
        }

        const timerId = window.setInterval(() => {
            setConnectProgressRatio((current) =>
                current >= CONNECT_PROGRESS_MAX_BEFORE_READY
                    ? current
                    : Math.min(CONNECT_PROGRESS_MAX_BEFORE_READY, current + CONNECT_PROGRESS_STEP),
            )
        }, CONNECT_PROGRESS_TICK_MS)
        return () => window.clearInterval(timerId)
    }, [mode, channelReadyForMessages, rtc.overallStatus])

    useEffect(() => {
        if (mode === 'initial') {
            prevOverallStatusRef.current = null
            setConnectProgressRatio(0)
            return
        }

        const previous = prevOverallStatusRef.current
        if (rtc.overallStatus === 'connecting' && previous !== 'connecting') {
            setConnectProgressRatio(0)
        }
        prevOverallStatusRef.current = rtc.overallStatus
    }, [mode, rtc.overallStatus])

    useEffect(() => {
        if (!modeEffectBootRef.current) {
            modeEffectBootRef.current = true
            prevModeRef.current = mode
            return
        }

        const previousMode = prevModeRef.current
        prevModeRef.current = mode

        if (mode === 'initial' && previousMode !== 'initial') {
            setMessageText('')
            setQrModalOpen(false)
            setLeaveConfirmOpen(false)
            setLeavePending(false)
            setRemoveRoomOnLeave(true)
            setNetWarning(null)
            setConnectProgressRatio(0)
            rtc.clearOperationLog()
            void rtc.disconnect().catch(() => {})
        }
    }, [mode, rtc])

    const createTrackWidthPx = Number.isFinite(createProgressTrackWidthPx)
        ? createProgressTrackWidthPx
        : 0
    const createRatio = Number.isFinite(createProgressRatio) ? createProgressRatio : 0
    const createProgressSegmentCount = Math.max(
        1,
        Math.floor(createTrackWidthPx / PROGRESS_STEP_PX),
    )
    const createProgressFilledSegments = Math.min(
        createProgressSegmentCount,
        Math.floor(createRatio * createProgressSegmentCount),
    )
    const createProgressWidthPercentRaw =
        (createProgressFilledSegments / createProgressSegmentCount) * 100
    const createProgressWidthPercent = Number.isFinite(createProgressWidthPercentRaw)
        ? createProgressWidthPercentRaw
        : 0
    const createProgressPercent = Math.round(createProgressWidthPercent)
    const createProgressPercentSafe = Number.isFinite(createProgressPercent)
        ? createProgressPercent
        : 0
    const createProgressWidthPercentSafe = Number.isFinite(createProgressWidthPercent)
        ? createProgressWidthPercent
        : 0
    const connectTrackWidthPx = Number.isFinite(connectProgressTrackWidthPx)
        ? connectProgressTrackWidthPx
        : 0
    const connectRatio = Number.isFinite(connectProgressRatio) ? connectProgressRatio : 0
    const connectProgressSegmentCount = Math.max(
        1,
        Math.floor(connectTrackWidthPx / PROGRESS_STEP_PX),
    )
    const connectProgressFilledSegments =
        channelReadyForMessages || rtc.overallStatus === 'error'
            ? 0
            : Math.min(
                  connectProgressSegmentCount,
                  Math.floor(connectRatio * connectProgressSegmentCount),
              )
    const connectProgressWidthPercentRaw =
        (connectProgressFilledSegments / connectProgressSegmentCount) * 100
    const connectProgressWidthPercent = Number.isFinite(connectProgressWidthPercentRaw)
        ? connectProgressWidthPercentRaw
        : 0
    const connectProgressWidthPercentSafe = Number.isFinite(connectProgressWidthPercent)
        ? connectProgressWidthPercent
        : 0

    const createRoom = async () => {
        setCreatePending(true)
        setCreateProgressRatio(0)

        const idleTimer = window.setInterval(() => {
            setCreateProgressRatio((current) =>
                current >= CREATE_PROGRESS_MAX_BEFORE_READY
                    ? current
                    : Math.min(
                          CREATE_PROGRESS_MAX_BEFORE_READY,
                          current + CREATE_PROGRESS_IDLE_STEP,
                      ),
            )
        }, CREATE_PROGRESS_IDLE_TICK_MS)

        try {
            const roomId = await rtc.createChannel()

            await new Promise<void>((resolve) => {
                const finishTimer = window.setInterval(() => {
                    let finished = false
                    setCreateProgressRatio((current) => {
                        const next = Math.min(1, current + CREATE_PROGRESS_FINISH_STEP)
                        finished = next >= 1
                        return next
                    })
                    if (finished) {
                        window.clearInterval(finishTimer)
                        resolve()
                    }
                }, CREATE_PROGRESS_FINISH_TICK_MS)
            })

            setHashPath(`/attach/caller/${encodeURIComponent(roomId)}`)
            autoRouteHandledRef.current = `caller:${roomId}`
            setCreateProgressRatio(0)
        } finally {
            window.clearInterval(idleTimer)
            setCreatePending(false)
        }
    }

    const joinRoom = () => {
        if (!canJoinRoom) return
        setJoinModalOpen(false)
        setRoomNotFoundModalOpen(false)
        autoRouteHandledRef.current = null
        setHashPath(`/attach/callee/${encodeURIComponent(normalizedJoinRoomId)}`)
    }

    const sendFast = async () => {
        const text = messageText.trim()
        if (!text) return
        await rtc.sendFast(text)
        setMessageText('')
    }

    const sendReliable = async () => {
        const text = messageText.trim()
        if (!text) return
        await rtc.sendReliable(text)
        setMessageText('')
    }

    const closeSessionAndReturnInitial = async () => {
        if (leavePending) return
        setLeavePending(true)
        try {
            if (mode === 'caller' && removeRoomOnLeave) await rtc.endRoom()
            else await rtc.disconnect()
        } catch {}
        autoRouteHandledRef.current = null
        setLeaveConfirmOpen(false)
        setHashPath('/')
        setLeavePending(false)
    }

    const backToMain = () => {
        setRoomNotFoundModalOpen(false)
        setJoinModalOpen(false)
        setJoinRoomIdInput('')
        autoRouteHandledRef.current = null
        void rtc.disconnect().catch(() => {})
        setHashPath('/')
    }

    const roomNotFoundModal =
        roomNotFoundModalOpen && isRoomNotFoundError ? (
            <div className="qrModalBackdrop" role="dialog" aria-modal="true">
                <section className="appModal appModalError leaveModal">
                    <div className="qrModalHeader">
                        <h2 className="qrModalTitle">Room not found</h2>
                        <button
                            type="button"
                            className="cs-btn close"
                            aria-label="Close dialog"
                            onClick={() => setRoomNotFoundModalOpen(false)}
                        />
                    </div>
                    <p className="appModalMessage">
                        The requested room does not exist or is already closed.
                    </p>
                    <menu className="leaveModalActions">
                        <button type="button" className="cs-btn" onClick={backToMain}>
                            Back to main
                        </button>
                        <button
                            type="button"
                            className="cs-btn"
                            onClick={() => setRoomNotFoundModalOpen(false)}
                        >
                            Close
                        </button>
                    </menu>
                </section>
            </div>
        ) : null

    if (mode === 'initial') {
        const modalStatusText =
            typeof rtc.overallStatusText === 'string' && rtc.overallStatusText.trim().length > 0
                ? rtc.overallStatusText
                : 'Preparing room...'

        return (
            <main className="demoShell demoShellInitial">
                {roomNotFoundModal}
                {joinModalOpen && (
                    <div className="qrModalBackdrop" role="dialog" aria-modal="true">
                        <section className="appModal leaveModal">
                            <div className="qrModalHeader">
                                <h2 className="qrModalTitle">Join Room</h2>
                                <button
                                    type="button"
                                    className="cs-btn close"
                                    aria-label="Close dialog"
                                    onClick={() => setJoinModalOpen(false)}
                                />
                            </div>
                            <p className="appModalMessage">Enter Room ID to attach as CALLEE.</p>
                            <input
                                id="join-room-id"
                                className="roomInput cs-input"
                                value={joinRoomIdInput}
                                onChange={(e) => setJoinRoomIdInput(e.target.value)}
                                placeholder="Room ID"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault()
                                        joinRoom()
                                    }
                                }}
                            />
                            <menu className="leaveModalActions">
                                <button
                                    type="button"
                                    className="cs-btn"
                                    onClick={() => setJoinModalOpen(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="cs-btn"
                                    onClick={joinRoom}
                                    disabled={!canJoinRoom}
                                >
                                    Join
                                </button>
                            </menu>
                        </section>
                    </div>
                )}
                {createPending && !rtc.booting && (
                    <div className="appModalBackdrop" aria-live="polite">
                        <section className="appModal">
                            <h2 className="appModalTitle">Creating room...</h2>
                            <p className="appModalMessage">{modalStatusText}</p>
                            <div className="appProgressMeta">{createProgressPercentSafe}%</div>
                            <div
                                ref={createProgressTrackRef}
                                className="cs-progress-bar appProgress"
                            >
                                <div
                                    style={{ width: `${createProgressWidthPercentSafe}%` }}
                                    className="bars"
                                />
                            </div>
                        </section>
                    </div>
                )}
                <section className="card initialCard">
                    <h1>VIBE-RTC DEMO</h1>
                    <section className="initialInfo">
                        <p className="initialInfoText">
                            This page demonstrates LAN-first WebRTC connection setup, with automatic
                            STUN fallback when direct local candidates do not connect fast enough.
                        </p>
                        <p className="initialInfoText">
                            The demo is tuned to be resilient to caller/callee page reload races:
                            after refreshes it re-attaches, re-negotiates, and restores channels.
                        </p>
                        <p className="initialInfoText">
                            How to use:
                            <br />
                            1. Press <b>Create Room</b>.
                            <br />
                            2. Open the callee link/QR on a second device.
                            <br />
                            3. Wait until channels are ready, then send test messages with{' '}
                            <b>Fast</b> and <b>Reliable</b>.
                            <br />
                            4. Watch status, progress bars, and operation log to inspect signaling
                            and WebRTC state transitions.
                        </p>
                    </section>
                    <button
                        type="button"
                        className="cs-btn"
                        onClick={() => void createRoom()}
                        disabled={createPending}
                    >
                        {createPending ? 'Creating...' : 'Create Room'}
                    </button>
                    <button
                        type="button"
                        className="cs-btn"
                        onClick={() => setJoinModalOpen(true)}
                        disabled={createPending}
                    >
                        Join Room
                    </button>
                    <p className="credits">
                        UI skin powered by{' '}
                        <a
                            href="https://github.com/ekmas/cs16.css"
                            target="_blank"
                            rel="noreferrer"
                        >
                            cs16.css
                        </a>{' '}
                        by ekmas. Thanks for the awesome project.
                    </p>
                </section>
            </main>
        )
    }

    return (
        <main className="demoShell demoShellChat">
            {roomNotFoundModal}
            {leaveConfirmOpen && (
                <div className="qrModalBackdrop" role="dialog" aria-modal="true">
                    <section className="appModal leaveModal">
                        <div className="qrModalHeader">
                            <h2 className="qrModalTitle">Leave session</h2>
                            <button
                                type="button"
                                className="cs-btn close"
                                aria-label="Close dialog"
                                onClick={() => setLeaveConfirmOpen(false)}
                                disabled={leavePending}
                            />
                        </div>
                        <p className="appModalMessage">
                            Session will be interrupted. Current channel will be closed.
                            {mode === 'caller' && removeRoomOnLeave ? ' Room will be removed.' : ''}
                        </p>
                        {mode === 'caller' && (
                            <label className="cs-checkbox leaveRoomCheckbox" htmlFor="remove-room">
                                <input
                                    id="remove-room"
                                    type="checkbox"
                                    checked={removeRoomOnLeave}
                                    onChange={(e) => setRemoveRoomOnLeave(e.target.checked)}
                                    disabled={leavePending}
                                />
                                <span className="cs-checkbox__label">Remove room</span>
                            </label>
                        )}
                        <menu className="leaveModalActions">
                            <button
                                type="button"
                                className="cs-btn"
                                onClick={() => setLeaveConfirmOpen(false)}
                                disabled={leavePending}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="cs-btn"
                                onClick={() => void closeSessionAndReturnInitial()}
                                disabled={leavePending}
                            >
                                {leavePending ? 'Closing...' : 'End Session'}
                            </button>
                        </menu>
                    </section>
                </div>
            )}
            {mode === 'caller' && !channelReadyForMessages && qrModalOpen && calleeUrl && (
                <div className="qrModalBackdrop" role="dialog" aria-modal="true">
                    <section className="qrModal">
                        <div className="qrModalHeader">
                            <h2 className="qrModalTitle">Scan this QR code on callee device:</h2>
                            <button
                                type="button"
                                className="cs-btn close"
                                aria-label="Hide QR dialog"
                                onClick={() => setQrModalOpen(false)}
                            />
                        </div>
                        <div className="roomRow qrRoomRow">
                            <label htmlFor="qr-room-id" className="roomLabel">
                                Room ID
                            </label>
                            <div className="roomRowMain">
                                <input
                                    id="qr-room-id"
                                    className="roomInput cs-input"
                                    readOnly
                                    value={routeRoomId}
                                />
                            </div>
                        </div>
                        <section className="qrContent">
                            {calleeQrDataUrl ? (
                                <a
                                    href={calleeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="qrLink"
                                >
                                    <img
                                        className="qrImage"
                                        src={calleeQrDataUrl}
                                        alt="Callee link QR code"
                                    />
                                </a>
                            ) : (
                                <div className="qrLoading">Generating QR...</div>
                            )}
                        </section>
                    </section>
                </div>
            )}
            <section className="card chatPageCard">
                <header className="screenHeader">
                    <div className="screenHeaderTop">
                        <h1>{mode.toUpperCase()}</h1>
                        <div className="screenHeaderActions">
                            <div className={`latencyHud net-${netLatencyTone}`}>
                                <div className="latencyNetLine">
                                    NET: {netRttMs == null ? '--' : `${netRttMs} ms`}
                                </div>
                                <div className="latencyAppLine">
                                    APP: {appPingMs == null ? '--' : `${appPingMs} ms`}
                                </div>
                                <div className="latencyAppLine">
                                    ROUTE: {routeLabel}
                                    {isRelayRoute && (
                                        <span className="latencyRelayTag">(TURN)</span>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="cs-btn close screenCloseBtn"
                                aria-label="Close session"
                                onClick={() => {
                                    setRemoveRoomOnLeave(mode === 'caller')
                                    setLeaveConfirmOpen(true)
                                }}
                            />
                        </div>
                    </div>
                    <div className="roomRow">
                        <label htmlFor="room-id" className="roomLabel">
                            Room ID
                        </label>
                        <div className="roomRowMain">
                            <input
                                id="room-id"
                                className="roomInput cs-input"
                                readOnly
                                value={routeRoomId}
                            />
                            {mode === 'caller' && !channelReadyForMessages && calleeUrl && (
                                <button
                                    type="button"
                                    className="cs-btn roomQrBtn"
                                    onClick={() => setQrModalOpen(true)}
                                    disabled={qrModalOpen}
                                >
                                    Show QR
                                </button>
                            )}
                        </div>
                    </div>
                    <p className={`statusLine status-${rtc.overallStatus}`}>
                        {rtc.overallStatusText}
                    </p>
                    {netWarning && <p className="statusWarning">{netWarning.message}</p>}
                    <div ref={connectProgressTrackRef} className="cs-progress-bar statusProgress">
                        <div
                            style={{ width: `${connectProgressWidthPercentSafe}%` }}
                            className="bars"
                        />
                    </div>
                </header>

                <section className="chatCard">
                    <div className="chatHeader">
                        <div className="chatTitle">Operation Log</div>
                        <label className="logFilter cs-checkbox" htmlFor="hide-connection-messages">
                            <input
                                id="hide-connection-messages"
                                type="checkbox"
                                checked={hideConnectionMessages}
                                onChange={(e) => setHideConnectionMessages(e.target.checked)}
                            />
                            <span className="cs-checkbox__label">Hide connection messages</span>
                        </label>
                    </div>
                    <ul className="logList">
                        {visibleLog.length === 0 && (
                            <li className="logEmpty">No visible activity yet.</li>
                        )}
                        {visibleLog.map((entry, index) => (
                            <li
                                key={`${entry.at}-${entry.scope}-${entry.event ?? 'evt'}-${index}`}
                                className={`logItem scope-${entry.scope} ${isChannelMessage(entry) ? 'isMessage' : ''}`}
                            >
                                <span className="logMeta">
                                    {new Date(entry.at).toLocaleTimeString()} | {entry.scope}
                                </span>
                                <span className="logText">{entry.message}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="composer">
                        <input
                            className="composerInput cs-input"
                            value={messageText}
                            onChange={(e) => setMessageText(e.target.value)}
                            placeholder="Type a message..."
                            disabled={!channelReadyForMessages}
                        />
                        <button
                            type="button"
                            className="cs-btn"
                            onClick={() => void sendFast()}
                            disabled={!fastReady || !hasMessage}
                        >
                            Fast
                        </button>
                        <button
                            type="button"
                            className="cs-btn"
                            onClick={() => void sendReliable()}
                            disabled={!reliableReady || !hasMessage}
                        >
                            Reliable
                        </button>
                    </div>
                </section>

                <p className="credits">
                    UI skin powered by{' '}
                    <a href="https://github.com/ekmas/cs16.css" target="_blank" rel="noreferrer">
                        cs16.css
                    </a>{' '}
                    by ekmas. Thanks for the awesome project.
                </p>
            </section>
        </main>
    )
}
