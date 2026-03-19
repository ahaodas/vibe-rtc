import type { CandidateType } from '../../../connection-strategy'
import type { NetRttSnapshot } from '../../../metrics/netRtt'
import { resolveSelectedPathResolution } from './selected-path'

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
}

type NetRttServiceLike = {
    getSnapshot: () => NetRttSnapshot
    refresh: () => Promise<void>
}

export interface SelectedPathServiceDeps {
    getPcGeneration: () => number
    getNetRttService: () => NetRttServiceLike | undefined
    dbg: SignalerDebugger
    emitDebug: (lastEvent?: string) => void
}

// Encapsulates selected ICE path diagnostics and net-rtt-driven updates.
export class SelectedPathService {
    private selectedPath: CandidateType | undefined
    private selectedPathDiagnosticsKey: string | null = null

    constructor(private readonly deps: SelectedPathServiceDeps) {}

    getSelectedPath(): CandidateType | undefined {
        return this.selectedPath
    }

    resetSelection() {
        this.selectedPath = undefined
        this.selectedPathDiagnosticsKey = null
    }

    resetDiagnosticsKey() {
        this.selectedPathDiagnosticsKey = null
    }

    updateSelectedPathFromNetRtt(snapshot: NetRttSnapshot, source: string) {
        const resolution = resolveSelectedPathResolution({
            currentPath: this.selectedPath,
            currentDiagnosticsKey: this.selectedPathDiagnosticsKey,
            snapshot,
            generation: this.deps.getPcGeneration(),
        })

        this.selectedPath = resolution.nextPath
        this.selectedPathDiagnosticsKey = resolution.nextDiagnosticsKey

        if (resolution.unavailableLog?.changed) {
            this.deps.dbg.p('selected path unavailable', {
                source,
                reason: resolution.unavailableLog.reason,
                selectionMethod: resolution.unavailableLog.selectionMethod,
            })
        }
        if (resolution.resolvedLog) {
            this.deps.dbg.p('selected path resolved from getStats()', {
                source,
                path: resolution.resolvedLog.path,
                localType: resolution.resolvedLog.localType,
                remoteType: resolution.resolvedLog.remoteType,
                pairId: resolution.resolvedLog.pairId,
                nominated: resolution.resolvedLog.nominated,
                selectionMethod: resolution.resolvedLog.selectionMethod,
            })
        }
        if (resolution.emitDebugEvent) this.deps.emitDebug(resolution.emitDebugEvent)
    }

    captureSelectedPath(source: string) {
        const netRtt = this.deps.getNetRttService()
        if (!netRtt) return
        this.updateSelectedPathFromNetRtt(netRtt.getSnapshot(), `${source}:snapshot`)
        void netRtt.refresh().catch(() => {
            this.deps.dbg.p('selected path refresh failed', { source })
        })
    }
}
