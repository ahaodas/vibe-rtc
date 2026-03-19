import type {
    ConnectionStrategy,
    DebugState,
    PingSnapshot,
    RTCSignaler,
    SignalDB,
} from '@vibe-rtc/rtc-core'
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

export interface VibeRTCSessionOptions {
    connectionStrategy?: ConnectionStrategy
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
    createChannel: (opts?: VibeRTCSessionOptions) => Promise<string>
    /** Join an existing room as callee and connect */
    joinChannel: (roomId: string, opts?: VibeRTCSessionOptions) => Promise<void>
    /** Soft disconnect while keeping the room */
    disconnect: () => Promise<void>
    /** Fully end the room (if you are initiator/have permissions) */
    endRoom: () => Promise<void>
    /** Message sending */
    sendFast: (text: string) => Promise<void>
    sendReliable: (text: string) => Promise<void>
    reconnectSoft: () => Promise<void>
    reconnectHard: (opts?: { awaitReadyMs?: number }) => Promise<void>
    attachAsCaller: (roomId: string, opts?: VibeRTCSessionOptions) => Promise<void>
    attachAsCallee: (roomId: string, opts?: VibeRTCSessionOptions) => Promise<void>
    attachAuto(
        roomId: string,
        opts?: { allowTakeOver?: boolean; staleMs?: number } & VibeRTCSessionOptions,
    ): Promise<(() => void) | undefined>
}

export interface VibeRTCProviderProps {
    /** Prebuilt signaling adapter */
    signalServer?: SignalDB | null
    /** Factory for lazy adapter init (provider renders booting/error states itself) */
    createSignalServer?: () => Promise<SignalDB>
    /** RTC config for PeerConnection */
    rtcConfiguration?: RTCConfiguration
    /** ICE connection strategy (`LAN_FIRST` by default in rtc-core). Supports `BROWSER_NATIVE` mode. */
    connectionStrategy?: ConnectionStrategy
    /** LAN-first timeout before STUN fallback, ms */
    lanFirstTimeoutMs?: number
    /** Ping interval in ms for internal RTT probe */
    pingIntervalMs?: number
    /** Rolling window size for smoothed RTT */
    pingWindowSize?: number
    /** Polling interval in ms for WebRTC stats-based NET RTT */
    netRttIntervalMs?: number

    /** Custom loading component/node */
    renderLoading?: React.ReactNode
    /** Custom boot error renderer */
    renderBootError?: (err: VibeRTCError) => React.ReactNode
    /** Children */
    children: React.ReactNode
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export type RoomInvite = {
    roomId: string
    sessionId?: string
    connectionStrategy: ConnectionStrategy
}

export interface UseVibeRTCOptions {
    role: 'caller' | 'callee'
    invite?: RoomInvite | null
    connectionStrategy?: ConnectionStrategy
    autoStart?: boolean
    autoCreate?: boolean
    debug?: boolean
    logMessages?: boolean
    onPing?: (snapshot: PingSnapshot) => void
    onTakenOver?: (payload: {
        roomId: string
        role: 'caller' | 'callee'
        bySessionId?: string
    }) => void
    onFastMessage?: (message: string) => void
    onReliableMessage?: (message: string) => void
    onError?: (error: VibeRTCError) => void
}

export interface InviteDrivenVibeRTCResult {
    invite: RoomInvite | null
    joinUrl: string | null
    status: ConnectionStatus
    overallStatus: VibeRTCOverallStatus
    overallStatusText: string
    lastError?: VibeRTCError
    debugState?: DebugState
    operationLog: VibeRTCOperationLogEntry[]
    clearOperationLog: () => void
    start: () => Promise<void>
    stop: () => Promise<void>
    endRoom: () => Promise<void>
    sendFast: (text: string) => Promise<void>
    sendReliable: (text: string) => Promise<void>
    reconnectSoft: () => Promise<void>
    reconnectHard: (opts?: { awaitReadyMs?: number }) => Promise<void>
}

export interface VibeRTCRuntimeContextValue {
    getSignalDB: () => Promise<SignalDB>
    rtcConfiguration?: RTCConfiguration
    connectionStrategy?: ConnectionStrategy
    lanFirstTimeoutMs?: number
    pingIntervalMs?: number
    pingWindowSize?: number
    netRttIntervalMs?: number
}
