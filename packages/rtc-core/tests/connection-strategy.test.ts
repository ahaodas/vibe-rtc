import { describe, expect, it } from 'vitest'
import {
    getCandidateType,
    shouldAcceptCandidate,
    shouldSendCandidate,
} from '../src/connection-strategy'

describe('connection strategy helpers', () => {
    it('detects host candidates including mDNS hostnames', () => {
        const mdnsHostCandidate =
            'candidate:1 1 udp 2122260223 4f5b9d3a-3a3f-44a8-b6a7.local 53412 typ host'
        expect(getCandidateType(mdnsHostCandidate)).toBe('host')
    })

    it('blocks non-host candidates in LAN phase', () => {
        const srflxCandidate =
            'candidate:2 1 udp 1686052607 203.0.113.10 58023 typ srflx raddr 0.0.0.0 rport 0'
        expect(shouldSendCandidate('LAN', srflxCandidate)).toBe(false)
        expect(shouldAcceptCandidate('LAN', srflxCandidate)).toBe(false)
    })

    it('allows srflx candidates outside LAN-only phase', () => {
        const srflxCandidate =
            'candidate:2 1 udp 1686052607 203.0.113.10 58023 typ srflx raddr 0.0.0.0 rport 0'
        expect(shouldSendCandidate('STUN', srflxCandidate)).toBe(true)
        expect(shouldAcceptCandidate('STUN', srflxCandidate)).toBe(true)
    })
})
