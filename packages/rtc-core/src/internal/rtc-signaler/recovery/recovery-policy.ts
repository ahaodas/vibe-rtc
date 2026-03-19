import type { IcePhase } from '../../../connection-strategy'

export const CONNECTING_WATCHDOG_MS_LAN = 6500
export const CONNECTING_WATCHDOG_MS_PUBLIC = 30_000
export const MAX_STUN_WATCHDOG_RECONNECTS = 2
export const DEFAULT_STUN_ONLY_TIMEOUT_MS = 10_000
export const STUN_ONLY_CHECKING_GRACE_MS = 1800
export const STUN_ONLY_PROGRESS_WINDOW_MS = 2000
export const STUN_ONLY_PROGRESS_EXTENSION_MS = 2000

export const DEFAULT_SOFT_RECONNECT_DELAY_MS = 250
export const DEFAULT_HARD_RECONNECT_DELAY_MS = 6000

export const getConnectingWatchdogTimeoutMs = (phase: IcePhase): number =>
    phase === 'LAN' ? CONNECTING_WATCHDOG_MS_LAN : CONNECTING_WATCHDOG_MS_PUBLIC

export const canRunWatchdogHardReconnect = (
    phase: IcePhase,
    reconnectsInTurnPhase: number,
): boolean => !(phase === 'TURN_ENABLED' && reconnectsInTurnPhase >= MAX_STUN_WATCHDOG_RECONNECTS)

export const nextTurnWatchdogReconnectCount = (
    phase: IcePhase,
    reconnectsInTurnPhase: number,
): number => (phase === 'TURN_ENABLED' ? reconnectsInTurnPhase + 1 : reconnectsInTurnPhase)

export const nextSoftReconnectDelayMs = (currentDelayMs: number): number =>
    Math.min(currentDelayMs * 2, 2500)

export const nextHardReconnectDelayMs = (currentDelayMs: number): number =>
    Math.min(currentDelayMs * 2, 30000)

export const hasRecentRemoteProgress = (
    baselineProgressSeq: number,
    currentProgressSeq: number,
    remoteProgressLastAt: number,
    nowMs: number,
): boolean =>
    currentProgressSeq > baselineProgressSeq &&
    nowMs - remoteProgressLastAt <= STUN_ONLY_PROGRESS_WINDOW_MS
