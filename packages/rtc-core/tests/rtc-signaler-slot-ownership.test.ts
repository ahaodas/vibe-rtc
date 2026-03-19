import { describe, expect, it } from 'vitest'
import { detectSlotOwnershipMismatch } from '../src/internal/rtc-signaler/session/slot-ownership'

describe('rtc-signaler slot ownership', () => {
    it('detects owner mismatch', () => {
        const mismatch = detectSlotOwnershipMismatch(
            {
                participantId: 'remote-a',
                sessionId: 'session-a',
                joinedAt: 1,
                lastSeenAt: 2,
            },
            'local-b',
            'session-a',
        )
        expect(mismatch.ownerMismatch).toBe(true)
        expect(mismatch.sessionMismatch).toBe(false)
    })

    it('detects session mismatch and key', () => {
        const mismatch = detectSlotOwnershipMismatch(
            {
                participantId: 'same-user',
                sessionId: 'session-a',
                joinedAt: 1,
                lastSeenAt: 2,
            },
            'same-user',
            'session-b',
        )
        expect(mismatch.ownerMismatch).toBe(false)
        expect(mismatch.sessionMismatch).toBe(true)
        expect(mismatch.mismatchKey).toBe('session-a|session-b')
    })

    it('returns no mismatch when slot is missing', () => {
        const mismatch = detectSlotOwnershipMismatch(undefined, 'p1', 's1')
        expect(mismatch.ownerMismatch).toBe(false)
        expect(mismatch.sessionMismatch).toBe(false)
        expect(mismatch.mismatchKey).toBeNull()
    })
})
