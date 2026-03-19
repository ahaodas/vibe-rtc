import type { IcePhase } from '../../../connection-strategy'
import type { NetRttSnapshot } from '../../../metrics/netRtt'
import { createNetRttService } from '../../../metrics/netRtt'
import { summarizeIceServers } from '../ice/ice-servers'
import { createSessionId } from '../signaling/session-utils'

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
}

interface PeerRuntimeDeps {
    dbg: SignalerDebugger
    pc?: RTCPeerConnection
    sessionId: string | null
    pcGeneration: number
    icePhase: IcePhase
    netRttIntervalMs: number
    netRttService?: {
        stop: () => void
    }
    remoteDescSet: boolean
    pendingIce: RTCIceCandidateInit[]
    dcFast?: RTCDataChannel
    dcReliable?: RTCDataChannel
    peerTransportService: {
        bindPeerStateListeners: (generation: number) => void
        bindRoleDataChannels: () => void
    }
    peerNegotiationService: {
        bindPeerNegotiationHandlers: (generation: number) => void
    }
    pingService: {
        pause: () => void
    }
    emitDebug: (lastEvent?: string) => void
    clearDcRecoveryTimer: () => void
    clearConnectingWatchdogTimer: () => void
    buildRtcConfigForPhase: (phase: IcePhase) => RTCConfiguration
    isCurrentGeneration: (generation: number) => boolean
    updateSelectedPathFromNetRtt: (snapshot: NetRttSnapshot, source: string) => void
    resetSelectedPathDiagnosticsKey: () => void
    startLanFirstTimer: (generation: number) => void
    clearLanFirstTimer: () => void
    clearStunOnlyTimer: () => void
}

// Encapsulates RTCPeerConnection runtime lifecycle: creation/rebuild and cleanup.
// Deps stays intentionally loose-typed to avoid coupling to RTCSignaler private surface.
export class PeerRuntimeService {
    constructor(private readonly deps: PeerRuntimeDeps) {}

    initPeer(nextSessionId?: string) {
        this.deps.dbg.p('initPeer()')
        this.deps.clearDcRecoveryTimer()
        this.deps.clearConnectingWatchdogTimer()
        this.deps.netRttService?.stop()
        this.deps.netRttService = undefined
        const generation = ++this.deps.pcGeneration
        this.deps.sessionId = nextSessionId ?? this.deps.sessionId ?? createSessionId()
        this.deps.resetSelectedPathDiagnosticsKey()
        const rtcConfig = this.deps.buildRtcConfigForPhase(this.deps.icePhase)
        const iceSummary = summarizeIceServers(rtcConfig.iceServers ?? [])
        this.deps.pc = new RTCPeerConnection(rtcConfig)
        this.deps.netRttService = createNetRttService({
            peerConnection: this.deps.pc,
            intervalMs: this.deps.netRttIntervalMs,
            onUpdate: (snapshot) => {
                if (!this.deps.isCurrentGeneration(generation)) return
                this.deps.updateSelectedPathFromNetRtt(snapshot, 'net-rtt:update')
                this.deps.emitDebug()
            },
        })
        this.deps.dbg.p('pc-config', {
            gen: generation,
            sessionId: this.deps.sessionId,
            phase: this.deps.icePhase,
            iceTransportPolicy: rtcConfig.iceTransportPolicy ?? 'all',
            stunCount: iceSummary.stunCount,
            turnCount: iceSummary.turnCount,
            urlsSample: iceSummary.urlsSample,
        })

        this.deps.remoteDescSet = false
        this.deps.pendingIce.length = 0
        this.deps.emitDebug('pc-created')
        if (this.deps.icePhase === 'LAN') this.deps.startLanFirstTimer(generation)
        else this.deps.clearLanFirstTimer()
        this.deps.clearStunOnlyTimer()

        this.deps.peerTransportService.bindPeerStateListeners(generation)
        this.deps.peerTransportService.bindRoleDataChannels()
        this.deps.peerNegotiationService.bindPeerNegotiationHandlers(generation)
    }

    cleanupPeerOnly() {
        this.deps.dbg.p('cleanupPeerOnly')
        const hadPc = !!this.deps.pc
        if (hadPc) this.deps.pcGeneration += 1
        this.deps.clearLanFirstTimer()
        this.deps.clearStunOnlyTimer()
        this.deps.clearDcRecoveryTimer()
        this.deps.clearConnectingWatchdogTimer()
        this.deps.pingService.pause()
        this.deps.netRttService?.stop()
        this.deps.netRttService = undefined
        try {
            this.deps.dcFast?.close()
        } catch {}
        try {
            this.deps.dcReliable?.close()
        } catch {}
        this.deps.dcFast = undefined
        this.deps.dcReliable = undefined
        try {
            this.deps.pc?.close()
        } catch {}
        this.deps.pc = undefined
        this.deps.emitDebug('cleanupPeerOnly')
    }
}
