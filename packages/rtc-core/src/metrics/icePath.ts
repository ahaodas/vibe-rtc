export type IcePathSelectionMethod = 'transport' | 'nominated' | 'selected' | 'succeeded'

export type IceRoute = {
    pairId: string
    nominated: boolean
    localType?: 'host' | 'srflx' | 'prflx' | 'relay' | string
    remoteType?: 'host' | 'srflx' | 'prflx' | 'relay' | string
    isTurn: boolean
}

export type IcePathDiagnostics = {
    reason: string
}

export type IceCandidatePairStats = RTCStats & {
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

type IceTransportStats = RTCStats & {
    id: string
    type: 'transport'
    selectedCandidatePairId?: string
}

type IceCandidateStats = RTCStats & {
    id: string
    type: 'local-candidate' | 'remote-candidate'
    candidateType?: string
}

export type IcePathSelection = {
    pair?: IceCandidatePairStats
    route?: IceRoute
    selectionMethod?: IcePathSelectionMethod
    diagnostics?: IcePathDiagnostics
}

const isCandidatePair = (report: RTCStats): report is IceCandidatePairStats =>
    report.type === 'candidate-pair'

const isTransport = (report: RTCStats): report is IceTransportStats => report.type === 'transport'

const isCandidate = (report: RTCStats): report is IceCandidateStats =>
    report.type === 'local-candidate' || report.type === 'remote-candidate'

const readStatsList = (stats: RTCStatsReport): RTCStats[] => {
    const list: RTCStats[] = []
    stats.forEach((entry) => {
        list.push(entry)
    })
    return list
}

const getCandidateType = (candidate: IceCandidateStats | undefined): string | undefined => {
    if (!candidate) return undefined
    if (typeof candidate.candidateType !== 'string') return undefined
    const value = candidate.candidateType.trim()
    return value.length > 0 ? value : undefined
}

const selectPair = (
    pairs: IceCandidatePairStats[],
    transports: IceTransportStats[],
): {
    pair?: IceCandidatePairStats
    selectionMethod?: IcePathSelectionMethod
    diagnostics?: IcePathDiagnostics
} => {
    const pairById = new Map<string, IceCandidatePairStats>()
    for (const pair of pairs) pairById.set(pair.id, pair)

    for (const transport of transports) {
        if (typeof transport.selectedCandidatePairId !== 'string') continue
        const selectedPairId = transport.selectedCandidatePairId.trim()
        if (!selectedPairId) continue
        const selectedPair = pairById.get(selectedPairId)
        if (selectedPair) {
            return { pair: selectedPair, selectionMethod: 'transport' }
        }
        return {
            diagnostics: {
                reason: `transport.selectedCandidatePairId points to missing candidate pair: ${selectedPairId}`,
            },
        }
    }

    if (pairs.length === 0) {
        return { diagnostics: { reason: 'no-candidate-pairs' } }
    }

    const nominatedSucceeded = pairs.find(
        (pair) => pair.nominated === true && pair.state === 'succeeded',
    )
    if (nominatedSucceeded) return { pair: nominatedSucceeded, selectionMethod: 'nominated' }

    const selectedSucceeded = pairs.find(
        (pair) => pair.selected === true && pair.state === 'succeeded',
    )
    if (selectedSucceeded) return { pair: selectedSucceeded, selectionMethod: 'selected' }

    const succeeded = pairs.find((pair) => pair.state === 'succeeded')
    if (succeeded) return { pair: succeeded, selectionMethod: 'succeeded' }

    return { diagnostics: { reason: 'no-succeeded-candidate-pair' } }
}

export const extractSelectedIcePath = (stats: RTCStatsReport): IcePathSelection => {
    const reports = readStatsList(stats)
    const pairs = reports.filter(isCandidatePair)
    const transports = reports.filter(isTransport)
    const candidates = reports.filter(isCandidate)

    const selection = selectPair(pairs, transports)
    const pair = selection.pair
    if (!pair) return selection

    const diagnostics: string[] = []
    if (!pair.localCandidateId || !pair.remoteCandidateId) {
        diagnostics.push('selected pair has no candidate ids')
    }

    const localCandidate = candidates.find((candidate) => candidate.id === pair.localCandidateId)
    const remoteCandidate = candidates.find((candidate) => candidate.id === pair.remoteCandidateId)
    if (pair.localCandidateId && !localCandidate) {
        diagnostics.push(`local candidate not found: ${pair.localCandidateId}`)
    }
    if (pair.remoteCandidateId && !remoteCandidate) {
        diagnostics.push(`remote candidate not found: ${pair.remoteCandidateId}`)
    }

    const localType = getCandidateType(localCandidate)
    const remoteType = getCandidateType(remoteCandidate)
    const isTurn = localType === 'relay' || remoteType === 'relay'

    return {
        pair,
        route: {
            pairId: pair.id,
            nominated: pair.nominated === true,
            localType,
            remoteType,
            isTurn,
        },
        selectionMethod: selection.selectionMethod,
        diagnostics:
            diagnostics.length > 0 ? { reason: diagnostics.join('; ') } : selection.diagnostics,
    }
}
