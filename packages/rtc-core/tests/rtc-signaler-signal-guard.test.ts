import { describe, expect, it, vi } from 'vitest'
import { canProcessIncomingSignal } from '../src/internal/rtc-signaler/signaling/signal-guard'

describe('rtc-signaler signal guard', () => {
    it('blocks when epoch is rejected', async () => {
        const ensureOwnSlotActive = vi.fn(async () => true)
        const result = await canProcessIncomingSignal({
            epochLike: 1,
            source: 'recv-offer',
            acceptEpoch: () => false,
            ensureOwnSlotActive,
        })
        expect(result).toBe(false)
        expect(ensureOwnSlotActive).not.toHaveBeenCalled()
    })

    it('allows signal after epoch check by default', async () => {
        const ensureOwnSlotActive = vi.fn(async () => true)
        const result = await canProcessIncomingSignal({
            epochLike: 2,
            source: 'recv-answer',
            acceptEpoch: () => true,
            ensureOwnSlotActive,
        })
        expect(result).toBe(true)
        expect(ensureOwnSlotActive).not.toHaveBeenCalled()
    })

    it('delegates to own-slot guard when explicitly required', async () => {
        const ensureOwnSlotActive = vi.fn(async () => true)
        const result = await canProcessIncomingSignal({
            epochLike: 2,
            source: 'recv-answer',
            acceptEpoch: () => true,
            ensureOwnSlotActive,
            requireOwnSlotActive: true,
        })
        expect(result).toBe(true)
        expect(ensureOwnSlotActive).toHaveBeenCalledWith('recv-answer')
    })
})
