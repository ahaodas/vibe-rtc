import { describe, expect, it } from 'vitest'
import { FBAdapter } from '../../src/FBAdapter'

describe('FBAdapter accessors', () => {
    it('uses authenticated uid as participant id', () => {
        const adapter = new FBAdapter(
            {} as never,
            {
                currentUser: {
                    uid: 'uid-test-001',
                },
            } as never,
        )

        expect(adapter.getParticipantId()).toBe('uid-test-001')
    })

    it('starts with empty role sessions', () => {
        const adapter = new FBAdapter(
            {} as never,
            {
                currentUser: {
                    uid: 'uid-test-002',
                },
            } as never,
        )

        expect(adapter.getRoleSessionId('caller')).toBeNull()
        expect(adapter.getRoleSessionId('callee')).toBeNull()
    })
})
