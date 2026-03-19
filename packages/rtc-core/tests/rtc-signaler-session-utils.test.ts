import { describe, expect, it } from 'vitest'
import {
    createSessionId,
    errorMessage,
    getSignalSessionId,
    getSignalTargetSessionId,
    isTakeoverWriteError,
} from '../src/internal/rtc-signaler/signaling/session-utils'

describe('rtc-signaler session utils', () => {
    it('creates non-empty session identifiers', () => {
        const sessionId = createSessionId()
        expect(typeof sessionId).toBe('string')
        expect(sessionId.length).toBeGreaterThan(8)
    })

    it('extracts session markers from incoming signals', () => {
        expect(getSignalSessionId({ sessionId: ' abc ' })).toBe('abc')
        expect(getSignalSessionId({ sessionId: '   ' })).toBeUndefined()
        expect(getSignalSessionId({})).toBeUndefined()

        expect(getSignalTargetSessionId({ forSessionId: ' xyz ' })).toBe('xyz')
        expect(getSignalTargetSessionId({ forSessionId: '' })).toBeUndefined()
    })

    it('normalizes unknown errors to message text', () => {
        expect(errorMessage('plain')).toBe('plain')
        expect(errorMessage(new Error('boom'))).toBe('boom')
        expect(errorMessage({})).toBe('[object Object]')
    })

    it('detects takeover write errors from message and nested cause', () => {
        expect(isTakeoverWriteError(new Error('Taken over by newer session'))).toBe(true)
        expect(
            isTakeoverWriteError({
                message: 'permission error',
                cause: new Error('slot taken over'),
            }),
        ).toBe(true)
        expect(isTakeoverWriteError(new Error('network timeout'))).toBe(false)
    })
})
