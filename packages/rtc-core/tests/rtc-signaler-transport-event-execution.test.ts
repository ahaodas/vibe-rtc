import { describe, expect, it } from 'vitest'
import { resolveTransportEventExecutionPlan } from '../src/internal/rtc-signaler/connection/transport-event-execution'

describe('rtc-signaler transport event execution plan', () => {
    it('resolves reasons for ICE checking + failed transition', () => {
        const plan = resolveTransportEventExecutionPlan({
            kind: 'ice',
            state: 'failed',
            decision: {
                markConnected: false,
                markCompleted: false,
                scheduleConnectingWatchdog: true,
                transitionToNextIcePhase: true,
                startStunOnlyDisconnectGraceTimer: false,
                scheduleSoftReconnect: false,
                triggerHardReconnect: false,
            },
        })

        expect(plan.connectingWatchdogReason).toBe('ice=checking')
        expect(plan.transitionReason).toBe('stun-failed')
        expect(plan.stunDisconnectMessage).toBeUndefined()
    })

    it('resolves connection-specific reasons', () => {
        const plan = resolveTransportEventExecutionPlan({
            kind: 'connection',
            state: 'disconnected',
            decision: {
                markConnected: false,
                markCompleted: false,
                scheduleConnectingWatchdog: true,
                transitionToNextIcePhase: false,
                startStunOnlyDisconnectGraceTimer: true,
                scheduleSoftReconnect: true,
                triggerHardReconnect: false,
            },
        })

        expect(plan.connectingWatchdogReason).toBe('connection=connecting')
        expect(plan.transitionReason).toBeUndefined()
        expect(plan.stunDisconnectMessage).toBe(
            'STUN-only disconnected(connection): wait before TURN_ENABLED transition',
        )
    })

    it('returns empty plan when no action fields are active', () => {
        const plan = resolveTransportEventExecutionPlan({
            kind: 'ice',
            state: 'connected',
            decision: {
                markConnected: true,
                markCompleted: false,
                scheduleConnectingWatchdog: false,
                transitionToNextIcePhase: false,
                startStunOnlyDisconnectGraceTimer: false,
                scheduleSoftReconnect: false,
                triggerHardReconnect: false,
            },
        })

        expect(plan.connectingWatchdogReason).toBeUndefined()
        expect(plan.transitionReason).toBeUndefined()
        expect(plan.stunDisconnectMessage).toBeUndefined()
    })
})
