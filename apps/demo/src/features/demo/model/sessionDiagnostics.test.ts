import { describe, expect, it } from 'vitest'
import {
    isRoomNotFoundError,
    isTakeoverError,
    toPingMs,
} from '@/features/demo/model/sessionDiagnostics'

describe('sessionDiagnostics helpers', () => {
    it('maps ping values to rounded milliseconds or null', () => {
        expect(toPingMs(12.7)).toBe(13)
        expect(toPingMs(0)).toBe(0)
        expect(toPingMs(null)).toBeNull()
        expect(toPingMs(undefined)).toBeNull()
        expect(toPingMs(-1)).toBeNull()
        expect(toPingMs(Number.NaN)).toBeNull()
        expect(toPingMs(Number.POSITIVE_INFINITY)).toBeNull()
    })

    it('detects room-not-found errors by code or message', () => {
        expect(isRoomNotFoundError('No such document in db', undefined)).toBe(true)
        expect(isRoomNotFoundError('Room not found: x', undefined)).toBe(true)
        expect(isRoomNotFoundError('anything', 'ROOM_NOT_FOUND')).toBe(true)
        expect(isRoomNotFoundError('network timeout', 'NETWORK')).toBe(false)
    })

    it('detects takeover errors by code and takeover phrases', () => {
        expect(isTakeoverError('any', 'TAKEOVER_DETECTED')).toBe(true)
        expect(isTakeoverError('takeover detected on reconnect', 'INVALID_STATE')).toBe(true)
        expect(isTakeoverError('Room was taken over in another tab', undefined)).toBe(true)
        expect(isTakeoverError('random failure', 'UNKNOWN')).toBe(false)
    })
})
