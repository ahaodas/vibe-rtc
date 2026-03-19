import { describe, expect, it } from 'vitest'
import { resolveTransportEventPolicy } from '../src/internal/rtc-signaler/connection/transport-event-policy'

describe('rtc-signaler transport event policy', () => {
    it('marks connected on ice connected', () => {
        const decision = resolveTransportEventPolicy({
            connectionStrategy: 'LAN_FIRST',
            role: 'caller',
            icePhase: 'LAN',
            hasTurnEnabledPhase: true,
            kind: 'ice',
            state: 'connected',
        })
        expect(decision.markConnected).toBe(true)
        expect(decision.markCompleted).toBe(false)
    })

    it('marks completed on ice completed', () => {
        const decision = resolveTransportEventPolicy({
            connectionStrategy: 'LAN_FIRST',
            role: 'caller',
            icePhase: 'LAN',
            hasTurnEnabledPhase: true,
            kind: 'ice',
            state: 'completed',
        })
        expect(decision.markConnected).toBe(false)
        expect(decision.markCompleted).toBe(true)
    })

    it('schedules watchdog on checking/connecting', () => {
        const checking = resolveTransportEventPolicy({
            connectionStrategy: 'LAN_FIRST',
            role: 'caller',
            icePhase: 'LAN',
            hasTurnEnabledPhase: true,
            kind: 'ice',
            state: 'checking',
        })
        const connecting = resolveTransportEventPolicy({
            connectionStrategy: 'LAN_FIRST',
            role: 'caller',
            icePhase: 'LAN',
            hasTurnEnabledPhase: true,
            kind: 'connection',
            state: 'connecting',
        })
        expect(checking.scheduleConnectingWatchdog).toBe(true)
        expect(connecting.scheduleConnectingWatchdog).toBe(true)
    })

    it('requests STUN_ONLY failed transition for LAN-first caller', () => {
        const decision = resolveTransportEventPolicy({
            connectionStrategy: 'LAN_FIRST',
            role: 'caller',
            icePhase: 'STUN_ONLY',
            hasTurnEnabledPhase: true,
            kind: 'connection',
            state: 'failed',
        })
        expect(decision.transitionToNextIcePhase).toBe(true)
    })

    it('requests STUN-only disconnected grace timer when TURN phase exists', () => {
        const decision = resolveTransportEventPolicy({
            connectionStrategy: 'LAN_FIRST',
            role: 'caller',
            icePhase: 'STUN_ONLY',
            hasTurnEnabledPhase: true,
            kind: 'ice',
            state: 'disconnected',
        })
        expect(decision.startStunOnlyDisconnectGraceTimer).toBe(true)
    })

    it('requests reconnect actions for caller on disconnected/failed/closed', () => {
        const disconnected = resolveTransportEventPolicy({
            connectionStrategy: 'BROWSER_NATIVE',
            role: 'caller',
            icePhase: 'STUN',
            hasTurnEnabledPhase: false,
            kind: 'connection',
            state: 'disconnected',
        })
        const failed = resolveTransportEventPolicy({
            connectionStrategy: 'BROWSER_NATIVE',
            role: 'caller',
            icePhase: 'STUN',
            hasTurnEnabledPhase: false,
            kind: 'connection',
            state: 'failed',
        })
        const closed = resolveTransportEventPolicy({
            connectionStrategy: 'BROWSER_NATIVE',
            role: 'caller',
            icePhase: 'STUN',
            hasTurnEnabledPhase: false,
            kind: 'connection',
            state: 'closed',
        })
        expect(disconnected.scheduleSoftReconnect).toBe(true)
        expect(disconnected.triggerHardReconnect).toBe(false)
        expect(failed.triggerHardReconnect).toBe(true)
        expect(closed.triggerHardReconnect).toBe(true)
    })
})
