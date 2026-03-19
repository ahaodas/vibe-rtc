import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VibeRTCProvider } from '../context'
import type { InviteDrivenVibeRTCResult, RoomInvite, UseVibeRTCOptions } from '../types'
import { useVibeRTCSession } from '../use-vibe-rtc'
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

function SessionProbe(props: {
    options: UseVibeRTCOptions
    onChange: (value: InviteDrivenVibeRTCResult) => void
    onRender: () => void
}) {
    const session = useVibeRTCSession(props.options)
    props.onRender()
    useEffect(() => {
        props.onChange(session)
    }, [session, props])
    return null
}

async function renderSession(options: UseVibeRTCOptions, signalServer?: MockSignalDB) {
    const db = signalServer ?? createMockSignalDB()
    let currentSession: InviteDrivenVibeRTCResult | null = null
    let renderCount = 0

    const view = render(
        <VibeRTCProvider signalServer={db}>
            <SessionProbe
                options={options}
                onRender={() => {
                    renderCount += 1
                }}
                onChange={(value) => {
                    currentSession = value
                }}
            />
        </VibeRTCProvider>,
    )

    await waitFor(() => {
        expect(currentSession).not.toBeNull()
    })

    const getSession = () => {
        if (!currentSession) throw new Error('Session is not initialized')
        return currentSession
    }

    const rerender = (nextOptions: UseVibeRTCOptions) => {
        view.rerender(
            <VibeRTCProvider signalServer={db}>
                <SessionProbe
                    options={nextOptions}
                    onRender={() => {
                        renderCount += 1
                    }}
                    onChange={(value) => {
                        currentSession = value
                    }}
                />
            </VibeRTCProvider>,
        )
    }

    return { ...view, signalServer: db, getSession, rerender, getRenderCount: () => renderCount }
}

async function invoke<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T
    await act(async () => {
        result = await fn()
    })
    return result
}

describe('useVibeRTCSession', () => {
    beforeEach(() => {
        signalerQueue = []
        constructorCalls = []
        vi.clearAllMocks()
        vi.useRealTimers()
    })

    it('auto-starts from an existing invite without requiring sessionId', async () => {
        const invite: RoomInvite = {
            roomId: 'room-existing',
            connectionStrategy: 'LAN_FIRST',
        }
        const signaler = enqueueSignaler()
        const signalServer = createMockSignalDB({
            getRoleSessionId: vi.fn().mockReturnValue('session-existing'),
        })
        const { getSession } = await renderSession(
            {
                role: 'callee',
                invite,
                autoStart: true,
            },
            signalServer,
        )

        await waitFor(() => {
            expect(signaler.joinRoom).toHaveBeenCalledWith('room-existing')
        })
        expect(signaler.connect).toHaveBeenCalledTimes(1)
        expect(getSession().invite).toEqual({
            roomId: 'room-existing',
            sessionId: 'session-existing',
            connectionStrategy: 'LAN_FIRST',
        })
    })

    it('creates a new session for caller when invite is null and autoCreate=true', async () => {
        enqueueSignaler((s) => {
            s.createRoom.mockResolvedValue('room-created')
        })
        const signalServer = createMockSignalDB({
            getRoleSessionId: vi.fn().mockReturnValue('session-created'),
        })
        const { getSession } = await renderSession(
            {
                role: 'caller',
                invite: null,
                autoStart: true,
                autoCreate: true,
            },
            signalServer,
        )

        await waitFor(() => {
            const first = constructorCalls[0]?.instance
            expect(first?.createRoom).toHaveBeenCalledTimes(1)
            expect(first?.connect).toHaveBeenCalledTimes(1)
        })
        expect(getSession().invite).toEqual({
            roomId: 'room-created',
            sessionId: 'session-created',
            connectionStrategy: 'LAN_FIRST',
        })
    })

    it('reacts to invite changes in options', async () => {
        const first = enqueueSignaler()
        const second = enqueueSignaler()
        const inviteA: RoomInvite = {
            roomId: 'room-A',
            sessionId: 'session-A',
            connectionStrategy: 'LAN_FIRST',
        }
        const inviteB: RoomInvite = {
            roomId: 'room-B',
            sessionId: 'session-B',
            connectionStrategy: 'BROWSER_NATIVE',
        }
        const signalServer = createMockSignalDB({
            getRoleSessionId: vi.fn().mockImplementation((role: 'caller' | 'callee') => {
                return role === 'caller' ? inviteA.sessionId : inviteB.sessionId
            }),
        })
        const { rerender, getSession } = await renderSession(
            {
                role: 'caller',
                invite: inviteA,
            },
            signalServer,
        )

        await waitFor(() => {
            expect(first.joinRoom).toHaveBeenCalledWith('room-A')
        })

        rerender({
            role: 'caller',
            invite: inviteB,
        })

        await waitFor(() => {
            expect(first.hangup).toHaveBeenCalledTimes(1)
            expect(second.joinRoom).toHaveBeenCalledWith('room-B')
        })
        expect(getSession().invite?.roomId).toBe('room-B')
    })

    it('does not restart for semantically equivalent options with new object identity', async () => {
        const first = enqueueSignaler()
        const invite: RoomInvite = {
            roomId: 'room-stable',
            connectionStrategy: 'LAN_FIRST',
        }
        const signalServer = createMockSignalDB({
            getRoleSessionId: vi.fn().mockReturnValue('session-stable'),
        })
        const { rerender } = await renderSession(
            {
                role: 'callee',
                invite,
                autoStart: true,
            },
            signalServer,
        )

        await waitFor(() => {
            expect(first.joinRoom).toHaveBeenCalledWith('room-stable')
        })

        rerender({
            role: 'callee',
            invite: {
                roomId: 'room-stable',
                sessionId: '   ',
                connectionStrategy: 'LAN_FIRST',
            },
            autoStart: true,
        })

        await act(async () => {
            await Promise.resolve()
        })

        expect(constructorCalls).toHaveLength(1)
        expect(first.hangup).not.toHaveBeenCalled()
    })

    it('reconfigures signaling on role switch', async () => {
        const first = enqueueSignaler()
        const second = enqueueSignaler()
        const invite: RoomInvite = {
            roomId: 'room-role-switch',
            sessionId: 'session-role-switch',
            connectionStrategy: 'LAN_FIRST',
        }
        const { rerender } = await renderSession({
            role: 'caller',
            invite,
            autoStart: true,
        })

        await waitFor(() => {
            expect(first.joinRoom).toHaveBeenCalledWith('room-role-switch')
        })

        rerender({
            role: 'callee',
            invite,
            autoStart: true,
        })

        await waitFor(() => {
            expect(first.hangup).toHaveBeenCalledTimes(1)
            expect(second.joinRoom).toHaveBeenCalledWith('room-role-switch')
        })
        expect(constructorCalls[1]?.role).toBe('callee')
    })

    it('supports autoStart=false via imperative start() and autoStart=true via implicit start', async () => {
        const invite: RoomInvite = {
            roomId: 'room-manual',
            sessionId: 'session-manual',
            connectionStrategy: 'LAN_FIRST',
        }
        const manualSignaler = enqueueSignaler()
        const autoSignaler = enqueueSignaler()

        const manual = await renderSession({
            role: 'callee',
            invite,
            autoStart: false,
        })

        await act(async () => {
            await Promise.resolve()
        })
        expect(constructorCalls).toHaveLength(0)

        await invoke(() => manual.getSession().start())
        await waitFor(() => {
            expect(manualSignaler.joinRoom).toHaveBeenCalledWith('room-manual')
        })

        await renderSession({
            role: 'callee',
            invite: {
                roomId: 'room-auto',
                sessionId: 'session-auto',
                connectionStrategy: 'LAN_FIRST',
            },
            autoStart: true,
        })

        await waitFor(() => {
            expect(autoSignaler.joinRoom).toHaveBeenCalledWith('room-auto')
        })
    })

    it('forwards takeover event with bySessionId via onTakenOver callback', async () => {
        const signaler = enqueueSignaler()
        const onTakenOver = vi.fn()
        await renderSession({
            role: 'caller',
            invite: {
                roomId: 'room-takeover',
                sessionId: 'session-takeover',
                connectionStrategy: 'LAN_FIRST',
            },
            onTakenOver,
            debug: false,
            logMessages: false,
        })

        await waitFor(() => {
            expect(signaler.joinRoom).toHaveBeenCalledWith('room-takeover')
        })

        await act(async () => {
            getHandlers(signaler).debug?.({
                roomId: 'room-takeover',
                role: 'caller',
                lastEvent: 'takeover-detected',
                takeoverBySessionId: 'new-owner-session',
                pcGeneration: 3,
            })
            getHandlers(signaler).debug?.({
                roomId: 'room-takeover',
                role: 'caller',
                lastEvent: 'takeover-detected',
                takeoverBySessionId: 'new-owner-session',
                pcGeneration: 3,
            })
        })

        expect(onTakenOver).toHaveBeenCalledTimes(1)
        expect(onTakenOver).toHaveBeenCalledWith({
            roomId: 'room-takeover',
            role: 'caller',
            bySessionId: 'new-owner-session',
        })
    })

    it('disables ping subsystem when onPing callback is absent', async () => {
        const signaler = enqueueSignaler()
        await renderSession({
            role: 'callee',
            invite: {
                roomId: 'room-no-ping',
                sessionId: 'session-no-ping',
                connectionStrategy: 'LAN_FIRST',
            },
        })

        await waitFor(() => {
            expect(signaler.joinRoom).toHaveBeenCalledWith('room-no-ping')
        })

        expect(constructorCalls[0]?.options?.pingIntervalMs).toBe(0)
        expect(signaler.setDebugHandler).not.toHaveBeenCalled()
    })

    it('keeps inbound message hot path independent from React state churn', async () => {
        const signaler = enqueueSignaler()
        const onFastMessage = vi.fn()
        const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
        const { getRenderCount } = await renderSession({
            role: 'callee',
            invite: {
                roomId: 'room-hot-path',
                sessionId: 'session-hot-path',
                connectionStrategy: 'LAN_FIRST',
            },
            onFastMessage,
            logMessages: false,
        })

        await waitFor(() => {
            expect(signaler.joinRoom).toHaveBeenCalledWith('room-hot-path')
        })
        const rendersBefore = getRenderCount()

        await act(async () => {
            for (let i = 0; i < 25; i += 1) {
                getHandlers(signaler).message?.(`fast-${i}`, { reliable: false })
            }
        })

        expect(onFastMessage).toHaveBeenCalledTimes(25)
        expect(getRenderCount()).toBe(rendersBefore)
        expect(consoleSpy).not.toHaveBeenCalled()
        consoleSpy.mockRestore()
    })

    it('does not install message handler without subscribers and logs', async () => {
        const signaler = enqueueSignaler()
        await renderSession({
            role: 'callee',
            invite: {
                roomId: 'room-no-subscribers',
                sessionId: 'session-no-subscribers',
                connectionStrategy: 'LAN_FIRST',
            },
            logMessages: false,
        })

        await waitFor(() => {
            expect(signaler.joinRoom).toHaveBeenCalledWith('room-no-subscribers')
        })
        expect(signaler.setMessageHandler).not.toHaveBeenCalled()
    })
})
