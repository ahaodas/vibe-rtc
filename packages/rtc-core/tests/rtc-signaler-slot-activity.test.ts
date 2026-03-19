import { describe, expect, it, vi } from 'vitest'
import { resolveConfirmedSlotOwnershipMismatch } from '../src/internal/rtc-signaler/session/slot-activity'

describe('rtc-signaler slot activity', () => {
    it('keeps single read when ownership is valid', async () => {
        const readSlot = vi.fn(async () => ({
            participantId: 'p1',
            sessionId: 's1',
            joinedAt: 1,
            lastSeenAt: 2,
        }))

        const result = await resolveConfirmedSlotOwnershipMismatch({
            readSlot,
            localParticipantId: 'p1',
            localSessionId: 's1',
        })

        expect(readSlot).toHaveBeenCalledTimes(1)
        expect(result.ownerMismatch).toBe(false)
        expect(result.sessionMismatch).toBe(false)
        expect(result.checks).toBe(1)
    })

    it('rechecks mismatch and returns confirmed snapshot', async () => {
        const readSlot = vi
            .fn()
            .mockResolvedValueOnce({
                participantId: 'p1',
                sessionId: 'other',
                joinedAt: 1,
                lastSeenAt: 2,
            })
            .mockResolvedValueOnce({
                participantId: 'p1',
                sessionId: 's1',
                joinedAt: 1,
                lastSeenAt: 3,
            })

        const result = await resolveConfirmedSlotOwnershipMismatch({
            readSlot,
            localParticipantId: 'p1',
            localSessionId: 's1',
        })

        expect(readSlot).toHaveBeenCalledTimes(2)
        expect(result.sessionMismatch).toBe(false)
        expect(result.ownerMismatch).toBe(false)
        expect(result.checks).toBe(2)
    })

    it('returns mismatch after confirmation when takeover persists', async () => {
        const readSlot = vi.fn(async () => ({
            participantId: 'other-participant',
            sessionId: 'other-session',
            joinedAt: 1,
            lastSeenAt: 2,
        }))

        const result = await resolveConfirmedSlotOwnershipMismatch({
            readSlot,
            localParticipantId: 'p1',
            localSessionId: 's1',
        })

        expect(readSlot).toHaveBeenCalledTimes(2)
        expect(result.ownerMismatch).toBe(true)
        expect(result.sessionMismatch).toBe(true)
        expect(result.checks).toBe(2)
    })
})
