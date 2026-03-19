import {
    DEFAULT_HARD_RECONNECT_DELAY_MS,
    DEFAULT_SOFT_RECONNECT_DELAY_MS,
    nextHardReconnectDelayMs,
    nextSoftReconnectDelayMs,
} from './recovery-policy'

export interface RecoveryBackoffState {
    softRetries: number
    hardRetries: number
    softDelayMs: number
    hardDelayMs: number
}

export const createRecoveryBackoffState = (): RecoveryBackoffState => ({
    softRetries: 0,
    hardRetries: 0,
    softDelayMs: DEFAULT_SOFT_RECONNECT_DELAY_MS,
    hardDelayMs: DEFAULT_HARD_RECONNECT_DELAY_MS,
})

export const resetRecoveryBackoffState = (): RecoveryBackoffState => createRecoveryBackoffState()

export const applySoftRetry = (state: RecoveryBackoffState): RecoveryBackoffState => ({
    ...state,
    softRetries: state.softRetries + 1,
    softDelayMs: nextSoftReconnectDelayMs(state.softDelayMs),
})

export const applyHardRetry = (state: RecoveryBackoffState): RecoveryBackoffState => ({
    ...state,
    hardRetries: state.hardRetries + 1,
    hardDelayMs: nextHardReconnectDelayMs(state.hardDelayMs),
})
