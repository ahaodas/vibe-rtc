import { describe, expect, it } from 'vitest'
import { resolveRemoteSessionSyncDecision } from '../src/internal/rtc-signaler/signaling/remote-session-sync'

describe('rtc-signaler remote session sync', () => {
    it('keeps current session when remote session is missing', () => {
        const decision = resolveRemoteSessionSyncDecision({
            source: 'offer',
            role: 'callee',
            remoteSessionId: undefined,
            currentSessionId: 'local-a',
            remoteDescSet: false,
        })
        expect(decision).toEqual({
            action: 'keep-current',
            nextSessionId: 'local-a',
        })
    })

    it('keeps current session when remote and current session ids match', () => {
        const decision = resolveRemoteSessionSyncDecision({
            source: 'candidate',
            role: 'caller',
            remoteSessionId: 'same',
            currentSessionId: 'same',
            remoteDescSet: false,
        })
        expect(decision).toEqual({
            action: 'keep-current',
            nextSessionId: 'same',
        })
    })

    it('adopts remote answer session for caller', () => {
        const decision = resolveRemoteSessionSyncDecision({
            source: 'answer',
            role: 'caller',
            remoteSessionId: 'remote-a',
            currentSessionId: 'local-a',
            remoteDescSet: true,
        })
        expect(decision).toEqual({
            action: 'adopt-session',
            nextSessionId: 'remote-a',
        })
    })

    it('adopts pre-offer candidate session while remote description is not set', () => {
        const decision = resolveRemoteSessionSyncDecision({
            source: 'candidate',
            role: 'callee',
            remoteSessionId: 'remote-a',
            currentSessionId: 'local-a',
            remoteDescSet: false,
        })
        expect(decision).toEqual({
            action: 'adopt-session',
            nextSessionId: 'remote-a',
        })
    })

    it('rejects stale non-offer signals after remote description is set', () => {
        const decision = resolveRemoteSessionSyncDecision({
            source: 'candidate',
            role: 'callee',
            remoteSessionId: 'stale',
            currentSessionId: 'local-a',
            remoteDescSet: true,
        })
        expect(decision).toEqual({
            action: 'reject-stale',
            staleSessionId: 'stale',
        })
    })

    it('requests peer rebuild when offer comes from a new session', () => {
        const decision = resolveRemoteSessionSyncDecision({
            source: 'offer',
            role: 'callee',
            remoteSessionId: 'remote-b',
            currentSessionId: 'local-a',
            remoteDescSet: true,
        })
        expect(decision).toEqual({
            action: 'rebuild-peer',
            nextSessionId: 'remote-b',
        })
    })
})
