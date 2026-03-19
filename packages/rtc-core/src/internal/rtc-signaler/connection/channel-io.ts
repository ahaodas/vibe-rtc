export const flushChannelQueue = (channel: RTCDataChannel, queue: string[]) => {
    if (channel.readyState !== 'open' || queue.length === 0) return
    for (const message of queue.splice(0, queue.length)) channel.send(message)
}

export const resolveChannelWaiters = (
    waiters: Array<(channel: RTCDataChannel) => void>,
    channel: RTCDataChannel,
) => {
    if (waiters.length === 0) return
    const pending = waiters.splice(0, waiters.length)
    for (const resolve of pending) {
        try {
            resolve(channel)
        } catch {
            // Consumer callback errors should not break channel readiness propagation.
        }
    }
}

export const createChannelReadyPromise = (
    waiters: Array<(channel: RTCDataChannel) => void>,
): Promise<RTCDataChannel> =>
    new Promise<RTCDataChannel>((resolve) => {
        waiters.push(resolve)
    })

export const waitForBackpressure = async (channel: RTCDataChannel, lowWatermark: number) => {
    if (channel.bufferedAmount <= lowWatermark) return
    await new Promise<void>((resolve) => {
        const onLow = () => {
            channel.removeEventListener('bufferedamountlow', onLow)
            resolve()
        }
        channel.addEventListener('bufferedamountlow', onLow, { once: true })
    })
}
