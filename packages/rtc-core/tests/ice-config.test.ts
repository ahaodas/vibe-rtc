import { describe, expect, it } from 'vitest'
import {
    DEFAULT_ICE_SERVERS,
    extractStunOnlyIceServers,
    extractTurnOnlyIceServers,
    parseIceServers,
    withDefaultIceServers,
} from '../src/ice-config'

describe('ICE config utils', () => {
    it('returns undefined for empty input', () => {
        expect(parseIceServers(undefined)).toBeUndefined()
        expect(parseIceServers(null)).toBeUndefined()
        expect(parseIceServers('')).toBeUndefined()
        expect(parseIceServers('   ')).toBeUndefined()
    })

    it('parses CSV STUN/TURN urls', () => {
        const servers = parseIceServers('stun:a, turn:b?transport=udp')
        expect(servers).toEqual([{ urls: ['stun:a', 'turn:b?transport=udp'] }])
    })

    it('parses JSON array config', () => {
        const servers = parseIceServers(
            JSON.stringify([
                { urls: ['stun:a', 'stun:b'] },
                { urls: 'turn:c', username: 'u', credential: 'p' },
            ]),
        )
        expect(servers).toEqual([
            { urls: ['stun:a', 'stun:b'] },
            { urls: 'turn:c', username: 'u', credential: 'p' },
        ])
    })

    it('parses JSON object config', () => {
        const servers = parseIceServers(JSON.stringify({ urls: 'stun:a' }))
        expect(servers).toEqual([{ urls: 'stun:a' }])
    })

    it('throws on invalid JSON', () => {
        expect(() => parseIceServers('[{]')).toThrow(/Invalid ICE servers JSON/)
    })

    it('uses default iceServers when config is missing', () => {
        const cfg = withDefaultIceServers(undefined)
        expect(cfg.iceServers).toEqual(DEFAULT_ICE_SERVERS)
    })

    it('keeps explicit iceServers as-is', () => {
        const cfg = withDefaultIceServers({ iceServers: [{ urls: 'stun:custom' }] })
        expect(cfg.iceServers).toEqual([{ urls: 'stun:custom' }])
    })

    it('fills defaults when explicit iceServers is empty', () => {
        const cfg = withDefaultIceServers({ iceServers: [] })
        expect(cfg.iceServers).toEqual(DEFAULT_ICE_SERVERS)
    })

    it('extracts STUN-only urls from mixed servers (string urls)', () => {
        const result = extractStunOnlyIceServers([
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' },
        ])
        expect(result).toEqual([{ urls: 'stun:stun.l.google.com:19302' }])
    })

    it('extracts TURN-only urls from mixed servers (array urls)', () => {
        const result = extractTurnOnlyIceServers([
            {
                urls: [
                    'stun:stun.l.google.com:19302',
                    'turn:turn.example.com:3478',
                    'turns:turn.example.com:5349?transport=tcp',
                ],
                username: 'u',
                credential: 'c',
            },
        ])
        expect(result).toEqual([
            {
                urls: ['turn:turn.example.com:3478', 'turns:turn.example.com:5349?transport=tcp'],
                username: 'u',
                credential: 'c',
            },
        ])
    })

    it('returns empty arrays when target scheme is absent', () => {
        expect(extractStunOnlyIceServers([{ urls: 'turn:turn.example.com:3478' }])).toEqual([])
        expect(extractTurnOnlyIceServers([{ urls: 'stun:stun.l.google.com:19302' }])).toEqual([])
    })
})
