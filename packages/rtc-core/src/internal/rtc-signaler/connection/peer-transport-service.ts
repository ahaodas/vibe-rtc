import type { ConnectionStrategy, IcePhase } from '../../../connection-strategy'
import { hasIcePhase } from '../ice/ice-phase-policy'
import { STUN_ONLY_CHECKING_GRACE_MS } from '../recovery/recovery-policy'
import { resetRecoveryBackoffState } from '../recovery/recovery-state'
import { resolveChannelClosePolicy } from './channel-close-policy'
import {
    createChannelReadyPromise,
    flushChannelQueue,
    resolveChannelWaiters as resolveReadyChannelWaiters,
} from './channel-io'
import { resolveTransportEventExecutionPlan } from './transport-event-execution'
import { resolveTransportEventPolicy } from './transport-event-policy'

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
}

type PingServiceLike = {
    handleIncoming: (text: string) => boolean
}

type RecoveryStateLike = {
    softDelayMs: number
    hardDelayMs: number
    softRetries: number
    hardRetries: number
}

interface PeerTransportDeps {
    pc?: RTCPeerConnection
    role: 'caller' | 'callee'
    connectionStrategy: ConnectionStrategy
    icePhase: IcePhase
    roomId: string | null
    phase: string
    controlledPeerRebuild: boolean
    fastLabel: string
    reliableLabel: string
    fastInit: RTCDataChannelInit
    reliableInit: RTCDataChannelInit
    fastBALow: number
    reliableBALow: number
    fastQueue: string[]
    reliableQueue: string[]
    fastOpenWaiters: Array<(ch: RTCDataChannel) => void>
    reliableOpenWaiters: Array<(ch: RTCDataChannel) => void>
    dcFast?: RTCDataChannel
    dcReliable?: RTCDataChannel
    pcGeneration: number
    recovery: RecoveryStateLike
    stunWatchdogReconnects: number
    pingService: PingServiceLike
    dbg: SignalerDebugger
    onConnectionStateChange: (state: RTCPeerConnectionState) => void
    onReliableOpen: () => void
    onFastOpen: () => void
    onReliableClose: () => void
    onFastClose: () => void
    onMessage: (text: string, meta: { reliable: boolean }) => void
    emitDebug: (lastEvent?: string) => void
    syncNetRttLifecycle: () => void
    syncPingLifecycle: () => void
    clearRecoveryTimers: () => void
    clearLanFirstTimer: () => void
    clearStunOnlyTimer: () => void
    startStunOnlyTimer: (
        generation: number,
        delayMs?: number,
        allowCheckingGrace?: boolean,
        allowProgressExtension?: boolean,
    ) => void
    captureSelectedPath: (source: string) => void
    scheduleCallerDcRecovery: (generation: number, reason: string) => void
    clearConnectingWatchdogTimer: () => void
    scheduleCallerConnectingWatchdog: (generation: number, reason: string) => void
    transitionToNextIcePhase: (reason: string) => boolean
    scheduleSoftThenMaybeHard: () => void
    tryHardNow: () => Promise<void>
    clearDcRecoveryTimer: () => void
    areDataChannelsOpen: () => boolean
    isCurrentGeneration: (generation: number) => boolean
    isActive: () => boolean
    getIcePhasePolicyContext: () => {
        baseRtcConfig: RTCConfiguration
        nativeIceServers: RTCIceServer[]
        stunOnlyIceServers: RTCIceServer[]
        turnOnlyIceServers: RTCIceServer[]
    }
}

// Handles peer transport listeners, channel lifecycle, and transport state transitions.
// Deps stays intentionally loose-typed to avoid coupling to RTCSignaler private surface.
export class PeerTransportService {
    constructor(private readonly deps: PeerTransportDeps) {}

    bindPeerStateListeners(generation: number) {
        this.deps.pc?.addEventListener('signalingstatechange', () => {
            if (!this.deps.isCurrentGeneration(generation)) return
            this.deps.dbg.p('signalingstatechange')
            this.deps.emitDebug('signalingstatechange')
        })

        this.deps.pc?.addEventListener('iceconnectionstatechange', () => {
            if (!this.deps.isCurrentGeneration(generation)) return
            const state = this.deps.pc?.iceConnectionState
            this.deps.dbg.p(`ice=${state}`)
            this.deps.emitDebug(`ice=${state}`)
            this.deps.syncNetRttLifecycle()
            this.handleTransportStateChange(generation, 'ice', state)
        })

        this.deps.pc?.addEventListener('connectionstatechange', () => {
            if (!this.deps.isCurrentGeneration(generation)) return
            const pc = this.deps.pc
            if (!pc) return
            const state = pc.connectionState
            this.deps.dbg.p(`connection=${state}`)
            this.deps.onConnectionStateChange(state)
            this.deps.emitDebug(`connection=${state}`)
            this.deps.syncNetRttLifecycle()
            this.handleTransportStateChange(generation, 'connection', state)
        })
    }

    handleTransportStateChange(
        generation: number,
        kind: 'ice' | 'connection',
        state: string | undefined,
    ) {
        if (!this.deps.roomId) return

        const decision = resolveTransportEventPolicy({
            connectionStrategy: this.deps.connectionStrategy,
            role: this.deps.role,
            icePhase: this.deps.icePhase,
            hasTurnEnabledPhase: hasIcePhase('TURN_ENABLED', this.deps.getIcePhasePolicyContext()),
            kind,
            state,
        })
        const executionPlan = resolveTransportEventExecutionPlan({ kind, state, decision })

        if (decision.markConnected) this.handleTransportConnected(generation, kind)
        if (decision.markCompleted) this.handleIceCompleted(generation)
        if (executionPlan.connectingWatchdogReason) {
            this.deps.scheduleCallerConnectingWatchdog(
                generation,
                executionPlan.connectingWatchdogReason,
            )
        }
        if (executionPlan.transitionReason) {
            const transitioned = this.deps.transitionToNextIcePhase(executionPlan.transitionReason)
            if (transitioned) return
        }
        if (executionPlan.stunDisconnectMessage) {
            this.deps.dbg.p(executionPlan.stunDisconnectMessage)
            this.deps.startStunOnlyTimer(generation, STUN_ONLY_CHECKING_GRACE_MS, true)
            return
        }
        if (this.deps.controlledPeerRebuild) return
        if (decision.scheduleSoftReconnect) this.deps.scheduleSoftThenMaybeHard()
        if (decision.triggerHardReconnect) this.deps.tryHardNow()
    }

    bindRoleDataChannels() {
        const pc = this.deps.pc
        if (!pc) return

        if (this.deps.role === 'caller') {
            this.deps.dcFast = pc.createDataChannel(this.deps.fastLabel, this.deps.fastInit)
            this.setupChannel(this.deps.dcFast, false)

            this.deps.dcReliable = pc.createDataChannel(
                this.deps.reliableLabel,
                this.deps.reliableInit,
            )
            this.setupChannel(this.deps.dcReliable, true)
            return
        }

        pc.ondatachannel = (ev: RTCDataChannelEvent) => {
            this.handleIncomingDataChannel(ev.channel)
        }
    }

    handleIncomingDataChannel(channel: RTCDataChannel) {
        const reliable = channel.label === this.deps.reliableLabel
        if (reliable) this.deps.dcReliable = channel
        else this.deps.dcFast = channel

        this.setupChannel(channel, reliable)
        if (channel.readyState !== 'open') return

        this.resolveChannelWaiters(channel, reliable)
        if (reliable) flushChannelQueue(channel, this.deps.reliableQueue)
        else flushChannelQueue(channel, this.deps.fastQueue)
        this.deps.syncNetRttLifecycle()
        this.deps.emitDebug('dc-early-open')
    }

    handleTransportConnected(generation: number, source: 'ice' | 'connection') {
        this.deps.phase = 'connected'
        this.deps.recovery = resetRecoveryBackoffState()
        this.deps.stunWatchdogReconnects = 0
        this.deps.clearRecoveryTimers()
        this.deps.clearLanFirstTimer()
        this.deps.clearStunOnlyTimer()
        this.deps.captureSelectedPath(`${source}=connected`)
        this.deps.scheduleCallerDcRecovery(generation, `${source}=connected`)
        this.deps.clearConnectingWatchdogTimer()
        this.deps.emitDebug('connected')
    }

    handleIceCompleted(generation: number) {
        this.deps.clearLanFirstTimer()
        this.deps.clearStunOnlyTimer()
        this.deps.captureSelectedPath('ice=completed')
        this.deps.scheduleCallerDcRecovery(generation, 'ice=completed')
        this.deps.clearConnectingWatchdogTimer()
        this.deps.emitDebug('ice=completed')
    }

    setupChannel(ch: RTCDataChannel, reliable: boolean) {
        const ownerPc = this.deps.pc
        try {
            ch.bufferedAmountLowThreshold = reliable ? this.deps.reliableBALow : this.deps.fastBALow
        } catch {}
        ch.onopen = () => {
            if (reliable) {
                flushChannelQueue(ch, this.deps.reliableQueue)
                this.deps.onReliableOpen()
            } else {
                flushChannelQueue(ch, this.deps.fastQueue)
                this.deps.onFastOpen()
            }
            this.resolveChannelWaiters(ch, reliable)
            if (this.deps.areDataChannelsOpen()) {
                this.deps.clearDcRecoveryTimer()
            }
            this.deps.syncPingLifecycle()
            this.deps.syncNetRttLifecycle()
            this.deps.emitDebug(`dc-open:${ch.label}`)
        }
        ch.onclose = () => {
            this.deps.dbg.p(`onclose (${ch.label})`)

            const closePolicy = resolveChannelClosePolicy({
                ownerIsCurrent: !!ownerPc && this.deps.pc === ownerPc,
                isActive: this.deps.isActive(),
                role: this.deps.role,
                iceConnectionState: this.deps.pc?.iceConnectionState,
                connectionState: this.deps.pc?.connectionState,
            })

            // Ignore close events from stale channels after RTCPeerConnection replacement.
            if (closePolicy.ignoreAsStale) {
                this.deps.emitDebug(`dc-close-stale:${ch.label}`)
                return
            }
            if (ch.label === this.deps.fastLabel) this.deps.dcFast = undefined
            if (ch.label === this.deps.reliableLabel) this.deps.dcReliable = undefined

            if (closePolicy.shouldScheduleSoftReconnect) this.deps.scheduleSoftThenMaybeHard()
            if (closePolicy.shouldScheduleDcRecovery)
                this.deps.scheduleCallerDcRecovery(this.deps.pcGeneration, `dc-close:${ch.label}`)
            if (reliable) this.deps.onReliableClose()
            else this.deps.onFastClose()
            this.deps.syncPingLifecycle()
            this.deps.syncNetRttLifecycle()
            this.deps.emitDebug(`dc-close:${ch.label}`)
        }
        ch.onmessage = (ev) => {
            const text = typeof ev.data === 'string' ? ev.data : String(ev.data)
            if (this.deps.pingService.handleIncoming(text)) return
            this.deps.onMessage(text, { reliable })
        }
    }

    waitChannelReady(reliable: boolean): Promise<RTCDataChannel> {
        const existing = reliable ? this.deps.dcReliable : this.deps.dcFast
        if (existing && existing.readyState === 'open') return Promise.resolve(existing)
        const waiters = reliable ? this.deps.reliableOpenWaiters : this.deps.fastOpenWaiters
        this.deps.emitDebug('waitChannelReady')
        return createChannelReadyPromise(waiters)
    }

    resolveChannelWaiters(ch: RTCDataChannel, reliable: boolean) {
        const waiters = reliable ? this.deps.reliableOpenWaiters : this.deps.fastOpenWaiters
        resolveReadyChannelWaiters(waiters, ch)
    }
}
