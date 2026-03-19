import { describe, expect, it } from 'vitest'
import {
    bumpCandidateCounter,
    createCandidateStatsSnapshot,
    makeCandidateCountMap,
    mapSelectedPathFromRoute,
} from '../src/internal/rtc-signaler/metrics/candidate-stats'

describe('rtc-signaler candidate stats helpers', () => {
    it('creates and mutates candidate counters', () => {
        const counters = makeCandidateCountMap()
        expect(counters).toEqual({ host: 0, srflx: 0, relay: 0, unknown: 0 })

        bumpCandidateCounter(counters, 'host')
        bumpCandidateCounter(counters, 'host')
        bumpCandidateCounter(counters, 'relay')

        expect(counters.host).toBe(2)
        expect(counters.relay).toBe(1)
    })

    it('creates full candidate stats snapshot', () => {
        const snapshot = createCandidateStatsSnapshot()
        expect(snapshot.localSeen.host).toBe(0)
        expect(snapshot.remoteAccepted.srflx).toBe(0)
        expect(snapshot.remoteDropped.relay).toBe(0)
    })

    it('maps selected path from route diagnostics', () => {
        expect(
            mapSelectedPathFromRoute({
                localCandidateType: 'host',
                remoteCandidateType: 'host',
                isRelay: false,
            }),
        ).toBe('host')

        expect(
            mapSelectedPathFromRoute({
                localCandidateType: 'prflx',
                remoteCandidateType: 'host',
                isRelay: false,
            }),
        ).toBe('srflx')

        expect(
            mapSelectedPathFromRoute({
                localCandidateType: 'relay',
                remoteCandidateType: 'host',
                isRelay: true,
            }),
        ).toBe('relay')

        expect(mapSelectedPathFromRoute(undefined)).toBeUndefined()
    })
})
