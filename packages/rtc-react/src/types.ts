import { DebugState, RTCSignaler, SignalDB } from '@vibe-rtc/rtc-core'
import type React from 'react'

export type VibeRTCStatus =
    | 'idle'
    | 'booting'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'error'

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
    /** Создать комнату как caller; вернёт roomId и подключится */
    createChannel: () => Promise<string>
    /** Присоединиться к существующей комнате как callee и подключиться */
    joinChannel: (roomId: string) => Promise<void>
    /** Мягко разорвать соединение (оставляя комнату) */
    disconnect: () => Promise<void>
    /** Полностью завершить комнату (если вы инициатор/имеете права) */
    endRoom: () => Promise<void>
    /** Отправка сообщений */
    sendFast: (text: string) => Promise<void>
    sendReliable: (text: string) => Promise<void>
    attachAsCaller: (roomId: string) => Promise<void>
    attachAsCallee: (roomId: string) => Promise<void>
    attachAuto(
        roomId: string,
        opts?: { allowTakeOver?: boolean; staleMs?: number },
    ): Promise<(() => void) | void>
}

export interface VibeRTCProviderProps {
    /** Готовый адаптер сигналинга */
    signalServer?: SignalDB | null
    /** Фабрика для отложенной инициализации адаптера (провайдер сам покажет booting/error) */
    createSignalServer?: () => Promise<SignalDB>
    /** RTC конфиг для PeerConnection */
    rtcConfiguration?: RTCConfiguration

    /** Кастомный компонент/узел загрузки */
    renderLoading?: React.ReactNode
    /** Кастомный рендер ошибки бута */
    renderBootError?: (err: VibeRTCError) => React.ReactNode
    /** Дети */
    children: React.ReactNode
}
