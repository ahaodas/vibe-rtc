import { describe, expect, it } from 'vitest'
import {
    buildAnswerPayload,
    buildCandidatePayload,
    buildOfferPayload,
} from '../src/internal/rtc-signaler/signaling/signal-payloads'

describe('rtc-signaler signal payloads', () => {
    it('builds offer payload with generation markers and session targeting', () => {
        const payload = buildOfferPayload({
            offer: { type: 'offer', sdp: 'offer-sdp' },
            epoch: 7,
            generation: 3,
            signalSeq: 11,
            sessionId: 'caller-session',
            icePhase: 'STUN_ONLY',
        })
        expect(payload).toEqual({
            type: 'offer',
            sdp: 'offer-sdp',
            epoch: 7,
            pcGeneration: 3,
            gen: 3,
            forGen: 11,
            sessionId: 'caller-session',
            forSessionId: 'caller-session',
            icePhase: 'STUN_ONLY',
        })
    })

    it('builds answer payload with explicit target session', () => {
        const payload = buildAnswerPayload({
            answer: { type: 'answer', sdp: 'answer-sdp' },
            epoch: 9,
            generation: 5,
            signalSeq: 21,
            sessionId: 'callee-session',
            forSessionId: 'caller-session',
            icePhase: 'TURN_ENABLED',
        })
        expect(payload).toEqual({
            type: 'answer',
            sdp: 'answer-sdp',
            epoch: 9,
            pcGeneration: 5,
            gen: 5,
            forGen: 21,
            sessionId: 'callee-session',
            forSessionId: 'caller-session',
            icePhase: 'TURN_ENABLED',
        })
    })

    it('builds candidate payload with epoch/session markers', () => {
        const payload = buildCandidatePayload({
            candidate: {
                candidate: 'candidate:1 1 udp 2122260223 192.0.2.10 5000 typ host',
                sdpMid: '0',
                sdpMLineIndex: 0,
            },
            epoch: 2,
            generation: 4,
            sessionId: 'caller-session',
            icePhase: 'LAN',
        })
        expect(payload).toEqual({
            candidate: 'candidate:1 1 udp 2122260223 192.0.2.10 5000 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
            epoch: 2,
            pcGeneration: 4,
            gen: 4,
            sessionId: 'caller-session',
            icePhase: 'LAN',
        })
    })
})
