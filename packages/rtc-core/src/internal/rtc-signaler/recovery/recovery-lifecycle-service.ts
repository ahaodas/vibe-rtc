import type { IcePhase } from '../../../connection-strategy'
import { RTCError, RTCErrorCode, type RTCError as RTCErrorShape } from '../../../errors'
import {
    canRunWatchdogHardReconnect,
    getConnectingWatchdogTimeoutMs,
    nextTurnWatchdogReconnectCount,
} from './recovery-policy'
import { applyHardRetry, applySoftRetry } from './recovery-state'

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
    pe: (message: string, error: unknown) => void
}

interface RecoveryLifecycleDeps {
    pc?: RTCPeerConnection
    roomId: string | null
    role: 'caller' | 'callee'
    phase: 'idle' | 'closing' | string
    defaultWaitReadyTimeoutMs: number
    icePhase: IcePhase
    stunWatchdogReconnects: number
    makingOffer: boolean
    dcFast?: RTCDataChannel
    dcReliable?: RTCDataChannel
    recovery: {
        softDelayMs: number
        hardDelayMs: number
        softRetries: number
        hardRetries: number
    }
    dbg: SignalerDebugger
    emitDebug: (lastEvent?: string) => void
    onError: (error: RTCErrorShape) => void
    raiseError: (
        err: unknown,
        fallbackCode: RTCErrorCode,
        phase: 'reconnect',
        retriable: boolean,
        message?: string,
        rethrow?: boolean,
    ) => RTCErrorShape
    reconnectSoft: () => Promise<void>
    reconnectHard: (opts?: { awaitReadyMs?: number }) => Promise<void>
    clearConnectingWatchdogTimer: () => void
    isCurrentGeneration: (generation: number) => boolean
    isConnectedState: () => boolean
    areDataChannelsOpen: () => boolean
}

// Encapsulates recovery timer lifecycle and reconnect escalation policy.
// Deps are intentionally loose-typed to avoid coupling to RTCSignaler internals.
export class RecoveryLifecycleService {
    private softTimer?: ReturnType<typeof setTimeout>
    private hardTimer?: ReturnType<typeof setTimeout>
    private dcRecoveryTimer?: ReturnType<typeof setTimeout>
    private dcRecoveryGeneration?: number
    private connectingWatchdogTimer?: ReturnType<typeof setTimeout>
    private connectingWatchdogGeneration?: number

    constructor(private readonly deps: RecoveryLifecycleDeps) {}

    isActive() {
        return !!this.deps.pc && !!this.deps.roomId
    }

    isSoftTimerPending(): boolean {
        return !!this.softTimer
    }

    isHardTimerPending(): boolean {
        return !!this.hardTimer
    }

    clearDcRecoveryTimer() {
        if (!this.dcRecoveryTimer) return
        clearTimeout(this.dcRecoveryTimer)
        this.dcRecoveryTimer = undefined
        this.dcRecoveryGeneration = undefined
    }

    clearConnectingWatchdogTimer() {
        if (!this.connectingWatchdogTimer) return
        clearTimeout(this.connectingWatchdogTimer)
        this.connectingWatchdogTimer = undefined
        this.connectingWatchdogGeneration = undefined
    }

    clearRecoveryTimers() {
        if (this.softTimer) {
            clearTimeout(this.softTimer)
            this.softTimer = undefined
        }
        if (this.hardTimer) {
            clearTimeout(this.hardTimer)
            this.hardTimer = undefined
        }
        this.deps.emitDebug('clearTimers')
    }

    scheduleSoftThenMaybeHard() {
        if (!this.deps.roomId || this.deps.phase === 'closing' || this.deps.phase === 'idle') return
        if (!this.deps.pc || this.deps.pc.signalingState === 'closed') return
        this.deps.clearConnectingWatchdogTimer()
        this.clearRecoveryTimers()
        this.upkeepRecoveryBackoff()
        this.deps.phase = 'soft-reconnect'
        const softIn = this.deps.recovery.softDelayMs
        const hardIn = this.deps.recovery.hardDelayMs

        this.softTimer = setTimeout(() => {
            this.deps.reconnectSoft().catch(() => {})
            this.deps.recovery = applySoftRetry(this.deps.recovery)
            this.deps.emitDebug('soft-reconnect fire')
        }, softIn)

        this.hardTimer = setTimeout(() => {
            this.tryHardNow().catch(() => {})
            this.deps.recovery = applyHardRetry(this.deps.recovery)
            this.deps.emitDebug('hard-reconnect fire')
        }, hardIn)

        this.deps.emitDebug('schedule reconnects')
    }

    upkeepRecoveryBackoff() {
        // Fine-tune backoff/reset strategy here for specific events.
    }

    async tryHardNow() {
        if (!this.deps.roomId || this.deps.phase === 'closing' || this.deps.phase === 'idle') return
        this.clearRecoveryTimers()
        try {
            await this.deps.reconnectHard({ awaitReadyMs: this.deps.defaultWaitReadyTimeoutMs })
        } catch (e) {
            if (
                e instanceof RTCError &&
                e.code === RTCErrorCode.WAIT_READY_TIMEOUT &&
                e.phase === 'transport'
            ) {
                return
            }
            this.deps.dbg.pe('tryHardNow failed', e)
            this.deps.onError(
                this.deps.raiseError(
                    e,
                    RTCErrorCode.SIGNALING_FAILED,
                    'reconnect',
                    true,
                    undefined,
                    false,
                ),
            )
        }
    }

    scheduleCallerConnectingWatchdog(generation: number, reason: string) {
        if (this.deps.role !== 'caller') return
        if (
            !this.deps.roomId ||
            !this.deps.pc ||
            this.deps.phase === 'closing' ||
            this.deps.phase === 'idle'
        )
            return
        if (!this.deps.isCurrentGeneration(generation)) return
        if (this.deps.isConnectedState() || this.deps.areDataChannelsOpen()) {
            this.clearConnectingWatchdogTimer()
            return
        }
        if (this.connectingWatchdogGeneration === generation) return
        this.clearConnectingWatchdogTimer()
        this.connectingWatchdogGeneration = generation
        const watchdogTimeoutMs = getConnectingWatchdogTimeoutMs(this.deps.icePhase)
        this.connectingWatchdogTimer = setTimeout(() => {
            void (async () => {
                this.connectingWatchdogTimer = undefined
                if (
                    !this.deps.roomId ||
                    !this.deps.pc ||
                    this.deps.phase === 'closing' ||
                    this.deps.phase === 'idle'
                )
                    return
                if (!this.deps.isCurrentGeneration(generation)) return
                if (this.deps.isConnectedState() || this.deps.areDataChannelsOpen()) return
                if (
                    !canRunWatchdogHardReconnect(
                        this.deps.icePhase,
                        this.deps.stunWatchdogReconnects,
                    )
                ) {
                    return
                }
                this.deps.stunWatchdogReconnects = nextTurnWatchdogReconnectCount(
                    this.deps.icePhase,
                    this.deps.stunWatchdogReconnects,
                )
                this.deps.dbg.p(`connecting watchdog -> reconnectHard (${reason})`)
                this.deps.emitDebug('connecting-watchdog:hard-reconnect')
                try {
                    await this.deps.reconnectHard({
                        awaitReadyMs: this.deps.defaultWaitReadyTimeoutMs,
                    })
                } catch (e) {
                    this.deps.dbg.pe('connecting watchdog failed', e)
                } finally {
                    if (this.connectingWatchdogGeneration === generation) {
                        this.connectingWatchdogGeneration = undefined
                    }
                }
            })()
        }, watchdogTimeoutMs)
    }

    scheduleCallerDcRecovery(generation: number, reason: string) {
        if (this.deps.role !== 'caller') return
        if (
            !this.deps.roomId ||
            !this.deps.pc ||
            this.deps.phase === 'closing' ||
            this.deps.phase === 'idle'
        )
            return
        if (!this.deps.isCurrentGeneration(generation)) return
        if (this.deps.areDataChannelsOpen()) {
            this.clearDcRecoveryTimer()
            return
        }
        if (this.dcRecoveryGeneration === generation) return
        this.clearDcRecoveryTimer()
        this.dcRecoveryGeneration = generation
        this.dcRecoveryTimer = setTimeout(() => {
            void (async () => {
                this.dcRecoveryTimer = undefined
                if (
                    !this.deps.roomId ||
                    !this.deps.pc ||
                    this.deps.phase === 'closing' ||
                    this.deps.phase === 'idle'
                )
                    return
                if (!this.deps.isCurrentGeneration(generation)) return
                if (this.deps.areDataChannelsOpen()) return
                if (this.deps.makingOffer || this.deps.pc.signalingState !== 'stable') {
                    this.deps.dbg.p('dc recovery skipped (makingOffer or !stable)')
                    this.deps.emitDebug('dc-recovery-skip')
                    return
                }
                const hasMissingOrClosedChannels =
                    !this.deps.dcFast ||
                    !this.deps.dcReliable ||
                    this.deps.dcFast.readyState === 'closed' ||
                    this.deps.dcReliable.readyState === 'closed'
                if (hasMissingOrClosedChannels) {
                    this.deps.dbg.p(`dc recovery -> reconnectHard (${reason})`)
                    this.deps.emitDebug('dc-recovery:hard-reconnect')
                    await this.tryHardNow()
                    return
                }
                this.deps.dbg.p(`dc recovery -> reconnectSoft (${reason})`)
                this.deps.emitDebug('dc-recovery:ice-restart')
                try {
                    await this.deps.reconnectSoft()
                } catch (e) {
                    this.deps.dbg.pe('dc recovery failed', e)
                }
            })()
        }, 1200)
    }
}
