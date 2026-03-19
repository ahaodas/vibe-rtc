import { describe, expect, it } from 'vitest'
import {
    getRoleSlotFromRoom,
    getRoleSlotSessionIdFromRoom,
} from '../src/internal/rtc-signaler/session/room-slots'
import type { RoomDoc } from '../src/types'

const makeRoom = (): RoomDoc => ({
    creatorUid: null,
    callerUid: null,
    calleeUid: null,
    offer: null,
    answer: null,
    epoch: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    slots: {
        caller: {
            participantId: 'caller-p',
            sessionId: '  caller-s  ',
            joinedAt: 1,
            lastSeenAt: 2,
        },
        callee: {
            participantId: 'callee-p',
            sessionId: 'callee-s',
            joinedAt: 3,
            lastSeenAt: 4,
        },
    },
})

describe('rtc-signaler room slot helpers', () => {
    it('extracts role slot object', () => {
        const room = makeRoom()
        expect(getRoleSlotFromRoom(room, 'caller')?.participantId).toBe('caller-p')
        expect(getRoleSlotFromRoom(room, 'callee')?.participantId).toBe('callee-p')
    })

    it('extracts trimmed role session id', () => {
        const room = makeRoom()
        expect(getRoleSlotSessionIdFromRoom(room, 'caller')).toBe('caller-s')
        expect(getRoleSlotSessionIdFromRoom(room, 'callee')).toBe('callee-s')
        expect(getRoleSlotSessionIdFromRoom(null, 'caller')).toBeNull()
    })
})
