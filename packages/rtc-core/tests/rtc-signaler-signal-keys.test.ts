import { describe, expect, it } from 'vitest'
import {
    createDescriptionSignalKey,
    createStaleSessionLogKey,
} from '../src/internal/rtc-signaler/signaling/signal-keys'

describe('rtc-signaler signal keys', () => {
    it('builds description dedupe key from provided fields', () => {
        const key = createDescriptionSignalKey({
            sessionId: 'remote-1',
            forSessionId: 'local-1',
            gen: 2,
            sdp: 'v=0',
        })
        expect(key).toBe('remote-1|local-1|2|v=0')
    })

    it('uses fallback markers when fields are absent', () => {
        const key = createDescriptionSignalKey({})
        expect(key).toBe('n/a|n/a|-1|')
    })

    it('builds stale-session log key', () => {
        const key = createStaleSessionLogKey('answer', 'remote-x', 'local-y')
        expect(key).toBe('answer:remote-x:local-y')
    })
})
