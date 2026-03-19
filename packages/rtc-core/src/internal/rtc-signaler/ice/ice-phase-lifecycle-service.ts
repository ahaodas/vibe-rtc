import type { ConnectionStrategy, IcePhase } from '../../../connection-strategy'
import {
    hasRecentRemoteProgress,
    STUN_ONLY_CHECKING_GRACE_MS,
    STUN_ONLY_PROGRESS_EXTENSION_MS,
} from '../recovery/recovery-policy'
import { getNextIcePhase, hasIcePhase } from './ice-phase-policy'

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
}

interface IcePhaseLifecycleDeps {
    connectionStrategy: ConnectionStrategy
    role: 'caller' | 'callee'
    turnOnlyIceServers: RTCIceServer[]
    icePhase: IcePhase
    lanFirstTimeoutMs: number
    stunOnlyTimeoutMs: number
    roomId: string | null
    phase: 'idle' | 'closing' | string
    stunWatchdogReconnects: number
    remoteProgressSeq: number
    remoteProgressLastAt: number
    makingOffer: boolean
    answering: boolean
    controlledPeerRebuild: boolean
    pc?: RTCPeerConnection
    dbg: SignalerDebugger
    emitDebug: (lastEvent?: string) => void
    getIcePhasePolicyContext: () => {
        baseRtcConfig: RTCConfiguration
        nativeIceServers: RTCIceServer[]
        stunOnlyIceServers: RTCIceServer[]
        turnOnlyIceServers: RTCIceServer[]
    }
    resetNegotiationStateForPeerRebuild: () => void
    clearConnectingWatchdogTimer: () => void
    cleanupPeerOnly: () => void
    initPeer: () => void
    isCurrentGeneration: (generation: number) => boolean
    isConnectedState: () => boolean
}

// Encapsulates ICE phase transitions and fallback timers (LAN/STUN_ONLY/TURN).
// Deps stay intentionally loose-typed to avoid coupling to RTCSignaler private surface.
export class IcePhaseLifecycleService {
    private lanFirstTimer?: ReturnType<typeof setTimeout>
    private stunOnlyTimer?: ReturnType<typeof setTimeout>

    constructor(private readonly deps: IcePhaseLifecycleDeps) {}

    transitionToIcePhase(nextPhase: IcePhase, reason: string): boolean {
        if (!hasIcePhase(nextPhase, this.deps.getIcePhasePolicyContext())) return false
        if (nextPhase === 'TURN_ENABLED' && this.deps.turnOnlyIceServers.length === 0) {
            this.deps.dbg.p('skip TURN_ENABLED transition: no TURN servers in config')
            this.deps.emitDebug('turn-enabled-skip:no-turn-servers')
            return false
        }
        const prevPhase = this.deps.icePhase
        this.deps.dbg.p(`${prevPhase} -> ${nextPhase} transition (${reason})`)
        this.deps.emitDebug(`phase-transition:${prevPhase}->${nextPhase}:${reason}`)
        this.deps.icePhase = nextPhase
        this.deps.stunWatchdogReconnects = 0
        this.deps.controlledPeerRebuild = true
        try {
            this.deps.makingOffer = false
            this.deps.answering = false
            this.deps.resetNegotiationStateForPeerRebuild()
            this.clearLanFirstTimer()
            this.clearStunOnlyTimer()
            this.deps.clearConnectingWatchdogTimer()
            this.deps.cleanupPeerOnly()
            this.deps.initPeer()
        } finally {
            this.deps.controlledPeerRebuild = false
        }
        this.deps.emitDebug(`phase=${nextPhase}`)
        return true
    }

    transitionToNextIcePhase(reason: string): boolean {
        const nextPhase = getNextIcePhase(this.deps.icePhase, this.deps.getIcePhasePolicyContext())
        if (!nextPhase) {
            if (this.deps.icePhase === 'STUN_ONLY') {
                this.deps.dbg.p('stay on STUN_ONLY: next phase unavailable (no-turn-servers)')
                this.deps.emitDebug('turn-enabled-skip:no-turn-servers')
            }
            return false
        }
        return this.transitionToIcePhase(nextPhase, reason)
    }

    startLanFirstTimer(generation: number) {
        if (this.deps.connectionStrategy !== 'LAN_FIRST') return
        if (this.deps.role !== 'caller') {
            this.deps.emitDebug('phase=LAN-passive')
            return
        }
        this.clearLanFirstTimer()
        this.lanFirstTimer = setTimeout(() => {
            if (!this.deps.isCurrentGeneration(generation)) return
            if (
                !this.deps.roomId ||
                !this.deps.pc ||
                this.deps.phase === 'closing' ||
                this.deps.phase === 'idle'
            ) {
                return
            }
            if (this.deps.icePhase !== 'LAN' || this.deps.isConnectedState()) return
            this.deps.dbg.p(`LAN timeout -> fallback in ${this.deps.lanFirstTimeoutMs}ms`)
            this.transitionToNextIcePhase('timeout')
        }, this.deps.lanFirstTimeoutMs)
        this.deps.emitDebug('phase=LAN')
    }

    clearLanFirstTimer() {
        if (!this.lanFirstTimer) return
        clearTimeout(this.lanFirstTimer)
        this.lanFirstTimer = undefined
    }

    startStunOnlyTimer(
        generation: number,
        delayMs: number = this.deps.stunOnlyTimeoutMs,
        allowCheckingGrace = true,
        allowProgressExtension = true,
    ) {
        if (this.deps.connectionStrategy !== 'LAN_FIRST') return
        if (this.deps.icePhase !== 'STUN_ONLY') return
        if (!hasIcePhase('TURN_ENABLED', this.deps.getIcePhasePolicyContext())) return
        const baselineProgressSeq = this.deps.remoteProgressSeq
        this.clearStunOnlyTimer()
        this.stunOnlyTimer = setTimeout(() => {
            if (!this.deps.isCurrentGeneration(generation)) return
            if (
                !this.deps.roomId ||
                !this.deps.pc ||
                this.deps.phase === 'closing' ||
                this.deps.phase === 'idle'
            ) {
                return
            }
            if (this.deps.icePhase !== 'STUN_ONLY' || this.deps.isConnectedState()) return
            if (
                this.deps.pc.connectionState === 'connected' ||
                this.deps.pc.iceConnectionState === 'connected'
            ) {
                return
            }
            const nowMs = Date.now()
            const remoteProgress = hasRecentRemoteProgress(
                baselineProgressSeq,
                this.deps.remoteProgressSeq,
                this.deps.remoteProgressLastAt,
                nowMs,
            )
            if (allowProgressExtension && remoteProgress) {
                this.deps.dbg.p('STUN-only timeout postponed: signaling/ICE progress observed')
                this.startStunOnlyTimer(generation, STUN_ONLY_PROGRESS_EXTENSION_MS, true, false)
                return
            }
            if (allowCheckingGrace && this.deps.pc.iceConnectionState === 'checking') {
                this.deps.dbg.p('STUN-only timeout grace: ICE is checking')
                this.startStunOnlyTimer(
                    generation,
                    STUN_ONLY_CHECKING_GRACE_MS,
                    false,
                    allowProgressExtension,
                )
                return
            }
            if (!hasIcePhase('TURN_ENABLED', this.deps.getIcePhasePolicyContext())) {
                this.deps.dbg.p('STUN-only timeout: TURN phase skipped (no-turn-servers)')
                this.deps.emitDebug('turn-enabled-skip:no-turn-servers')
                return
            }
            this.deps.dbg.p(`STUN-only timeout -> TURN_ENABLED (delay=${delayMs}ms)`)
            this.transitionToNextIcePhase('stun-timeout')
        }, delayMs)
    }

    clearStunOnlyTimer() {
        if (!this.stunOnlyTimer) return
        clearTimeout(this.stunOnlyTimer)
        this.stunOnlyTimer = undefined
    }
}
