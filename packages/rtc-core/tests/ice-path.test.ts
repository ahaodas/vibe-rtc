import { describe, expect, it } from 'vitest'
import { extractSelectedIcePath } from '../src/metrics/icePath'

type StatsInput = Array<Record<string, unknown>>

const toStatsReport = (input: StatsInput): RTCStatsReport => {
    const map = new Map<string, RTCStats>()
    for (let index = 0; index < input.length; index += 1) {
        const report = input[index]
        const id = typeof report.id === 'string' ? report.id : `report-${index}`
        map.set(id, report as RTCStats)
    }
    return map as unknown as RTCStatsReport
}

describe('extractSelectedIcePath', () => {
    it('prefers transport.selectedCandidatePairId when available', () => {
        const result = extractSelectedIcePath(
            toStatsReport([
                {
                    id: 'transport-1',
                    type: 'transport',
                    selectedCandidatePairId: 'pair-relay',
                },
                {
                    id: 'pair-direct',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    localCandidateId: 'local-direct',
                    remoteCandidateId: 'remote-direct',
                },
                {
                    id: 'pair-relay',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    localCandidateId: 'local-relay',
                    remoteCandidateId: 'remote-srflx',
                },
                { id: 'local-direct', type: 'local-candidate', candidateType: 'host' },
                { id: 'remote-direct', type: 'remote-candidate', candidateType: 'host' },
                { id: 'local-relay', type: 'local-candidate', candidateType: 'relay' },
                { id: 'remote-srflx', type: 'remote-candidate', candidateType: 'srflx' },
            ]),
        )

        expect(result.selectionMethod).toBe('transport')
        expect(result.route?.pairId).toBe('pair-relay')
        expect(result.route?.isTurn).toBe(true)
        expect(result.route?.localType).toBe('relay')
        expect(result.route?.remoteType).toBe('srflx')
    })

    it('falls back to nominated succeeded pair when transport stat is absent', () => {
        const result = extractSelectedIcePath(
            toStatsReport([
                {
                    id: 'pair-a',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    localCandidateId: 'local-a',
                    remoteCandidateId: 'remote-a',
                },
                { id: 'local-a', type: 'local-candidate', candidateType: 'host' },
                { id: 'remote-a', type: 'remote-candidate', candidateType: 'srflx' },
            ]),
        )

        expect(result.selectionMethod).toBe('nominated')
        expect(result.route?.isTurn).toBe(false)
        expect(result.route?.localType).toBe('host')
        expect(result.route?.remoteType).toBe('srflx')
    })

    it('returns diagnostics when selected candidate pair is missing', () => {
        const result = extractSelectedIcePath(
            toStatsReport([
                {
                    id: 'transport-1',
                    type: 'transport',
                    selectedCandidatePairId: 'missing-pair',
                },
            ]),
        )

        expect(result.route).toBeUndefined()
        expect(result.pair).toBeUndefined()
        expect(result.diagnostics?.reason).toContain('missing candidate pair')
    })

    it('treats relay on either side as TURN route', () => {
        const relayLocal = extractSelectedIcePath(
            toStatsReport([
                {
                    id: 'pair-local-relay',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    localCandidateId: 'local-relay',
                    remoteCandidateId: 'remote-host',
                },
                { id: 'local-relay', type: 'local-candidate', candidateType: 'relay' },
                { id: 'remote-host', type: 'remote-candidate', candidateType: 'host' },
            ]),
        )
        const relayRemote = extractSelectedIcePath(
            toStatsReport([
                {
                    id: 'pair-remote-relay',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    localCandidateId: 'local-host',
                    remoteCandidateId: 'remote-relay',
                },
                { id: 'local-host', type: 'local-candidate', candidateType: 'host' },
                { id: 'remote-relay', type: 'remote-candidate', candidateType: 'relay' },
            ]),
        )

        expect(relayLocal.route?.isTurn).toBe(true)
        expect(relayRemote.route?.isTurn).toBe(true)
    })
})
