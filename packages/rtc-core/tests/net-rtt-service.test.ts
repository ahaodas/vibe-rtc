import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNetRttService, secondsToMs } from '../src/metrics/netRtt'

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

const createMockPc = (getStatsImpl: () => Promise<RTCStatsReport>) =>
    ({
        signalingState: 'stable' as RTCSignalingState,
        connectionState: 'connected' as RTCPeerConnectionState,
        getStats: vi.fn(getStatsImpl),
    }) as unknown as RTCPeerConnection

afterEach(() => {
    vi.useRealTimers()
})

describe('NetRttService', () => {
    it('converts seconds to milliseconds', () => {
        expect(secondsToMs(0.123)).toBe(123)
    })

    it('keeps snapshot RTT as null when selected candidate pair is missing', async () => {
        const pc = createMockPc(async () =>
            toStatsReport([
                {
                    id: 'pair-a',
                    type: 'candidate-pair',
                    state: 'in-progress',
                    nominated: false,
                    currentRoundTripTime: 0.05,
                },
            ]),
        )
        const service = createNetRttService({ peerConnection: pc })

        service.start()
        await Promise.resolve()
        await Promise.resolve()

        const snapshot = service.getSnapshot()
        expect(snapshot.status).toBe('running')
        expect(snapshot.rttMs).toBeNull()
        expect(snapshot.selectedPair).toBeUndefined()

        service.stop()
    })

    it('stop() clears polling interval', async () => {
        vi.useFakeTimers()
        const pc = createMockPc(async () =>
            toStatsReport([
                {
                    id: 'pair-b',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    currentRoundTripTime: 0.02,
                },
            ]),
        )
        const service = createNetRttService({
            peerConnection: pc,
            intervalMs: 1000,
        })

        service.start()
        await vi.advanceTimersByTimeAsync(2100)
        const callsBeforeStop = (pc.getStats as unknown as ReturnType<typeof vi.fn>).mock.calls
            .length
        expect(callsBeforeStop).toBeGreaterThanOrEqual(3)

        service.stop()
        await vi.advanceTimersByTimeAsync(3000)
        const callsAfterStop = (pc.getStats as unknown as ReturnType<typeof vi.fn>).mock.calls
            .length
        expect(callsAfterStop).toBe(callsBeforeStop)
        expect(service.getSnapshot().status).toBe('paused')
    })

    it('detects relay route by selected ICE candidate pair', async () => {
        const pc = createMockPc(async () =>
            toStatsReport([
                {
                    id: 'pair-c',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    currentRoundTripTime: 0.04,
                    localCandidateId: 'local-1',
                    remoteCandidateId: 'remote-1',
                },
                {
                    id: 'local-1',
                    type: 'local-candidate',
                    candidateType: 'host',
                },
                {
                    id: 'remote-1',
                    type: 'remote-candidate',
                    candidateType: 'relay',
                },
            ]),
        )

        const service = createNetRttService({ peerConnection: pc })
        service.start()
        await Promise.resolve()
        await Promise.resolve()

        const snapshot = service.getSnapshot()
        expect(snapshot.rttMs).toBe(40)
        expect(snapshot.route?.localCandidateType).toBe('host')
        expect(snapshot.route?.remoteCandidateType).toBe('relay')
        expect(snapshot.route?.isRelay).toBe(true)

        service.stop()
    })
})
