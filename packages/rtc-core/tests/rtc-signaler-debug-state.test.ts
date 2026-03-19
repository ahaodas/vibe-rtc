import { describe, expect, it } from 'vitest'
import {
    type BuildDebugStateInput,
    buildDebugStateSnapshot,
} from '../src/internal/rtc-signaler/debug/debug-state'

const baseInput = (): BuildDebugStateInput => ({
    ts: 1,
    roomId: 'room-1',
    role: 'caller',
    phase: 'connected',
    makingOffer: false,
    polite: false,
    pcState: 'connected',
    iceState: 'connected',
    signalingState: 'stable',
    pendingIce: 0,
    retries: { soft: 0, hard: 0 },
    timers: { softPending: false, hardPending: false },
    connectionStrategy: 'LAN_FIRST',
    icePhase: 'LAN',
    pcGeneration: 1,
    sessionId: 's1',
    participantId: 'p1',
    candidateStats: {
        localSeen: { host: 0, srflx: 0, relay: 0, unknown: 0 },
        localSent: { host: 0, srflx: 0, relay: 0, unknown: 0 },
        localDropped: { host: 0, srflx: 0, relay: 0, unknown: 0 },
        remoteSeen: { host: 0, srflx: 0, relay: 0, unknown: 0 },
        remoteAccepted: { host: 0, srflx: 0, relay: 0, unknown: 0 },
        remoteDropped: { host: 0, srflx: 0, relay: 0, unknown: 0 },
    },
    ping: {
        lastRttMs: null,
        smoothedRttMs: null,
        jitterMs: null,
        lastUpdatedAt: null,
        status: 'idle',
        lastSeq: null,
        intervalMs: 1000,
        windowSize: 5,
    },
})

describe('rtc-signaler debug state snapshot', () => {
    it('builds snapshot and preserves passed values', () => {
        const snapshot = buildDebugStateSnapshot({
            ...baseInput(),
            lastEvent: 'x',
            lastError: 'err',
        })
        expect(snapshot.role).toBe('caller')
        expect(snapshot.phase).toBe('connected')
        expect(snapshot.lastEvent).toBe('x')
        expect(snapshot.lastError).toBe('err')
    })

    it('fills default empty netRtt when not provided', () => {
        const snapshot = buildDebugStateSnapshot(baseInput())
        expect(snapshot.netRtt).toBeDefined()
        expect(snapshot.netRtt.rttMs).toBeNull()
    })
})
