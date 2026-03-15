import type { DebugState, RTCSignaler, SignalDB } from '@vibe-rtc/rtc-core'
import type { Mock } from 'vitest'
import { vi } from 'vitest'

export interface MockSignaler extends RTCSignaler {
    createRoom: Mock
    joinRoom: Mock
    connect: Mock
    hangup: Mock
    endRoom: Mock
    sendFast: Mock
    sendReliable: Mock
    reconnectSoft: Mock
    reconnectHard: Mock
    inspect: Mock
    setConnectionStateHandler: Mock
    setMessageHandler: Mock
    setDebugHandler: Mock
    setErrorHandler: Mock
    setFastOpenHandler: Mock
    setReliableOpenHandler: Mock
    setFastCloseHandler: Mock
    setReliableCloseHandler: Mock
}

export interface MockSignalDB extends SignalDB {
    createRoom: Mock
    joinRoom: Mock
    getRoom: Mock
    auth?: {
        currentUser?: {
            uid?: string | null
        }
    }
    getParticipantId?: Mock
    getRoleSessionId?: Mock
    claimCallerIfFree?: Mock
    claimCalleeIfFree?: Mock
    tryTakeOver?: Mock
    heartbeat?: Mock
}

export function createMockSignaler(): MockSignaler {
    const handlers: {
        connection?: (state: RTCPeerConnectionState) => void
        message?: (text: string, meta?: { reliable?: boolean }) => void
        debug?: (state: DebugState) => void
        error?: (err: unknown) => void
        fastOpen?: () => void
        reliableOpen?: () => void
        fastClose?: () => void
        reliableClose?: () => void
    } = {}

    return {
        createRoom: vi.fn(),
        joinRoom: vi.fn(),
        connect: vi.fn(),
        hangup: vi.fn(),
        endRoom: vi.fn(),
        sendFast: vi.fn(),
        sendReliable: vi.fn(),
        reconnectSoft: vi.fn(),
        reconnectHard: vi.fn(),
        inspect: vi.fn().mockReturnValue({
            pcState: 'new',
            iceState: 'new',
            fast: { state: 'closed' },
            reliable: { state: 'closed' },
        }),
        setConnectionStateHandler: vi.fn((fn) => {
            handlers.connection = fn
        }),
        setMessageHandler: vi.fn((fn) => {
            handlers.message = fn
        }),
        setDebugHandler: vi.fn((fn) => {
            handlers.debug = fn
        }),
        setErrorHandler: vi.fn((fn) => {
            handlers.error = fn
        }),
        setFastOpenHandler: vi.fn((fn) => {
            handlers.fastOpen = fn
        }),
        setReliableOpenHandler: vi.fn((fn) => {
            handlers.reliableOpen = fn
        }),
        setFastCloseHandler: vi.fn((fn) => {
            handlers.fastClose = fn
        }),
        setReliableCloseHandler: vi.fn((fn) => {
            handlers.reliableClose = fn
        }),
        // Expose handlers for testing
        __handlers: handlers,
    } as unknown as MockSignaler
}

export function createMockSignalDB(overrides?: Partial<MockSignalDB>): MockSignalDB {
    return {
        createRoom: vi.fn(),
        joinRoom: vi.fn(),
        getRoom: vi.fn().mockResolvedValue({
            roomId: 'test-room',
            callerUid: null,
            calleeUid: null,
        }),
        auth: {
            currentUser: {
                uid: 'test-uid',
            },
        },
        getParticipantId: vi.fn().mockReturnValue('test-participant'),
        getRoleSessionId: vi.fn().mockReturnValue('test-session'),
        claimCallerIfFree: vi.fn().mockResolvedValue(false),
        claimCalleeIfFree: vi.fn().mockResolvedValue(false),
        tryTakeOver: vi.fn().mockResolvedValue(false),
        heartbeat: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as MockSignalDB
}
