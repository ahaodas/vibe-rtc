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

    it('normalizes takeover-like INVALID_STATE to TAKEOVER_DETECTED', () => {
        const e = normalizeError({ message: 'takeover detected', code: 'INVALID_STATE' })
        expect(e.code).toBe('TAKEOVER_DETECTED')
        expect(e.message).toBe('Room slot was taken over in another tab')
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

    it('does not reset connecting status on BOOT_OK', () => {
        const booting = reducer(initialState, { type: 'BOOT_START' })
        const connecting = reducer(booting, { type: 'SET_STATUS', status: 'connecting' })
        const afterBoot = reducer(connecting, { type: 'BOOT_OK' })
        expect(afterBoot.status).toBe('connecting')
    })

    it('does not downgrade connecting status on BOOT_START', () => {
        const connecting = reducer(initialState, { type: 'SET_STATUS', status: 'connecting' })
        const booting = reducer(connecting, { type: 'BOOT_START' })
        expect(booting.status).toBe('connecting')
    })

    it('handles normalizeError with null/undefined inputs', () => {
        const e1 = normalizeError(null)
        expect(e1.name).toBe('Error')
        expect(e1.message).toBe('Unknown error')
        expect(e1.code).toBeUndefined()

        const e2 = normalizeError(undefined)
        expect(e2.name).toBe('Error')
        expect(e2.message).toBe('Unknown error')

        const e3 = normalizeError('string error')
        expect(e3.message).toBe('Unknown error')
    })

    it('normalizes takeover with "taken over" message', () => {
        const e = normalizeError({ message: 'room was taken over', code: 'INVALID_STATE' })
        expect(e.code).toBe('TAKEOVER_DETECTED')
        expect(e.message).toBe('Room slot was taken over in another tab')
    })

    it('normalizes TAKEOVER_DETECTED code directly', () => {
        const e = normalizeError({ message: 'custom message', code: 'TAKEOVER_DETECTED' })
        expect(e.code).toBe('TAKEOVER_DETECTED')
        expect(e.message).toBe('Room slot was taken over in another tab')
    })

    it('handles SET_ROOM action', () => {
        const s = reducer(initialState, { type: 'SET_ROOM', roomId: 'test-room-123' })
        expect(s.roomId).toBe('test-room-123')

        const s2 = reducer(s, { type: 'SET_ROOM', roomId: null })
        expect(s2.roomId).toBeNull()
    })

    it('handles SET_DEBUG_DATA action', () => {
        const debugState = {
            pcState: 'connected' as RTCPeerConnectionState,
            iceState: 'completed' as RTCIceConnectionState,
            phase: 'STUN' as const,
            pcGeneration: 1,
            lastEvent: 'connected',
        }
        const s = reducer(initialState, { type: 'SET_DEBUG_DATA', debugState })
        expect(s.debugState).toEqual(debugState)
    })

    it('clears lastError when SET_LAST_ERROR with undefined', () => {
        const withError = reducer(initialState, {
            type: 'SET_LAST_ERROR',
            error: { name: 'Error', message: 'test', at: Date.now() },
        })
        expect(withError.lastError).toBeDefined()
        expect(withError.status).toBe('error')

        const cleared = reducer(withError, { type: 'SET_LAST_ERROR', error: undefined })
        expect(cleared.lastError).toBeUndefined()
        expect(cleared.status).toBe('error') // status doesn't change when clearing error
    })

    it('handles BOOT_ERROR action', () => {
        const error = { name: 'BootError', message: 'failed to init', at: Date.now() }
        const s = reducer(initialState, { type: 'BOOT_ERROR', error })
        expect(s.booting).toBe(false)
        expect(s.bootError).toEqual(error)
        expect(s.status).toBe('error')
    })

    it('increments message sequences correctly', () => {
        let state = initialState

        // Send 3 fast messages
        for (let i = 0; i < 3; i++) {
            state = reducer(state, {
                type: 'FAST_MESSAGE',
                message: { at: Date.now(), data: `fast-${i}` },
            })
        }
        expect(state.messageSeqFast).toBe(3)
        expect(state.lastFastMessage?.data).toBe('fast-2')

        // Send 2 reliable messages
        for (let i = 0; i < 2; i++) {
            state = reducer(state, {
                type: 'RELIABLE_MESSAGE',
                message: { at: Date.now(), data: `reliable-${i}` },
            })
        }
        expect(state.messageSeqReliable).toBe(2)
        expect(state.lastReliableMessage?.data).toBe('reliable-1')
    })
})
