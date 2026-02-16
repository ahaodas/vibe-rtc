import { describe, expect, it } from 'vitest'
import { initialState, mapPcState, normalizeError, reducer } from './state'

describe('rtc-react state helpers', () => {
    it('maps pc states to ui status', () => {
        expect(mapPcState('connected')).toBe('connected')
        expect(mapPcState('connecting')).toBe('connecting')
        expect(mapPcState('new')).toBe('connecting')
        expect(mapPcState('disconnected')).toBe('disconnected')
        expect(mapPcState('failed')).toBe('disconnected')
        expect(mapPcState('closed')).toBe('disconnected')
    })

    it('normalizes unknown errors to ui-friendly shape', () => {
        const e = normalizeError({ message: 'boom', code: 'X_FAIL', cause: { any: true } })
        expect(e.name).toBe('Error')
        expect(e.message).toBe('boom')
        expect(e.code).toBe('X_FAIL')
        expect(e.cause).toEqual({ any: true })
        expect(typeof e.at).toBe('number')
    })

    it('tracks message sequence and reset semantics', () => {
        const s1 = reducer(initialState, {
            type: 'FAST_MESSAGE',
            message: { at: 1, data: 'f1' },
        })
        expect(s1.messageSeqFast).toBe(1)
        expect(s1.lastFastMessage?.data).toBe('f1')

        const s2 = reducer(s1, {
            type: 'RELIABLE_MESSAGE',
            message: { at: 2, data: 'r1' },
        })
        expect(s2.messageSeqReliable).toBe(1)
        expect(s2.lastReliableMessage?.data).toBe('r1')

        const s3 = reducer(s2, { type: 'RESET_MESSAGES' })
        expect(s3.messageSeqFast).toBe(0)
        expect(s3.messageSeqReliable).toBe(0)
        expect(s3.lastFastMessage).toBeUndefined()
        expect(s3.lastReliableMessage).toBeUndefined()
    })

    it('sets status to error when lastError exists', () => {
        const s = reducer(initialState, {
            type: 'SET_LAST_ERROR',
            error: {
                name: 'RTCError',
                message: 'timeout',
                code: 'SIGNAL_TIMEOUT',
                at: Date.now(),
            },
        })
        expect(s.status).toBe('error')
        expect(s.lastError?.code).toBe('SIGNAL_TIMEOUT')
    })
})
