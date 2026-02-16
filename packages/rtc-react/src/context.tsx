import { RTCSignaler, type SignalDB } from '@vibe-rtc/rtc-core'
import type { PropsWithChildren } from 'react'
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
} from 'react'
import { initialState, mapPcState, normalizeError, reducer } from './state'
import type { TimedMessage, VibeRTCContextValue, VibeRTCProviderProps } from './types'

const Ctx = createContext<VibeRTCContextValue | null>(null)

export function VibeRTCProvider(props: PropsWithChildren<VibeRTCProviderProps>) {
    const {
        signalServer,
        createSignalServer,
        rtcConfiguration,
        renderLoading,
        renderBootError,
        children,
    } = props

    const [state, dispatch] = useReducer(reducer, initialState)

    const signalDbRef = useRef<SignalDB | null>(null)
    const signalerRef = useRef<RTCSignaler | null>(null)
    const initPromiseRef = useRef<Promise<SignalDB> | null>(null)
    const autoHeartbeatStopRef = useRef<(() => void) | null>(null)
    const roomWatchStopRef = useRef<(() => void) | null>(null)

    const getSignalDB = useCallback(async (): Promise<SignalDB> => {
        if (signalDbRef.current) return signalDbRef.current
        if (initPromiseRef.current) return initPromiseRef.current

        if (signalServer) {
            signalDbRef.current = signalServer
            dispatch({ type: 'BOOT_OK' })
            return signalServer
        }
        if (!createSignalServer) {
            const err = normalizeError(
                new Error(
                    '[rtc-react] VibeRTCProvider: provide either signalServer or createSignalServer()',
                ),
            )
            dispatch({ type: 'BOOT_ERROR', error: err })
            throw err
        }

        dispatch({ type: 'BOOT_START' })
        const p = createSignalServer()
            .then((db) => {
                signalDbRef.current = db
                dispatch({ type: 'BOOT_OK' })
                return db
            })
            .catch((e) => {
                const err = normalizeError(e)
                dispatch({ type: 'BOOT_ERROR', error: err })
                throw err
            })
            .finally(() => {
                initPromiseRef.current = null
            })

        initPromiseRef.current = p
        return p
    }, [signalServer, createSignalServer])

    const ensureSignaler = useCallback(
        async (role: 'caller' | 'callee'): Promise<RTCSignaler> => {
            const db = await getSignalDB()
            const s = new RTCSignaler(role, db, { rtcConfiguration })

            s.setConnectionStateHandler((pcState) => {
                dispatch({ type: 'SET_STATUS', status: mapPcState(pcState) })
                if (pcState === 'connected') dispatch({ type: 'SET_LAST_ERROR', error: undefined })
            })
            s.setMessageHandler((text, meta) => {
                const msg: TimedMessage<string> = { at: Date.now(), data: text }
                if (meta?.reliable) dispatch({ type: 'RELIABLE_MESSAGE', message: msg })
                else dispatch({ type: 'FAST_MESSAGE', message: msg })
            })
            s.setDebugHandler((debugState) => dispatch({ type: 'SET_DEBUG_DATA', debugState }))

            s.setErrorHandler((log) =>
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(log) }),
            )

            s.setFastOpenHandler(() => dispatch({ type: 'SET_STATUS', status: 'connected' }))
            s.setReliableOpenHandler(() => dispatch({ type: 'SET_STATUS', status: 'connected' }))
            s.setFastCloseHandler(() => dispatch({ type: 'SET_STATUS', status: 'disconnected' }))
            s.setReliableCloseHandler(() =>
                dispatch({ type: 'SET_STATUS', status: 'disconnected' }),
            )

            signalerRef.current = s
            return s
        },
        [getSignalDB, rtcConfiguration],
    )

    const stopRoomWatch = useCallback(() => {
        if (roomWatchStopRef.current) {
            roomWatchStopRef.current()
            roomWatchStopRef.current = null
        }
    }, [])

    const disposeSignaler = useCallback(async () => {
        if (autoHeartbeatStopRef.current) {
            autoHeartbeatStopRef.current()
            autoHeartbeatStopRef.current = null
        }
        stopRoomWatch()
        const s = signalerRef.current
        signalerRef.current = null
        if (s) {
            try {
                await s.hangup()
            } catch {}
        }
        dispatch({ type: 'SET_STATUS', status: 'disconnected' })
    }, [stopRoomWatch])

    const startRoomWatch = useCallback(
        async (roomId: string) => {
            stopRoomWatch()
            let alive = true
            roomWatchStopRef.current = () => {
                alive = false
            }
            const db = await getSignalDB()

            const tick = async () => {
                if (!alive) return
                try {
                    const room = await db.getRoom()
                    if (!room) {
                        alive = false
                        roomWatchStopRef.current = null
                        await disposeSignaler()
                        dispatch({
                            type: 'SET_LAST_ERROR',
                            error: normalizeError({
                                name: 'RTCError',
                                code: 'ROOM_NOT_FOUND',
                                message: 'Room no longer exists',
                            }),
                        })
                        dispatch({ type: 'SET_ROOM', roomId })
                        return
                    }
                } catch {}
                if (alive) setTimeout(() => void tick(), 2000)
            }

            void tick()
        },
        [disposeSignaler, getSignalDB, stopRoomWatch],
    )

    const createChannel = useCallback(async () => {
        await disposeSignaler()
        dispatch({ type: 'RESET_MESSAGES' })
        dispatch({ type: 'SET_STATUS', status: 'connecting' })
        try {
            const s = await ensureSignaler('caller')
            const id = await s.createRoom()
            dispatch({ type: 'SET_ROOM', roomId: id })
            await s.connect()
            await startRoomWatch(id)
            return id
        } catch (e) {
            dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
            throw e
        }
    }, [disposeSignaler, ensureSignaler, startRoomWatch])

    const joinChannel = useCallback(
        async (roomId: string) => {
            if (!roomId) throw new Error('[rtc-react] joinChannel(roomId) requires roomId')
            await disposeSignaler()
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })
            try {
                const s = await ensureSignaler('callee')
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
                await startRoomWatch(roomId)
            } catch (e) {
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, startRoomWatch],
    )

    const attachAsCaller = useCallback(
        async (roomId: string) => {
            if (!roomId) throw new Error('[rtc-react] attachAsCaller(roomId) requires roomId')
            await disposeSignaler()
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })
            try {
                const s = await ensureSignaler('caller')
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
                await startRoomWatch(roomId)
                // ⚠️ УБРАН «пинок» reconnectSoft(): он вызывал гонку с onnegotiationneeded
            } catch (e) {
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, startRoomWatch],
    )

    const attachAsCallee = useCallback(
        async (roomId: string) => {
            if (!roomId) throw new Error('[rtc-react] attachAsCallee(roomId) requires roomId')
            await disposeSignaler()
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })
            try {
                const s = await ensureSignaler('callee')
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
                await startRoomWatch(roomId)
            } catch (e) {
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, startRoomWatch],
    )

    const attachAuto = useCallback(
        async (roomId: string, opts?: { allowTakeOver?: boolean; staleMs?: number }) => {
            if (!roomId) throw new Error('[rtc-react] attachAuto(roomId) requires roomId')
            const staleMs = opts?.staleMs ?? 60_000

            await disposeSignaler()
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })

            try {
                const db = await getSignalDB()
                await db.joinRoom(roomId)

                const room = await db.getRoom()
                if (!room) throw new Error('Room not found')

                const meUid = (db as any)?.auth?.currentUser?.uid ?? null

                let role: 'caller' | 'callee' | null = null

                if (meUid && room.callerUid === meUid) role = 'caller'
                else if (meUid && room.calleeUid === meUid) role = 'callee'
                else {
                    const asCaller = await (db as any).claimCallerIfFree?.()
                    if (asCaller) role = 'caller'
                    else {
                        const asCallee = await (db as any).claimCalleeIfFree?.()
                        if (asCallee) role = 'callee'
                    }

                    if (!role && opts?.allowTakeOver) {
                        const tookCallee = await (db as any).tryTakeOver?.('callee', staleMs)
                        if (tookCallee) role = 'callee'
                        else {
                            const tookCaller = await (db as any).tryTakeOver?.('caller', staleMs)
                            if (tookCaller) role = 'caller'
                        }
                    }
                }

                if (!role) throw new Error('Room already occupied by other UIDs')

                const s = await ensureSignaler(role)
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
                await startRoomWatch(roomId)

                // ⚠️ УБРАН «пинок» reconnectSoft() у caller

                let alive = true
                ;(async function beat() {
                    while (alive) {
                        try {
                            await (db as any).heartbeat?.(role)
                        } catch {}
                        await new Promise((r) => setTimeout(r, 15_000))
                    }
                })()
                const stop = () => {
                    alive = false
                }
                autoHeartbeatStopRef.current = stop
                return stop
            } catch (e) {
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, getSignalDB, startRoomWatch],
    )

    const disconnect = useCallback(async () => {
        await disposeSignaler()
    }, [disposeSignaler])

    const endRoom = useCallback(async () => {
        stopRoomWatch()
        const s = signalerRef.current
        try {
            await s?.endRoom?.()
        } catch {}
        await disposeSignaler()
        dispatch({ type: 'RESET_MESSAGES' })
        dispatch({ type: 'SET_LAST_ERROR', error: undefined })
        dispatch({ type: 'SET_ROOM', roomId: null })
        dispatch({ type: 'SET_STATUS', status: 'idle' })
    }, [disposeSignaler, stopRoomWatch])

    const sendFast = useCallback(async (text: string) => {
        const s = signalerRef.current
        if (!s) throw new Error('[rtc-react] Not connected')
        await s.sendFast(text)
    }, [])

    const sendReliable = useCallback(async (text: string) => {
        const s = signalerRef.current
        if (!s) throw new Error('[rtc-react] Not connected')
        await s.sendReliable(text)
    }, [])

    const reconnectSoft = useCallback(async () => {
        const s = signalerRef.current
        if (!s) throw new Error('[rtc-react] Not connected')
        await s.reconnectSoft()
    }, [])

    const reconnectHard = useCallback(async (opts?: { awaitReadyMs?: number }) => {
        const s = signalerRef.current
        if (!s) throw new Error('[rtc-react] Not connected')
        await s.reconnectHard(opts)
    }, [])

    useEffect(() => {
        return () => {
            if (autoHeartbeatStopRef.current) {
                autoHeartbeatStopRef.current()
                autoHeartbeatStopRef.current = null
            }
            void disposeSignaler()
        }
    }, [disposeSignaler])

    const value: VibeRTCContextValue = useMemo(
        () => ({
            ...state,
            signaler: signalerRef.current,
            createChannel,
            joinChannel,
            attachAsCaller,
            attachAsCallee,
            attachAuto,
            disconnect,
            endRoom,
            sendFast,
            sendReliable,
            reconnectSoft,
            reconnectHard,
            debugState: state.debugState,
        }),
        [
            state,
            createChannel,
            joinChannel,
            attachAsCaller,
            attachAsCallee,
            attachAuto,
            disconnect,
            endRoom,
            sendFast,
            sendReliable,
            reconnectSoft,
            reconnectHard,
            state.debugState,
        ],
    )

    if (state.booting) {
        // Keep children mounted to avoid UI flicker during lazy signaling bootstrap.
    }

    return (
        <Ctx.Provider value={value}>
            {state.booting &&
                (props.renderLoading ?? (
                    <div style={{ padding: 8, opacity: 0.7, fontSize: 12 }}>Booting signaling…</div>
                ))}
            {state.bootError &&
                (renderBootError ? (
                    renderBootError(state.bootError)
                ) : (
                    <div style={{ padding: 8, color: 'crimson', fontSize: 12 }}>
                        Failed to init signaling: {state.bootError.message}
                    </div>
                ))}
            {children}
        </Ctx.Provider>
    )
}

export function useVibeRTC() {
    const ctx = useContext(Ctx)
    if (!ctx) throw new Error('VibeRTCProvider missing')
    return ctx
}
