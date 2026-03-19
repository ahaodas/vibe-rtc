import { describe, expect, it } from 'vitest'
import {
    applyHardRetry,
    applySoftRetry,
    createRecoveryBackoffState,
    resetRecoveryBackoffState,
} from '../src/internal/rtc-signaler/recovery/recovery-state'

describe('rtc-signaler recovery state', () => {
    it('creates and resets initial backoff state', () => {
        const initial = createRecoveryBackoffState()
        expect(initial.softRetries).toBe(0)
        expect(initial.hardRetries).toBe(0)
        expect(initial.softDelayMs).toBe(250)
        expect(initial.hardDelayMs).toBe(6000)

        const reset = resetRecoveryBackoffState()
        expect(reset).toEqual(initial)
    })

    it('applies soft retry progression', () => {
        const initial = createRecoveryBackoffState()
        const next = applySoftRetry(initial)
        expect(next.softRetries).toBe(1)
        expect(next.softDelayMs).toBe(500)
        expect(next.hardRetries).toBe(0)
    })

    it('applies hard retry progression', () => {
        const initial = createRecoveryBackoffState()
        const next = applyHardRetry(initial)
        expect(next.hardRetries).toBe(1)
        expect(next.hardDelayMs).toBe(12000)
        expect(next.softRetries).toBe(0)
    })
})
