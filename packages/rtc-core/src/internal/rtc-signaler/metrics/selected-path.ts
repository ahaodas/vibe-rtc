import type { CandidateType } from '../../../connection-strategy'
import type { NetRttSnapshot } from '../../../metrics/netRtt'
import { mapSelectedPathFromRoute } from './candidate-stats'

export interface SelectedPathResolutionInput {
    currentPath: CandidateType | undefined
    currentDiagnosticsKey: string | null
    snapshot: NetRttSnapshot
    generation: number
}

export interface SelectedPathUnavailableLog {
    reason: string
    selectionMethod: string
    changed: boolean
}

export interface SelectedPathResolvedLog {
    path: CandidateType
    localType: string
    remoteType: string
    pairId: string | null
    nominated: boolean
    selectionMethod: string
}

export interface SelectedPathResolution {
    nextPath: CandidateType | undefined
    nextDiagnosticsKey: string | null
    emitDebugEvent?: string
    unavailableLog?: SelectedPathUnavailableLog
    resolvedLog?: SelectedPathResolvedLog
}

const UNAVAILABLE_REASON = 'selected ICE candidate pair is not available yet'

export const resolveSelectedPathResolution = (
    input: SelectedPathResolutionInput,
): SelectedPathResolution => {
    const nextPath = mapSelectedPathFromRoute(input.snapshot.route)
    const diagnosticsReason = input.snapshot.pathReason ?? UNAVAILABLE_REASON
    const selectionMethod = input.snapshot.pathSelectionMethod ?? 'unknown'

    if (!nextPath || nextPath === 'unknown') {
        const nextDiagnosticsKey = `${input.generation}:${diagnosticsReason}`
        const diagnosticsChanged = input.currentDiagnosticsKey !== nextDiagnosticsKey

        const emitDebugEvent = input.currentPath !== 'unknown' ? 'selected-path:unknown' : undefined

        return {
            nextPath: 'unknown',
            nextDiagnosticsKey,
            emitDebugEvent,
            unavailableLog: {
                reason: diagnosticsReason,
                selectionMethod,
                changed: diagnosticsChanged,
            },
        }
    }

    if (input.currentPath === nextPath) {
        return {
            nextPath,
            nextDiagnosticsKey: null,
        }
    }

    return {
        nextPath,
        nextDiagnosticsKey: null,
        emitDebugEvent: `selected-path:${nextPath}`,
        resolvedLog: {
            path: nextPath,
            localType: input.snapshot.route?.localCandidateType ?? 'unknown',
            remoteType: input.snapshot.route?.remoteCandidateType ?? 'unknown',
            pairId: input.snapshot.route?.pairId ?? input.snapshot.selectedPair?.id ?? null,
            nominated:
                input.snapshot.route?.nominated ?? input.snapshot.selectedPair?.nominated ?? false,
            selectionMethod,
        },
    }
}
