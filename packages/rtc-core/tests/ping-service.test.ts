import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPingService, PING_PROTOCOL_PREFIX } from '../src/protocol/ping'

type PingMessage = {
    type: 'ping' | 'pong'
    sentAt: number
    seq: number
}

const parseWire = (wire: string): PingMessage => {
    expect(wire.startsWith(PING_PROTOCOL_PREFIX)).toBe(true)
    return JSON.parse(wire.slice(PING_PROTOCOL_PREFIX.length)) as PingMessage
}

const toWire = (message: PingMessage): string => `${PING_PROTOCOL_PREFIX}${JSON.stringify(message)}`

afterEach(() => {
    vi.useRealTimers()
})

describe('createPingService', () => {
    it('calculates RTT from pong using local monotonic clock', () => {
        vi.useFakeTimers()
        const sent: string[] = []
        let nowMs = 0

        const service = createPingService({
            send: (message) => sent.push(message),
            isOpen: () => true,
            intervalMs: 1000,
            now: () => nowMs,
            nowEpoch: () => nowMs,
        })

        service.start()
        expect(sent).toHaveLength(1)

        const ping = parseWire(sent[0])
        nowMs = ping.sentAt + 87
        const consumed = service.handleIncoming(
            toWire({
                type: 'pong',
                sentAt: ping.sentAt,
                seq: ping.seq,
            }),
        )

        expect(consumed).toBe(true)
        const snapshot = service.getSnapshot()
        expect(snapshot.lastRttMs).toBe(87)
        expect(snapshot.smoothedRttMs).toBe(87)
        expect(snapshot.jitterMs).toBeNull()
    })

    it('keeps smoothed ping as rolling average over the configured window', async () => {
        vi.useFakeTimers()
        const sent: string[] = []
        let nowMs = 0

        const service = createPingService({
            send: (message) => sent.push(message),
            isOpen: () => true,
            intervalMs: 1000,
            windowSize: 5,
            now: () => nowMs,
            nowEpoch: () => nowMs,
        })

        service.start()
        const samples = [10, 20, 30, 40, 50, 100]

        for (let i = 0; i < samples.length; i += 1) {
            const ping = parseWire(sent[sent.length - 1])
            nowMs = ping.sentAt + samples[i]
            service.handleIncoming(toWire({ type: 'pong', sentAt: ping.sentAt, seq: ping.seq }))
            if (i < samples.length - 1) {
                nowMs = ping.sentAt + 1000
                await vi.advanceTimersByTimeAsync(1000)
            }
        }

        const snapshot = service.getSnapshot()
        expect(snapshot.lastRttMs).toBe(100)
        expect(snapshot.smoothedRttMs).toBeCloseTo(48, 4)
        expect(snapshot.jitterMs).toBe(50)
    })

    it('stop() clears interval and prevents further ping sends', async () => {
        vi.useFakeTimers()
        const sent: string[] = []
        let nowMs = 0

        const service = createPingService({
            send: (message) => sent.push(message),
            isOpen: () => true,
            intervalMs: 1000,
            now: () => nowMs,
            nowEpoch: () => nowMs,
        })

        service.start()
        expect(sent).toHaveLength(1)

        nowMs = 1000
        await vi.advanceTimersByTimeAsync(1000)
        expect(sent).toHaveLength(2)

        service.stop()
        nowMs = 10_000
        await vi.advanceTimersByTimeAsync(9000)

        expect(sent).toHaveLength(2)
        expect(service.getSnapshot().status).toBe('idle')
    })

    it('ignores malformed or unrelated incoming payloads', () => {
        const sent = vi.fn()
        const service = createPingService({
            send: sent,
            isOpen: () => true,
        })

        expect(service.handleIncoming('plain-text')).toBe(false)
        expect(service.handleIncoming(`${PING_PROTOCOL_PREFIX}{bad-json}`)).toBe(false)
        expect(
            service.handleIncoming(
                `${PING_PROTOCOL_PREFIX}${JSON.stringify({ type: 'pong', sentAt: 'x', seq: 1 })}`,
            ),
        ).toBe(false)

        const snapshot = service.getSnapshot()
        expect(snapshot.lastRttMs).toBeNull()
        expect(snapshot.smoothedRttMs).toBeNull()
        expect(snapshot.jitterMs).toBeNull()
        expect(sent).toHaveBeenCalledTimes(0)
    })
})
