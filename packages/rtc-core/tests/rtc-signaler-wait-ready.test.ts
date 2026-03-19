import { describe, expect, it } from 'vitest'
import { isWaitReadySatisfied } from '../src/internal/rtc-signaler/connection/wait-ready'

describe('rtc-signaler wait-ready', () => {
    it('returns true only when pc and both channels are open', () => {
        expect(
            isWaitReadySatisfied({
                pcState: 'connected',
                fast: { state: 'open' },
                reliable: { state: 'open' },
            }),
        ).toBe(true)
    })

    it('returns false when fast channel is not open', () => {
        expect(
            isWaitReadySatisfied({
                pcState: 'connected',
                fast: { state: 'connecting' },
                reliable: { state: 'open' },
            }),
        ).toBe(false)
    })

    it('returns false when peer connection is not connected', () => {
        expect(
            isWaitReadySatisfied({
                pcState: 'connecting',
                fast: { state: 'open' },
                reliable: { state: 'open' },
            }),
        ).toBe(false)
    })
})
