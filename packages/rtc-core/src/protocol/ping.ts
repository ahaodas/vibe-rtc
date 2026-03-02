export const PING_PROTOCOL_PREFIX = '__vibe_rtc_ping__:'
const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_WINDOW_SIZE = 5
const MAX_INFLIGHT_MULTIPLIER = 4

export type PingStatus = 'idle' | 'running' | 'paused'

export type PingSnapshot = {
    lastRttMs: number | null
    smoothedRttMs: number | null
    jitterMs: number | null
    lastUpdatedAt: number | null
    status: PingStatus
    lastSeq: number | null
    intervalMs: number
    windowSize: number
}

type PingMessage = {
    type: 'ping' | 'pong'
    sentAt: number
    seq: number
}

export type PingServiceOptions = {
    send: (message: string) => void
    isOpen: () => boolean
    intervalMs?: number
    windowSize?: number
    now?: () => number
    nowEpoch?: () => number
    onUpdate?: (snapshot: PingSnapshot) => void
}

export type PingService = {
    start: () => void
    stop: () => void
    pause: () => void
    reset: () => void
    getSnapshot: () => PingSnapshot
    handleIncoming: (message: string) => boolean
}

const perfNow = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()

const clampInt = (value: number | undefined, fallback: number, min: number): number => {
    if (!Number.isFinite(value)) return fallback
    const next = Math.floor(value as number)
    if (next < min) return fallback
    return next
}

const isPingMessage = (value: unknown): value is PingMessage => {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Partial<PingMessage>
    if (candidate.type !== 'ping' && candidate.type !== 'pong') return false
    if (typeof candidate.sentAt !== 'number' || !Number.isFinite(candidate.sentAt)) return false
    if (
        typeof candidate.seq !== 'number' ||
        !Number.isFinite(candidate.seq) ||
        !Number.isInteger(candidate.seq)
    ) {
        return false
    }
    return candidate.seq >= 0
}

const encodeMessage = (message: PingMessage): string =>
    `${PING_PROTOCOL_PREFIX}${JSON.stringify(message)}`

const decodeMessage = (raw: string): PingMessage | null => {
    if (typeof raw !== 'string' || !raw.startsWith(PING_PROTOCOL_PREFIX)) return null
    const body = raw.slice(PING_PROTOCOL_PREFIX.length)
    if (!body) return null
    try {
        const parsed = JSON.parse(body)
        return isPingMessage(parsed) ? parsed : null
    } catch {
        return null
    }
}

const cloneSnapshot = (snapshot: PingSnapshot): PingSnapshot => ({ ...snapshot })

export const createPingService = (options: PingServiceOptions): PingService => {
    const intervalMs = clampInt(options.intervalMs, DEFAULT_INTERVAL_MS, 1)
    const windowSize = clampInt(options.windowSize, DEFAULT_WINDOW_SIZE, 1)
    const now = options.now ?? perfNow
    const nowEpoch = options.nowEpoch ?? (() => Date.now())

    let intervalId: ReturnType<typeof setInterval> | undefined
    let seq = 0
    let prevRtt: number | null = null
    const pending = new Map<number, number>()
    const window: number[] = []

    let snapshot: PingSnapshot = {
        lastRttMs: null,
        smoothedRttMs: null,
        jitterMs: null,
        lastUpdatedAt: null,
        status: 'idle',
        lastSeq: null,
        intervalMs,
        windowSize,
    }

    const emit = () => {
        options.onUpdate?.(cloneSnapshot(snapshot))
    }

    const setStatus = (status: PingStatus) => {
        if (snapshot.status === status) return
        snapshot = { ...snapshot, status }
        emit()
    }

    const dispatch = (message: PingMessage) => {
        try {
            options.send(encodeMessage(message))
        } catch {
            // Ignore transport exceptions; connection lifecycle will pause/restart later.
        }
    }

    const sendPing = () => {
        if (!options.isOpen()) {
            setStatus('paused')
            return
        }

        seq += 1
        const sentAt = now()
        pending.set(seq, sentAt)
        if (pending.size > windowSize * MAX_INFLIGHT_MULTIPLIER) {
            const oldest = pending.keys().next().value
            if (typeof oldest === 'number') pending.delete(oldest)
        }
        snapshot = {
            ...snapshot,
            lastSeq: seq,
            lastUpdatedAt: nowEpoch(),
        }
        setStatus('running')
        dispatch({ type: 'ping', sentAt, seq })
    }

    const updateRtt = (rttMs: number, incomingSeq: number) => {
        window.push(rttMs)
        if (window.length > windowSize) window.shift()
        const sum = window.reduce((acc, value) => acc + value, 0)
        const smoothedRttMs = window.length > 0 ? sum / window.length : null
        const jitterMs = prevRtt == null ? null : Math.abs(rttMs - prevRtt)
        prevRtt = rttMs
        snapshot = {
            ...snapshot,
            lastRttMs: rttMs,
            smoothedRttMs,
            jitterMs,
            lastUpdatedAt: nowEpoch(),
            lastSeq: incomingSeq,
        }
        emit()
    }

    const tick = () => {
        sendPing()
    }

    const clearTimer = () => {
        if (!intervalId) return
        clearInterval(intervalId)
        intervalId = undefined
    }

    const start = () => {
        if (intervalId) return
        tick()
        intervalId = setInterval(() => tick(), intervalMs)
    }

    const pause = () => {
        clearTimer()
        setStatus('paused')
    }

    const stop = () => {
        clearTimer()
        pending.clear()
        setStatus('idle')
    }

    const reset = () => {
        pending.clear()
        window.length = 0
        prevRtt = null
        snapshot = {
            ...snapshot,
            lastRttMs: null,
            smoothedRttMs: null,
            jitterMs: null,
            lastUpdatedAt: null,
            lastSeq: null,
        }
        emit()
    }

    const handleIncoming = (message: string): boolean => {
        const parsed = decodeMessage(message)
        if (!parsed) return false

        if (parsed.type === 'ping') {
            if (options.isOpen()) {
                dispatch({ type: 'pong', sentAt: parsed.sentAt, seq: parsed.seq })
            } else {
                setStatus('paused')
            }
            return true
        }

        const trackedSentAt = pending.get(parsed.seq)
        if (trackedSentAt == null) return true
        pending.delete(parsed.seq)

        const rttMs = now() - parsed.sentAt
        if (!Number.isFinite(rttMs) || rttMs < 0) return true

        const normalizedRtt = Math.round(rttMs * 100) / 100
        updateRtt(normalizedRtt, parsed.seq)
        return true
    }

    const getSnapshot = () => cloneSnapshot(snapshot)

    return {
        start,
        stop,
        pause,
        reset,
        getSnapshot,
        handleIncoming,
    }
}
