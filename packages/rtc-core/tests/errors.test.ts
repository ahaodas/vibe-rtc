import { describe, expect, it } from 'vitest'
import { RTCSignaler } from '../src/RTCSignaler'
import { RTCErrorCode, toRTCError } from '../src/errors'
import type { SignalDB } from '../src/types'

const makeDb = (overrides: Partial<SignalDB> = {}): SignalDB =>
    ({
        createRoom: async () => 'room-1',
        joinRoom: async () => {},
        getRoom: async () => null,
        getOffer: async () => null,
        setOffer: async () => {},
        clearOffer: async () => {},
        setAnswer: async () => {},
        clearAnswer: async () => {},
        addCallerIceCandidate: async () => {},
        addCalleeIceCandidate: async () => {},
        subscribeOnCallerIceCandidate: () => () => {},
        subscribeOnCalleeIceCandidate: () => () => {},
        subscribeOnOffer: () => () => {},
        subscribeOnAnswer: () => () => {},
        clearCallerCandidates: async () => {},
        clearCalleeCandidates: async () => {},
        endRoom: async () => {},
        ...overrides,
    }) as SignalDB

describe('RTCError mapping', () => {
    it('maps room-not-selected and timeout errors', async () => {
        const s = new RTCSignaler('caller', makeDb())

        await expect(s.connect()).rejects.toMatchObject({
            code: RTCErrorCode.ROOM_NOT_SELECTED,
        })

        await expect(s.waitReady({ timeoutMs: 1 })).rejects.toMatchObject({
            code: RTCErrorCode.WAIT_READY_TIMEOUT,
        })
    })

    it('throws room-not-found when room does not exist on connect', async () => {
        const s = new RTCSignaler('caller', makeDb({ getRoom: async () => null }))
        await s.joinRoom('missing-room')
        await expect(s.connect()).rejects.toMatchObject({
            code: RTCErrorCode.ROOM_NOT_FOUND,
        })
    })

    it('maps DB failures on createRoom', async () => {
        const s = new RTCSignaler(
            'caller',
            makeDb({
                createRoom: async () => {
                    throw new Error('db unavailable')
                },
            }),
        )

        await expect(s.createRoom()).rejects.toMatchObject({
            code: RTCErrorCode.DB_UNAVAILABLE,
        })
    })

    it('classifies auth-required errors', () => {
        const err = toRTCError(new Error('Auth required'), {
            fallbackCode: RTCErrorCode.UNKNOWN,
        })
        expect(err.code).toBe(RTCErrorCode.AUTH_REQUIRED)
    })
})
