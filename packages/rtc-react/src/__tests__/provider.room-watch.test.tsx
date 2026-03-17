import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVibeRTC, VibeRTCProvider } from '../context'
import type { VibeRTCContextValue } from '../types'
import {
    createMockSignalDB,
    createMockSignaler,
    type MockSignalDB,
    type MockSignaler,
} from './test-utils'

type ConstructorCall = {
    role: 'caller' | 'callee'
    instance: MockSignaler
}

let signalerQueue: MockSignaler[] = []
let constructorCalls: ConstructorCall[] = []

vi.mock('@vibe-rtc/rtc-core', () => {
    class RTCSignaler {
        constructor(role: 'caller' | 'callee') {
            const instance = signalerQueue.shift() ?? createMockSignaler()
            constructorCalls.push({ role, instance })
            Object.assign(this, instance)
        }
    }
    return { RTCSignaler }
})

function enqueueSignaler(setup?: (signaler: MockSignaler) => void): MockSignaler {
    const signaler = createMockSignaler()
    setup?.(signaler)
    signalerQueue.push(signaler)
    return signaler
}

function ContextProbe(props: { onChange: (value: VibeRTCContextValue) => void }) {
    const ctx = useVibeRTC()
    useEffect(() => {
        props.onChange(ctx)
    }, [ctx, props])
    return null
}

async function renderProvider(options?: { signalServer?: MockSignalDB }) {
    const signalServer = options?.signalServer ?? createMockSignalDB()
    let currentContext: VibeRTCContextValue | null = null

    render(
        <VibeRTCProvider signalServer={signalServer}>
            <ContextProbe
                onChange={(ctx) => {
                    currentContext = ctx
                }}
            />
        </VibeRTCProvider>,
    )

    await waitFor(() => {
        expect(currentContext).not.toBeNull()
    })

    const getContext = () => {
        if (!currentContext) throw new Error('Context is not initialized')
        return currentContext
    }

    return { signalServer, getContext }
}

async function invoke<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T
    await act(async () => {
        result = await fn()
    })
    return result
}

async function flushMicrotasks(cycles = 3) {
    for (let i = 0; i < cycles; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

async function advanceAndFlush(ms: number) {
    await act(async () => {
        vi.advanceTimersByTime(ms)
        await Promise.resolve()
    })
    await flushMicrotasks()
}

describe('VibeRTCProvider - Room Watch', () => {
    beforeEach(() => {
        signalerQueue = []
        constructorCalls = []
        vi.clearAllMocks()
        vi.useRealTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('room deletion disposes signaler and sets ROOM_NOT_FOUND', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-missing')
        })
        const signalServer = createMockSignalDB({
            getRoom: vi.fn().mockResolvedValue(null),
        })
        const { getContext } = await renderProvider({ signalServer })

        vi.useFakeTimers()
        await invoke(() => getContext().createChannel())
        await flushMicrotasks(5)

        expect(getContext().lastError?.code).toBe('ROOM_NOT_FOUND')
        expect(getContext().roomId).toBe('room-missing')
        expect(signaler.hangup).toHaveBeenCalledTimes(1)
        const missingEntry = getContext().operationLog.find(
            (entry) => entry.event === 'room:missing',
        )
        expect(missingEntry?.scope).toBe('error')

        const callsAfterDetection = signalServer.getRoom.mock.calls.length
        await advanceAndFlush(6000)
        expect(signalServer.getRoom).toHaveBeenCalledTimes(callsAfterDetection)
    })

    it('participant mismatch triggers TAKEOVER_DETECTED and stops room watch', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-takeover-participant')
        })
        const signalServer = createMockSignalDB({
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-takeover-participant',
                callerUid: 'test-uid',
                calleeUid: 'peer',
                slots: {
                    caller: {
                        participantId: 'another-participant',
                        sessionId: 'test-session',
                    },
                },
            }),
        })
        const { getContext } = await renderProvider({ signalServer })

        vi.useFakeTimers()
        await invoke(() => getContext().createChannel())
        await flushMicrotasks(5)

        expect(getContext().lastError?.code).toBe('TAKEOVER_DETECTED')
        expect(getContext().lastError?.message).toBe('Room slot was taken over in another tab')
        expect(signaler.hangup).toHaveBeenCalledTimes(1)
        const takeoverEntry = getContext().operationLog.find(
            (entry) => entry.event === 'takeover-detected',
        )
        expect(takeoverEntry?.scope).toBe('error')

        const callsAfterDetection = signalServer.getRoom.mock.calls.length
        await advanceAndFlush(4000)
        expect(signalServer.getRoom).toHaveBeenCalledTimes(callsAfterDetection)
    })

    it('session mismatch triggers TAKEOVER_DETECTED', async () => {
        enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-takeover-session')
        })
        const signalServer = createMockSignalDB({
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-takeover-session',
                callerUid: 'test-uid',
                calleeUid: 'peer',
                slots: {
                    caller: {
                        participantId: 'test-participant',
                        sessionId: 'another-session',
                    },
                },
            }),
        })
        const { getContext } = await renderProvider({ signalServer })

        await invoke(() => getContext().createChannel())
        await flushMicrotasks(4)

        expect(getContext().lastError?.code).toBe('TAKEOVER_DETECTED')
        expect(getContext().status).toBe('error')
    })

    it('caller with active transport detects peer-left when callee disappears', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-peer-left-caller')
            s.inspect.mockReturnValue({
                pcState: 'connected',
                fast: { state: 'open' },
                reliable: { state: 'closed' },
            })
        })
        const signalServer = createMockSignalDB({
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-peer-left-caller',
                callerUid: 'test-uid',
                calleeUid: null,
            }),
        })
        const { getContext } = await renderProvider({ signalServer })

        await invoke(() => getContext().createChannel())
        await flushMicrotasks(4)

        expect(getContext().lastError?.code).toBe('PEER_LEFT')
        expect(getContext().lastError?.message).toContain('callee ended session')
        expect(signaler.hangup).toHaveBeenCalledTimes(1)
        const peerLeftEntry = getContext().operationLog.find((entry) => entry.event === 'peer:left')
        expect(peerLeftEntry?.scope).toBe('system')
    })

    it('callee with active transport detects peer-left when caller disappears', async () => {
        enqueueSignaler((s) => {
            s.inspect.mockReturnValue({
                pcState: 'connected',
                fast: { state: 'open' },
                reliable: { state: 'open' },
            })
        })
        const signalServer = createMockSignalDB({
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-peer-left-callee',
                callerUid: null,
                calleeUid: 'test-uid',
            }),
        })
        const { getContext } = await renderProvider({ signalServer })

        await invoke(() => getContext().joinChannel('room-peer-left-callee'))
        await flushMicrotasks(4)

        expect(constructorCalls[0]?.role).toBe('callee')
        expect(getContext().lastError?.code).toBe('PEER_LEFT')
        expect(getContext().lastError?.message).toContain('caller ended session')
    })

    it('peer-left does not trigger when transport is not active', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-no-peer-left')
            s.inspect.mockReturnValue({
                pcState: 'connecting',
                fast: { state: 'closed' },
                reliable: { state: 'closed' },
            })
        })
        const signalServer = createMockSignalDB({
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-no-peer-left',
                callerUid: 'test-uid',
                calleeUid: null,
            }),
        })
        const { getContext } = await renderProvider({ signalServer })

        vi.useFakeTimers()
        await invoke(() => getContext().createChannel())
        await flushMicrotasks(4)

        expect(getContext().lastError).toBeUndefined()
        expect(signaler.hangup).not.toHaveBeenCalled()

        await advanceAndFlush(2000)
        expect(signalServer.getRoom.mock.calls.length).toBeGreaterThanOrEqual(2)

        await invoke(() => getContext().disconnect())
    })

    it('room watch polls every 2s and stops after disconnect', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-watch-poll')
            s.inspect.mockReturnValue({
                pcState: 'connecting',
                fast: { state: 'closed' },
                reliable: { state: 'closed' },
            })
        })
        const signalServer = createMockSignalDB({
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-watch-poll',
                callerUid: 'test-uid',
                calleeUid: 'peer',
            }),
        })
        const { getContext } = await renderProvider({ signalServer })

        vi.useFakeTimers()
        await invoke(() => getContext().createChannel())
        await flushMicrotasks(4)

        expect(signalServer.getRoom).toHaveBeenCalledTimes(1)

        await advanceAndFlush(2000)
        expect(signalServer.getRoom).toHaveBeenCalledTimes(2)

        await advanceAndFlush(2000)
        expect(signalServer.getRoom).toHaveBeenCalledTimes(3)

        await advanceAndFlush(2000)
        expect(signalServer.getRoom).toHaveBeenCalledTimes(4)

        await invoke(() => getContext().disconnect())
        expect(signaler.hangup).toHaveBeenCalledTimes(1)

        const callsAfterStop = signalServer.getRoom.mock.calls.length
        await advanceAndFlush(6000)
        expect(signalServer.getRoom).toHaveBeenCalledTimes(callsAfterStop)
    })
})
