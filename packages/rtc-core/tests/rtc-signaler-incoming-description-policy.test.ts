import { describe, expect, it } from 'vitest'
import {
    resolveIncomingAnswerAction,
    resolveOfferAnswerGuardAction,
    resolveOfferCollisionAction,
    shouldIgnoreAnswerForTargetSession,
    shouldIgnoreEchoOffer,
} from '../src/internal/rtc-signaler/signaling/incoming-description-policy'

describe('rtc-signaler incoming description policy', () => {
    it('detects echo offers for caller only', () => {
        expect(
            shouldIgnoreEchoOffer({
                role: 'caller',
                offerSdp: 'v=0 ...',
                lastLocalOfferSdp: 'v=0 ...',
            }),
        ).toBe(true)

        expect(
            shouldIgnoreEchoOffer({
                role: 'callee',
                offerSdp: 'v=0 ...',
                lastLocalOfferSdp: 'v=0 ...',
            }),
        ).toBe(false)
    })

    it('resolves collision handling by politeness', () => {
        expect(
            resolveOfferCollisionAction({
                makingOffer: true,
                signalingState: 'stable',
                polite: false,
            }),
        ).toBe('ignore')

        expect(
            resolveOfferCollisionAction({
                makingOffer: false,
                signalingState: 'have-local-offer',
                polite: true,
            }),
        ).toBe('rollback')

        expect(
            resolveOfferCollisionAction({
                makingOffer: false,
                signalingState: 'stable',
                polite: true,
            }),
        ).toBe('proceed')
    })

    it('guards answer generation from invalid state and re-entrancy', () => {
        expect(
            resolveOfferAnswerGuardAction({
                signalingState: 'stable',
                answering: false,
            }),
        ).toBe('skip-state')

        expect(
            resolveOfferAnswerGuardAction({
                signalingState: 'have-remote-offer',
                answering: true,
            }),
        ).toBe('skip-answering')

        expect(
            resolveOfferAnswerGuardAction({
                signalingState: 'have-remote-offer',
                answering: false,
            }),
        ).toBe('proceed')
    })

    it('filters answers by target session for caller only', () => {
        expect(
            shouldIgnoreAnswerForTargetSession({
                role: 'caller',
                answerForSessionId: 'session-b',
                localRoleSessionId: 'session-a',
            }),
        ).toBe(true)

        expect(
            shouldIgnoreAnswerForTargetSession({
                role: 'caller',
                answerForSessionId: 'session-a',
                localRoleSessionId: 'session-a',
            }),
        ).toBe(false)

        expect(
            shouldIgnoreAnswerForTargetSession({
                role: 'callee',
                answerForSessionId: 'session-b',
                localRoleSessionId: 'session-a',
            }),
        ).toBe(false)
    })

    it('resolves incoming answer handling for reconnect vs ignore vs apply', () => {
        expect(
            resolveIncomingAnswerAction({
                role: 'caller',
                signalingState: 'have-local-offer',
                remoteSessionChanged: false,
            }),
        ).toBe('apply')

        expect(
            resolveIncomingAnswerAction({
                role: 'caller',
                signalingState: 'stable',
                remoteSessionChanged: true,
            }),
        ).toBe('trigger-hard-reconnect')

        expect(
            resolveIncomingAnswerAction({
                role: 'caller',
                signalingState: 'stable',
                remoteSessionChanged: false,
            }),
        ).toBe('ignore-not-waiting')
    })
})
