import type { DebugState } from '@vibe-rtc/rtc-core'
import type { TimedMessage, VibeRTCError, VibeRTCState, VibeRTCStatus } from './types'

export type Action =
    | { type: 'BOOT_START' }
    | { type: 'BOOT_OK' }
    | { type: 'BOOT_ERROR'; error: VibeRTCError }
    | { type: 'SET_STATUS'; status: VibeRTCStatus }
    | { type: 'SET_LAST_ERROR'; error?: VibeRTCError }
    | { type: 'FAST_MESSAGE'; message: TimedMessage<string> }
    | { type: 'RELIABLE_MESSAGE'; message: TimedMessage<string> }
    | { type: 'SET_ROOM'; roomId: string | null }
    | { type: 'RESET_MESSAGES' }
    | { type: 'SET_DEBUG_DATA'; debugState: DebugState }

export const initialState: VibeRTCState = {
    status: 'idle',
    booting: false,
    bootError: undefined,
    lastError: undefined,
    lastFastMessage: undefined,
    lastReliableMessage: undefined,
    roomId: null,
    messageSeqFast: 0,
    messageSeqReliable: 0,
}

export function reducer(state: VibeRTCState, a: Action): VibeRTCState {
    switch (a.type) {
        case 'BOOT_START':
            return {
                ...state,
                booting: true,
                bootError: undefined,
                // Do not clobber an ongoing session flow that already set a runtime status.
                status: state.status === 'idle' ? 'booting' : state.status,
            }
        case 'BOOT_OK':
            return {
                ...state,
                booting: false,
                bootError: undefined,
                // Preserve an already-running session state (e.g. connecting) started during boot.
                status: state.status === 'booting' ? 'idle' : state.status,
            }
        case 'BOOT_ERROR':
            return { ...state, booting: false, bootError: a.error, status: 'error' }
        case 'SET_STATUS':
            return { ...state, status: a.status }
        case 'SET_LAST_ERROR':
            return { ...state, lastError: a.error, status: a.error ? 'error' : state.status }
        case 'FAST_MESSAGE':
            return {
                ...state,
                lastFastMessage: a.message,
                messageSeqFast: (state.messageSeqFast ?? 0) + 1,
            }
        case 'RELIABLE_MESSAGE':
            return {
                ...state,
                lastReliableMessage: a.message,
                messageSeqReliable: (state.messageSeqReliable ?? 0) + 1,
            }
        case 'SET_ROOM':
            return { ...state, roomId: a.roomId }
        case 'RESET_MESSAGES':
            return {
                ...state,
                lastFastMessage: undefined,
                lastReliableMessage: undefined,
                messageSeqFast: 0,
                messageSeqReliable: 0,
            }
        case 'SET_DEBUG_DATA':
            return {
                ...state,
                debugState: a.debugState,
            }
        default:
            return state
    }
}

export function normalizeError(err: unknown): VibeRTCError {
    const value =
        err && typeof err === 'object'
            ? (err as {
                  name?: unknown
                  message?: unknown
                  code?: unknown
                  cause?: unknown
              })
            : undefined
    const message = String(value?.message ?? 'Unknown error')
    const messageLower = message.toLowerCase()
    const rawCode = typeof value?.code === 'string' ? value.code : undefined
    const isTakeover =
        rawCode === 'TAKEOVER_DETECTED' ||
        (rawCode === 'INVALID_STATE' &&
            (messageLower.includes('takeover') || messageLower.includes('taken over')))
    return {
        name: String(value?.name ?? 'Error'),
        message: isTakeover ? 'Room slot was taken over in another tab' : message,
        code: isTakeover ? 'TAKEOVER_DETECTED' : rawCode,
        cause: value?.cause,
        at: Date.now(),
    }
}

export function mapPcState(s: RTCPeerConnectionState): VibeRTCStatus {
    switch (s) {
        case 'connected':
            return 'connected'
        case 'disconnected':
        case 'failed':
        case 'closed':
            return 'disconnected'
        case 'new':
        case 'connecting':
            return 'connecting'
        default:
            return 'idle'
    }
}
