import { describe, expect, it } from 'vitest'
import { evaluateEpochAcceptance } from '../src/internal/rtc-signaler/signaling/epoch-state'

describe('rtc-signaler epoch state', () => {
    it('rejects stale epoch values', () => {
        const result = evaluateEpochAcceptance({
            currentEpoch: 5,
            incomingEpochLike: 4,
        })
        expect(result).toEqual({
            accepted: false,
            nextEpoch: 5,
            advanced: false,
        })
    })

    it('keeps current epoch on equal value', () => {
        const result = evaluateEpochAcceptance({
            currentEpoch: 5,
            incomingEpochLike: 5,
        })
        expect(result).toEqual({
            accepted: true,
            nextEpoch: 5,
            advanced: false,
        })
    })

    it('advances epoch on higher incoming value', () => {
        const result = evaluateEpochAcceptance({
            currentEpoch: 5,
            incomingEpochLike: 8,
        })
        expect(result).toEqual({
            accepted: true,
            nextEpoch: 8,
            advanced: true,
        })
    })

    it('treats non-numeric epoch values as current epoch', () => {
        const result = evaluateEpochAcceptance({
            currentEpoch: 5,
            incomingEpochLike: 'broken',
        })
        expect(result).toEqual({
            accepted: true,
            nextEpoch: 5,
            advanced: false,
        })
    })
})
