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
    signalDb: unknown
    options?: Record<string, unknown>
    instance: MockSignaler
}

type SignalerHandlers = {
    connection?: (state: RTCPeerConnectionState) => void
    message?: (text: string, meta?: { reliable?: boolean }) => void
    debug?: (state: unknown) => void
    error?: (err: unknown) => void
    fastOpen?: () => void
    reliableOpen?: () => void
    fastClose?: () => void
    reliableClose?: () => void
}

let signalerQueue: MockSignaler[] = []
let constructorCalls: ConstructorCall[] = []

vi.mock('@vibe-rtc/rtc-core', () => {
    class RTCSignaler {
        constructor(
            role: 'caller' | 'callee',
            signalDb: unknown,
            options?: Record<string, unknown>,
        ) {
            const instance = signalerQueue.shift() ?? createMockSignaler()
            constructorCalls.push({ role, signalDb, options, instance })
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

function getHandlers(signaler: MockSignaler): SignalerHandlers {
    return (signaler as MockSignaler & { __handlers?: SignalerHandlers }).__handlers ?? {}
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

    const view = render(
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

    return { ...view, signalServer, getContext }
}

async function invoke<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T
    await act(async () => {
        result = await fn()
    })
    return result
}

describe('VibeRTCProvider - Lifecycle', () => {
    beforeEach(() => {
        signalerQueue = []
        constructorCalls = []
        vi.clearAllMocks()
        vi.useRealTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('createChannel creates caller session, starts connect flow and room watch', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-create-1')
        })
        const signalServer = createMockSignalDB()
        const { getContext } = await renderProvider({ signalServer })

        const roomId = await invoke(() => getContext().createChannel())

        expect(roomId).toBe('room-create-1')
        expect(constructorCalls).toHaveLength(1)
        expect(constructorCalls[0]?.role).toBe('caller')
        expect(constructorCalls[0]?.signalDb).toBe(signalServer)
        expect(signaler.createRoom).toHaveBeenCalledTimes(1)
        expect(signaler.connect).toHaveBeenCalledTimes(1)
        expect(getContext().roomId).toBe('room-create-1')
        expect(getContext().status).toBe('connecting')
        await waitFor(() => {
            expect(signalServer.getRoom).toHaveBeenCalled()
        })
    })

    it('createChannel propagates error and stores lastError', async () => {
        enqueueSignaler((s) => {
            s.createRoom.mockRejectedValue(new Error('create failed'))
        })
        const { getContext } = await renderProvider()

        let thrown: unknown
        await act(async () => {
            try {
                await getContext().createChannel()
            } catch (e) {
                thrown = e
            }
        })

        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toBe('create failed')
        expect(getContext().lastError?.message).toBe('create failed')
        expect(getContext().status).toBe('error')
    })

    it('joinChannel creates callee session and starts connect flow', async () => {
        const signaler = enqueueSignaler()
        const signalServer = createMockSignalDB()
        const { getContext } = await renderProvider({ signalServer })

        await invoke(() => getContext().joinChannel('room-join-1'))

        expect(constructorCalls).toHaveLength(1)
        expect(constructorCalls[0]?.role).toBe('callee')
        expect(constructorCalls[0]?.signalDb).toBe(signalServer)
        expect(signaler.joinRoom).toHaveBeenCalledWith('room-join-1')
        expect(signaler.connect).toHaveBeenCalledTimes(1)
        expect(getContext().roomId).toBe('room-join-1')
        expect(getContext().status).toBe('connecting')
        await waitFor(() => {
            expect(signalServer.getRoom).toHaveBeenCalled()
        })
    })

    it('joinChannel throws on empty roomId', async () => {
        const { getContext } = await renderProvider()

        await expect(invoke(() => getContext().joinChannel(''))).rejects.toThrow(
            'joinChannel(roomId) requires roomId',
        )
        expect(constructorCalls).toHaveLength(0)
    })

    it('attachAsCaller disposes previous signaler, resets messages and clears lastError', async () => {
        const first = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-old')
        })
        const second = enqueueSignaler()
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())

        await act(async () => {
            getHandlers(first).message?.('old-fast')
            getHandlers(first).message?.('old-reliable', { reliable: true })
            getHandlers(first).error?.({
                name: 'RTCError',
                code: 'OLD_ERROR',
                message: 'old failure',
            })
        })
        expect(getContext().messageSeqFast).toBe(1)
        expect(getContext().messageSeqReliable).toBe(1)
        expect(getContext().lastError?.code).toBe('OLD_ERROR')

        await invoke(() => getContext().attachAsCaller('room-new'))

        expect(first.hangup).toHaveBeenCalledTimes(1)
        expect(constructorCalls).toHaveLength(2)
        expect(constructorCalls[1]?.role).toBe('caller')
        expect(second.joinRoom).toHaveBeenCalledWith('room-new')
        expect(second.connect).toHaveBeenCalledTimes(1)
        expect(getContext().roomId).toBe('room-new')
        expect(getContext().messageSeqFast).toBe(0)
        expect(getContext().messageSeqReliable).toBe(0)
        expect(getContext().lastFastMessage).toBeUndefined()
        expect(getContext().lastReliableMessage).toBeUndefined()
        expect(getContext().lastError).toBeUndefined()
    })

    it('attachAsCallee disposes previous signaler and joins as callee', async () => {
        const first = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-old')
        })
        const second = enqueueSignaler()
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await invoke(() => getContext().attachAsCallee('room-new'))

        expect(first.hangup).toHaveBeenCalledTimes(1)
        expect(constructorCalls).toHaveLength(2)
        expect(constructorCalls[1]?.role).toBe('callee')
        expect(second.joinRoom).toHaveBeenCalledWith('room-new')
        expect(second.connect).toHaveBeenCalledTimes(1)
        expect(getContext().roomId).toBe('room-new')
        expect(getContext().status).toBe('connecting')
    })

    it('attachAuto detects existing role by uid and returns heartbeat stop function', async () => {
        const signaler = enqueueSignaler()
        const signalServer = createMockSignalDB({
            auth: { currentUser: { uid: 'me' } },
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-auto-uid',
                callerUid: 'me',
                calleeUid: null,
            }),
        })
        const { getContext } = await renderProvider({ signalServer })

        const stop = await invoke(() => getContext().attachAuto('room-auto-uid'))

        expect(stop).toEqual(expect.any(Function))
        expect(signalServer.joinRoom).toHaveBeenCalledWith('room-auto-uid')
        expect(signalServer.claimCallerIfFree).not.toHaveBeenCalled()
        expect(signalServer.claimCalleeIfFree).not.toHaveBeenCalled()
        expect(constructorCalls[0]?.role).toBe('caller')
        expect(signaler.joinRoom).toHaveBeenCalledWith('room-auto-uid')
        expect(signaler.connect).toHaveBeenCalledTimes(1)
        stop?.()
    })

    it('attachAuto claims free role with caller->callee fallback', async () => {
        enqueueSignaler()
        const signalServer = createMockSignalDB({
            auth: { currentUser: { uid: 'me' } },
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-auto-claim',
                callerUid: null,
                calleeUid: null,
            }),
            claimCallerIfFree: vi.fn().mockResolvedValue(false),
            claimCalleeIfFree: vi.fn().mockResolvedValue(true),
        })
        const { getContext } = await renderProvider({ signalServer })

        const stop = await invoke(() => getContext().attachAuto('room-auto-claim'))

        expect(signalServer.claimCallerIfFree).toHaveBeenCalledTimes(1)
        expect(signalServer.claimCalleeIfFree).toHaveBeenCalledTimes(1)
        expect(constructorCalls[0]?.role).toBe('callee')
        stop?.()
    })

    it('attachAuto attempts takeover when enabled', async () => {
        enqueueSignaler()
        const signalServer = createMockSignalDB({
            auth: { currentUser: { uid: 'me' } },
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-auto-takeover',
                callerUid: 'another',
                calleeUid: 'another-2',
            }),
            claimCallerIfFree: vi.fn().mockResolvedValue(false),
            claimCalleeIfFree: vi.fn().mockResolvedValue(false),
            tryTakeOver: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
        })
        const { getContext } = await renderProvider({ signalServer })

        const stop = await invoke(() =>
            getContext().attachAuto('room-auto-takeover', { allowTakeOver: true, staleMs: 12_345 }),
        )

        expect(signalServer.tryTakeOver).toHaveBeenCalledWith('callee', 12_345)
        expect(signalServer.tryTakeOver).toHaveBeenCalledTimes(1)
        expect(constructorCalls[0]?.role).toBe('callee')
        stop?.()
    })

    it('attachAuto throws when room is occupied and takeover is disabled', async () => {
        const signalServer = createMockSignalDB({
            auth: { currentUser: { uid: 'me' } },
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-auto-full',
                callerUid: 'another',
                calleeUid: 'another-2',
            }),
            claimCallerIfFree: vi.fn().mockResolvedValue(false),
            claimCalleeIfFree: vi.fn().mockResolvedValue(false),
        })
        const { getContext } = await renderProvider({ signalServer })

        let thrown: unknown
        await act(async () => {
            try {
                await getContext().attachAuto('room-auto-full')
            } catch (e) {
                thrown = e
            }
        })

        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toBe('Room already occupied by other UIDs')
        expect(constructorCalls).toHaveLength(0)
        expect(getContext().lastError?.message).toBe('Room already occupied by other UIDs')
        expect(getContext().status).toBe('error')
    })

    it('attachAuto heartbeat loop stops after returned stop() call', async () => {
        enqueueSignaler()
        const signalServer = createMockSignalDB({
            auth: { currentUser: { uid: 'me' } },
            getRoom: vi.fn().mockResolvedValue({
                roomId: 'room-auto-heartbeat',
                callerUid: 'me',
                calleeUid: null,
            }),
        })
        const { getContext } = await renderProvider({ signalServer })
        vi.useFakeTimers()

        const stop = await invoke(() => getContext().attachAuto('room-auto-heartbeat'))

        await act(async () => {
            await Promise.resolve()
        })
        expect(signalServer.heartbeat).toHaveBeenCalledTimes(1)

        await act(async () => {
            vi.advanceTimersByTime(15_000)
            await Promise.resolve()
        })
        expect(signalServer.heartbeat).toHaveBeenCalledTimes(2)

        stop?.()

        await act(async () => {
            vi.advanceTimersByTime(30_000)
            await Promise.resolve()
        })
        expect(signalServer.heartbeat).toHaveBeenCalledTimes(2)
    })

    it('disconnect hangs up, clears lastError, keeps roomId and sets disconnected status', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-disconnect')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'X_FAIL',
                message: 'temporary failure',
            })
        })
        expect(getContext().lastError?.code).toBe('X_FAIL')

        await invoke(() => getContext().disconnect())

        expect(signaler.hangup).toHaveBeenCalledTimes(1)
        expect(getContext().status).toBe('disconnected')
        expect(getContext().roomId).toBe('room-disconnect')
        expect(getContext().lastError).toBeUndefined()
    })

    it('endRoom ends signaling room, disposes session and resets local state', async () => {
        const signaler = enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-end')
        })
        const { getContext } = await renderProvider()

        await invoke(() => getContext().createChannel())
        await act(async () => {
            getHandlers(signaler).message?.('m-fast')
            getHandlers(signaler).message?.('m-reliable', { reliable: true })
            getHandlers(signaler).error?.({
                name: 'RTCError',
                code: 'ANY',
                message: 'will be cleared',
            })
        })
        expect(getContext().messageSeqFast).toBe(1)
        expect(getContext().messageSeqReliable).toBe(1)
        expect(getContext().lastError).toBeDefined()

        await invoke(() => getContext().endRoom())

        expect(signaler.endRoom).toHaveBeenCalledTimes(1)
        expect(signaler.hangup).toHaveBeenCalledTimes(1)
        expect(getContext().roomId).toBeNull()
        expect(getContext().status).toBe('idle')
        expect(getContext().lastError).toBeUndefined()
        expect(getContext().messageSeqFast).toBe(0)
        expect(getContext().messageSeqReliable).toBe(0)
        expect(getContext().lastFastMessage).toBeUndefined()
        expect(getContext().lastReliableMessage).toBeUndefined()
    })
})
