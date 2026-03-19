import { describe, expect, it } from 'vitest'
import {
    createChannelReadyPromise,
    flushChannelQueue,
    resolveChannelWaiters,
    waitForBackpressure,
} from '../src/internal/rtc-signaler/connection/channel-io'

class FakeDataChannel {
    readyState: RTCDataChannelState = 'open'
    bufferedAmount = 0
    sent: string[] = []
    private listeners = new Map<string, Array<() => void>>()

    send(message: string) {
        this.sent.push(message)
    }

    addEventListener(event: string, callback: () => void) {
        const list = this.listeners.get(event) ?? []
        list.push(callback)
        this.listeners.set(event, list)
    }

    removeEventListener(event: string, callback: () => void) {
        const list = this.listeners.get(event) ?? []
        this.listeners.set(
            event,
            list.filter((item) => item !== callback),
        )
    }

    emit(event: string) {
        for (const callback of this.listeners.get(event) ?? []) callback()
    }
}

describe('rtc-signaler channel io helpers', () => {
    it('flushes queued messages only for open channel', () => {
        const channel = new FakeDataChannel()
        const queue = ['a', 'b']
        flushChannelQueue(channel as unknown as RTCDataChannel, queue)
        expect(channel.sent).toEqual(['a', 'b'])
        expect(queue).toEqual([])

        channel.readyState = 'closed'
        const queue2 = ['x']
        flushChannelQueue(channel as unknown as RTCDataChannel, queue2)
        expect(queue2).toEqual(['x'])
    })

    it('resolves channel waiters queue', async () => {
        const waiters: Array<(channel: RTCDataChannel) => void> = []
        const promise = createChannelReadyPromise(waiters)
        const channel = new FakeDataChannel() as unknown as RTCDataChannel

        resolveChannelWaiters(waiters, channel)
        await expect(promise).resolves.toBe(channel)
        expect(waiters.length).toBe(0)
    })

    it('waits for bufferedamountlow only when needed', async () => {
        const channel = new FakeDataChannel()
        await waitForBackpressure(channel as unknown as RTCDataChannel, 10)

        channel.bufferedAmount = 100
        const pending = waitForBackpressure(channel as unknown as RTCDataChannel, 10)
        channel.bufferedAmount = 0
        channel.emit('bufferedamountlow')
        await pending
    })
})
