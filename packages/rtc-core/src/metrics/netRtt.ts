import {
    extractSelectedIcePath,
    type IcePathSelectionMethod,
} from './icePath'

const DEFAULT_INTERVAL_MS = 1000

export type NetRttSnapshot = {
    rttMs: number | null
    jitterMs: number | null
    lastUpdatedAt: number
    status: 'idle' | 'running' | 'paused'
    selectedPair?: {
        id: string
        state?: string
        nominated?: boolean
        currentRoundTripTimeSec?: number | null
        availableOutgoingBitrate?: number | null
        bytesSent?: number | null
        bytesReceived?: number | null
    }
    route?: {
        localCandidateType?: 'host' | 'srflx' | 'relay' | string
        remoteCandidateType?: 'host' | 'srflx' | 'relay' | string
        isRelay?: boolean
        pairId?: string
        nominated?: boolean
        selectionMethod?: IcePathSelectionMethod
    }
    pathSelectionMethod?: IcePathSelectionMethod
    pathReason?: string
}

type NetRttServiceOptions = {
    peerConnection: RTCPeerConnection
    intervalMs?: number
    now?: () => number
    onUpdate?: (snapshot: NetRttSnapshot) => void
}

export type NetRttService = {
    start: () => void
    stop: () => void
    reset: () => void
    pause: () => void
    refresh: () => Promise<void>
    getSnapshot: () => NetRttSnapshot
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value)

const toNullableNumber = (value: unknown): number | null => (isFiniteNumber(value) ? value : null)

const normalizeInterval = (value: number | undefined): number => {
    if (!isFiniteNumber(value)) return DEFAULT_INTERVAL_MS
    const rounded = Math.floor(value)
    return rounded > 0 ? rounded : DEFAULT_INTERVAL_MS
}

export const createInitialNetRttSnapshot = (): NetRttSnapshot => ({
    rttMs: null,
    jitterMs: null,
    lastUpdatedAt: Date.now(),
    status: 'idle',
})

export const secondsToMs = (seconds: number | null | undefined): number | null => {
    if (!isFiniteNumber(seconds)) return null
    return Math.round(seconds * 1000)
}

const isClosedPc = (pc: RTCPeerConnection): boolean =>
    pc.signalingState === 'closed' || pc.connectionState === 'closed'

const cloneSnapshot = (snapshot: NetRttSnapshot): NetRttSnapshot => ({
    ...snapshot,
    selectedPair: snapshot.selectedPair ? { ...snapshot.selectedPair } : undefined,
    route: snapshot.route ? { ...snapshot.route } : undefined,
})

const buildSnapshotFromStats = (
    stats: RTCStatsReport,
    prevRttMs: number | null,
    now: () => number,
): NetRttSnapshot => {
    const selectedPath = extractSelectedIcePath(stats)
    const selectedPair = selectedPath.pair
    const rttMs = selectedPair ? secondsToMs(selectedPair.currentRoundTripTime) : null
    const jitterMs =
        rttMs != null && prevRttMs != null
            ? Math.abs(Math.round((rttMs - prevRttMs) * 100) / 100)
            : null

    if (!selectedPair) {
        return {
            rttMs: null,
            jitterMs: null,
            lastUpdatedAt: now(),
            status: 'running',
            pathSelectionMethod: selectedPath.selectionMethod,
            pathReason: selectedPath.diagnostics?.reason,
        }
    }

    const route = selectedPath.route

    return {
        rttMs,
        jitterMs,
        lastUpdatedAt: now(),
        status: 'running',
        pathSelectionMethod: selectedPath.selectionMethod,
        pathReason: selectedPath.diagnostics?.reason,
        selectedPair: {
            id: selectedPair.id,
            state: selectedPair.state,
            nominated: selectedPair.nominated === true,
            currentRoundTripTimeSec: toNullableNumber(selectedPair.currentRoundTripTime),
            availableOutgoingBitrate: toNullableNumber(selectedPair.availableOutgoingBitrate),
            bytesSent: toNullableNumber(selectedPair.bytesSent),
            bytesReceived: toNullableNumber(selectedPair.bytesReceived),
        },
        route: route
            ? {
                  localCandidateType: route.localType,
                  remoteCandidateType: route.remoteType,
                  isRelay: route.isTurn,
                  pairId: route.pairId,
                  nominated: route.nominated,
                  selectionMethod: selectedPath.selectionMethod,
              }
            : undefined,
    }
}

export const createNetRttService = (options: NetRttServiceOptions): NetRttService => {
    const intervalMs = normalizeInterval(options.intervalMs)
    const now = options.now ?? (() => Date.now())
    const emit = (snapshot: NetRttSnapshot) => options.onUpdate?.(cloneSnapshot(snapshot))

    let intervalId: ReturnType<typeof setInterval> | undefined
    let prevRttMs: number | null = null
    let snapshot: NetRttSnapshot = createInitialNetRttSnapshot()

    const setSnapshot = (next: NetRttSnapshot) => {
        snapshot = next
        emit(snapshot)
    }

    const clearIntervalIfNeeded = () => {
        if (!intervalId) return
        clearInterval(intervalId)
        intervalId = undefined
    }

    const pause = () => {
        clearIntervalIfNeeded()
        if (snapshot.status === 'paused') return
        setSnapshot({
            ...snapshot,
            status: 'paused',
            lastUpdatedAt: now(),
        })
    }

    const stop = () => {
        clearIntervalIfNeeded()
        setSnapshot({
            ...snapshot,
            status: 'paused',
            lastUpdatedAt: now(),
        })
    }

    const reset = () => {
        prevRttMs = null
        setSnapshot({
            ...snapshot,
            rttMs: null,
            jitterMs: null,
            selectedPair: undefined,
            route: undefined,
            lastUpdatedAt: now(),
        })
    }

    const poll = async () => {
        const pc = options.peerConnection
        if (isClosedPc(pc)) {
            stop()
            return
        }

        try {
            const stats = await pc.getStats()
            const next = buildSnapshotFromStats(stats, prevRttMs, now)
            prevRttMs = next.rttMs
            setSnapshot(next)
        } catch {
            setSnapshot({
                ...snapshot,
                status: 'running',
                lastUpdatedAt: now(),
            })
        }
    }

    const refresh = async () => {
        await poll()
    }

    const start = () => {
        if (intervalId) return
        if (isClosedPc(options.peerConnection)) {
            pause()
            return
        }
        setSnapshot({
            ...snapshot,
            status: 'running',
            lastUpdatedAt: now(),
        })
        void refresh()
        intervalId = setInterval(() => {
            void refresh()
        }, intervalMs)
    }

    return {
        start,
        stop,
        pause,
        reset,
        refresh,
        getSnapshot: () => cloneSnapshot(snapshot),
    }
}
