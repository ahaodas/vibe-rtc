import type { CandidateType } from '../../../connection-strategy'
import type { NetRttSnapshot } from '../../../metrics/netRtt'

export interface CandidateStatsSnapshot {
    localSeen: Record<CandidateType, number>
    localSent: Record<CandidateType, number>
    localDropped: Record<CandidateType, number>
    remoteSeen: Record<CandidateType, number>
    remoteAccepted: Record<CandidateType, number>
    remoteDropped: Record<CandidateType, number>
}

export const makeCandidateCountMap = (): Record<CandidateType, number> => ({
    host: 0,
    srflx: 0,
    relay: 0,
    unknown: 0,
})

export const createCandidateStatsSnapshot = (): CandidateStatsSnapshot => ({
    localSeen: makeCandidateCountMap(),
    localSent: makeCandidateCountMap(),
    localDropped: makeCandidateCountMap(),
    remoteSeen: makeCandidateCountMap(),
    remoteAccepted: makeCandidateCountMap(),
    remoteDropped: makeCandidateCountMap(),
})

export const bumpCandidateCounter = (
    counter: Record<CandidateType, number>,
    type: CandidateType,
) => {
    counter[type] = (counter[type] ?? 0) + 1
}

export const mapSelectedPathFromRoute = (
    route: NetRttSnapshot['route'],
): CandidateType | undefined => {
    if (!route) return undefined
    const localType = route.localCandidateType?.toLowerCase()
    const remoteType = route.remoteCandidateType?.toLowerCase()

    if (route.isRelay === true || localType === 'relay' || remoteType === 'relay') return 'relay'

    if (
        localType === 'srflx' ||
        remoteType === 'srflx' ||
        localType === 'prflx' ||
        remoteType === 'prflx'
    ) {
        return 'srflx'
    }

    if (localType === 'host' || remoteType === 'host') return 'host'
    return 'unknown'
}
