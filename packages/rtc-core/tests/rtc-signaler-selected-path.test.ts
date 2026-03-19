import { describe, expect, it } from 'vitest'
import { resolveSelectedPathResolution } from '../src/internal/rtc-signaler/metrics/selected-path'

describe('rtc-signaler selected path resolution', () => {
    it('marks path as unknown and emits debug event when route is missing', () => {
        const result = resolveSelectedPathResolution({
            currentPath: 'relay',
            currentDiagnosticsKey: null,
            snapshot: {
                selectedPair: null,
                route: null,
            },
            generation: 3,
        })

        expect(result.nextPath).toBe('unknown')
        expect(result.nextDiagnosticsKey).toBe('3:selected ICE candidate pair is not available yet')
        expect(result.emitDebugEvent).toBe('selected-path:unknown')
        expect(result.unavailableLog?.changed).toBe(true)
    })

    it('does not re-log unavailable diagnostics if key is unchanged', () => {
        const diagnosticsKey = '4:pair pending'
        const result = resolveSelectedPathResolution({
            currentPath: 'unknown',
            currentDiagnosticsKey: diagnosticsKey,
            snapshot: {
                selectedPair: null,
                route: null,
                pathReason: 'pair pending',
            },
            generation: 4,
        })

        expect(result.nextPath).toBe('unknown')
        expect(result.nextDiagnosticsKey).toBe(diagnosticsKey)
        expect(result.emitDebugEvent).toBeUndefined()
        expect(result.unavailableLog?.changed).toBe(false)
    })

    it('emits resolved payload when selected path changes', () => {
        const result = resolveSelectedPathResolution({
            currentPath: 'unknown',
            currentDiagnosticsKey: '5:pair pending',
            snapshot: {
                selectedPair: { id: 'pair-1', nominated: true },
                route: {
                    pairId: 'pair-1',
                    localCandidateType: 'relay',
                    remoteCandidateType: 'host',
                    isRelay: true,
                    nominated: true,
                },
                pathSelectionMethod: 'getStats',
            },
            generation: 5,
        })

        expect(result.nextPath).toBe('relay')
        expect(result.nextDiagnosticsKey).toBeNull()
        expect(result.emitDebugEvent).toBe('selected-path:relay')
        expect(result.resolvedLog).toEqual({
            path: 'relay',
            localType: 'relay',
            remoteType: 'host',
            pairId: 'pair-1',
            nominated: true,
            selectionMethod: 'getStats',
        })
    })

    it('returns no event when selected path is unchanged', () => {
        const result = resolveSelectedPathResolution({
            currentPath: 'host',
            currentDiagnosticsKey: null,
            snapshot: {
                selectedPair: null,
                route: {
                    localCandidateType: 'host',
                    remoteCandidateType: 'host',
                    isRelay: false,
                },
            },
            generation: 8,
        })

        expect(result.nextPath).toBe('host')
        expect(result.nextDiagnosticsKey).toBeNull()
        expect(result.emitDebugEvent).toBeUndefined()
        expect(result.resolvedLog).toBeUndefined()
        expect(result.unavailableLog).toBeUndefined()
    })
})
