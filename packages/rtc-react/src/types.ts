import type { ConnectionStrategy, DebugState, RTCSignaler, SignalDB } from '@vibe-rtc/rtc-core'
import type React from 'react'

export type VibeRTCStatus =
    | 'idle'
    | 'booting'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'error'

export type VibeRTCOverallStatus = 'none' | 'connecting' | 'connected' | 'error'

export type VibeRTCOperationScope = 'system' | 'signaling' | 'webrtc' | 'data' | 'error'

export interface VibeRTCOperationLogEntry {
    at: number
    scope: VibeRTCOperationScope
    message: string
    event?: string
}

export interface VibeRTCError {
    name: string
    message: string
    code?: string
    cause?: unknown
    at: number
}

export interface TimedMessage<T = unknown> {
    at: number
    data: T
}

export interface VibeRTCState {
    status: VibeRTCStatus
    booting: boolean
    bootError?: VibeRTCError
    lastError?: VibeRTCError
    lastFastMessage?: TimedMessage<string>
    lastReliableMessage?: TimedMessage<string>
    roomId?: string | null
    messageSeqFast: number
    messageSeqReliable: number
    debugState?: DebugState
}

export interface VibeRTCContextValue extends VibeRTCState {
    signaler?: RTCSignaler | null
    overallStatus: VibeRTCOverallStatus
    overallStatusText: string
    operationLog: VibeRTCOperationLogEntry[]
    clearOperationLog: () => void
    /** Create a room as caller; returns roomId and connects */
    createChannel: () => Promise<string>
    /** Join an existing room as callee and connect */
    joinChannel: (roomId: string) => Promise<void>
    /** Soft disconnect while keeping the room */
    disconnect: () => Promise<void>
    /** Fully end the room (if you are initiator/have permissions) */
    endRoom: () => Promise<void>
    /** Message sending */
    sendFast: (text: string) => Promise<void>
    sendReliable: (text: string) => Promise<void>
    reconnectSoft: () => Promise<void>
    reconnectHard: (opts?: { awaitReadyMs?: number }) => Promise<void>
    attachAsCaller: (roomId: string) => Promise<void>
    attachAsCallee: (roomId: string) => Promise<void>
    attachAuto(
        roomId: string,
        opts?: { allowTakeOver?: boolean; staleMs?: number },
    ): Promise<(() => void) | undefined>
}

export interface VibeRTCProviderProps {
    /** Prebuilt signaling adapter */
    signalServer?: SignalDB | null
    /** Factory for lazy adapter init (provider renders booting/error states itself) */
    createSignalServer?: () => Promise<SignalDB>
    /** RTC config for PeerConnection */
    rtcConfiguration?: RTCConfiguration
    /** ICE connection strategy (`LAN_FIRST` by default in rtc-core) */
    connectionStrategy?: ConnectionStrategy
    /** LAN-first timeout before STUN fallback, ms */
    lanFirstTimeoutMs?: number

    /** Custom loading component/node */
    renderLoading?: React.ReactNode
    /** Custom boot error renderer */
    renderBootError?: (err: VibeRTCError) => React.ReactNode
    /** Children */
    children: React.ReactNode
}
