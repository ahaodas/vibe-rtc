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
            return { ...state, booting: true, bootError: undefined, status: 'booting' }
        case 'BOOT_OK':
            return { ...state, booting: false, bootError: undefined, status: 'idle' }
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
    const any = err as any
    return {
        name: String(any?.name ?? 'Error'),
        message: String(any?.message ?? 'Unknown error'),
        code: typeof any?.code === 'string' ? any.code : undefined,
        cause: any?.cause,
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
