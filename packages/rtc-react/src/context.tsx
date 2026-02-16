import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react'
import type { PropsWithChildren } from 'react'
import { RTCSignaler, type SignalDB } from '@vibe-rtc/rtc-core'
import type {
    VibeRTCContextValue,
    VibeRTCError,
    VibeRTCProviderProps,
    VibeRTCState,
    TimedMessage,
    VibeRTCStatus,
} from './types'
import { DebugState } from '@vibe-rtc/rtc-core'

type Action =
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

const initialState: VibeRTCState = {
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

function reducer(state: VibeRTCState, a: Action): VibeRTCState {
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

const Ctx = createContext<VibeRTCContextValue | null>(null)

function normalizeError(err: unknown): VibeRTCError {
    const any = err as any
    return {
        name: String(any?.name ?? 'Error'),
        message: String(any?.message ?? 'Unknown error'),
        code: typeof any?.code === 'string' ? any.code : undefined,
        cause: any?.cause,
        at: Date.now(),
    }
}

function mapPcState(s: RTCPeerConnectionState): VibeRTCStatus {
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

export function VibeRTCProvider(props: PropsWithChildren<VibeRTCProviderProps>) {
    const {
        signalServer,
        createSignalServer,
        rtcConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        renderLoading,
        renderBootError,
        children,
    } = props

    const [state, dispatch] = useReducer(reducer, initialState)

    const signalDbRef = useRef<SignalDB | null>(null)
    const signalerRef = useRef<RTCSignaler | null>(null)
    const initPromiseRef = useRef<Promise<SignalDB> | null>(null)

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

    const disposeSignaler = useCallback(async () => {
        const s = signalerRef.current
        signalerRef.current = null
        if (s) {
            try {
                await s.hangup()
            } catch {}
        }
        dispatch({ type: 'SET_STATUS', status: 'disconnected' })
    }, [])

    const createChannel = useCallback(async () => {
        dispatch({ type: 'RESET_MESSAGES' })
        dispatch({ type: 'SET_STATUS', status: 'connecting' })
        try {
            const s = await ensureSignaler('caller')
            const id = await s.createRoom()
            dispatch({ type: 'SET_ROOM', roomId: id })
            await s.connect()
            return id
        } catch (e) {
            dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
            throw e
        }
    }, [ensureSignaler])

    const joinChannel = useCallback(
        async (roomId: string) => {
            if (!roomId) throw new Error('[rtc-react] joinChannel(roomId) requires roomId')
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })
            try {
                const s = await ensureSignaler('callee')
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
            } catch (e) {
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
                throw e
            }
        },
        [ensureSignaler],
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
                // ⚠️ УБРАН «пинок» reconnectSoft(): он вызывал гонку с onnegotiationneeded
            } catch (e) {
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler],
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
            } catch (e) {
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler],
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
                return () => {
                    alive = false
                }
            } catch (e) {
                dispatch({ type: 'SET_LAST_ERROR', error: normalizeError(e) })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, getSignalDB],
    )

    const disconnect = useCallback(async () => {
        await disposeSignaler()
    }, [disposeSignaler])

    const endRoom = useCallback(async () => {
        const s = signalerRef.current
        try {
            await s?.endRoom?.()
        } catch {}
        await disposeSignaler()
        dispatch({ type: 'SET_ROOM', roomId: null })
    }, [disposeSignaler])

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
            state.debugState,
        ],
    )

    if (state.booting) {
        return (
            <>
                {props.renderLoading ?? (
                    <div style={{ padding: 16, opacity: 0.7 }}>Booting signaling…</div>
                )}
            </>
        )
    }
    if (state.bootError) {
        return (
            <>
                {renderBootError ? (
                    renderBootError(state.bootError)
                ) : (
                    <div style={{ padding: 16, color: 'crimson' }}>
                        Failed to init signaling: {state.bootError.message}
                    </div>
                )}
            </>
        )
    }

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useVibeRTC() {
    const ctx = useContext(Ctx)
    if (!ctx) throw new Error('VibeRTCProvider missing')
    return ctx
}
