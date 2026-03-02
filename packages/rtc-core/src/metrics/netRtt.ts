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
    }
}

type CandidatePairStats = RTCStats & {
    id: string
    type: 'candidate-pair'
    state?: string
    selected?: boolean
    nominated?: boolean
    localCandidateId?: string
    remoteCandidateId?: string
    currentRoundTripTime?: number
    availableOutgoingBitrate?: number
    bytesSent?: number
    bytesReceived?: number
}

type CandidateStats = RTCStats & {
    id: string
    type: 'local-candidate' | 'remote-candidate'
    candidateType?: string
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

const isCandidatePair = (report: RTCStats): report is CandidatePairStats =>
    report.type === 'candidate-pair'

const isCandidate = (report: RTCStats): report is CandidateStats =>
    report.type === 'local-candidate' || report.type === 'remote-candidate'

const preferSelectedPair = (pairs: CandidatePairStats[]): CandidatePairStats | undefined => {
    const nominatedSucceeded = pairs.find(
        (pair) => pair.nominated === true && pair.state === 'succeeded',
    )
    if (nominatedSucceeded) return nominatedSucceeded

    const selectedSucceeded = pairs.find(
        (pair) => pair.selected === true && pair.state === 'succeeded',
    )
    if (selectedSucceeded) return selectedSucceeded

    const selected = pairs.find((pair) => pair.selected === true)
    if (selected) return selected

    return pairs.find((pair) => pair.state === 'succeeded')
}

const extractCandidateType = (candidate: CandidateStats | undefined): string | undefined => {
    if (!candidate) return undefined
    return typeof candidate.candidateType === 'string' ? candidate.candidateType : undefined
}

const readStatsList = (report: RTCStatsReport): RTCStats[] => {
    const values: RTCStats[] = []
    report.forEach((entry) => {
        values.push(entry)
    })
    return values
}

const buildSnapshotFromStats = (
    stats: RTCStatsReport,
    prevRttMs: number | null,
    now: () => number,
): NetRttSnapshot => {
    const reports = readStatsList(stats)
    const candidatePairs = reports.filter(isCandidatePair)
    const selectedPair = preferSelectedPair(candidatePairs)
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
        }
    }

    const candidates = reports.filter(isCandidate)
    const localCandidate = candidates.find((report) => report.id === selectedPair.localCandidateId)
    const remoteCandidate = candidates.find(
        (report) => report.id === selectedPair.remoteCandidateId,
    )
    const localCandidateType = extractCandidateType(localCandidate)
    const remoteCandidateType = extractCandidateType(remoteCandidate)
    const isRelay = localCandidateType === 'relay' || remoteCandidateType === 'relay'

    return {
        rttMs,
        jitterMs,
        lastUpdatedAt: now(),
        status: 'running',
        selectedPair: {
            id: selectedPair.id,
            state: selectedPair.state,
            nominated: selectedPair.nominated === true,
            currentRoundTripTimeSec: toNullableNumber(selectedPair.currentRoundTripTime),
            availableOutgoingBitrate: toNullableNumber(selectedPair.availableOutgoingBitrate),
            bytesSent: toNullableNumber(selectedPair.bytesSent),
            bytesReceived: toNullableNumber(selectedPair.bytesReceived),
        },
        route: {
            localCandidateType,
            remoteCandidateType,
            isRelay,
        },
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
        void poll()
        intervalId = setInterval(() => {
            void poll()
        }, intervalMs)
    }

    return {
        start,
        stop,
        pause,
        reset,
        getSnapshot: () => cloneSnapshot(snapshot),
    }
}
