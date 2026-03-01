import { type DebugState, RTCSignaler, type SignalDB } from '@vibe-rtc/rtc-core'
import type { PropsWithChildren } from 'react'
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from 'react'
import { initialState, mapPcState, normalizeError, reducer } from './state'
import type {
    TimedMessage,
    VibeRTCContextValue,
    VibeRTCOperationLogEntry,
    VibeRTCOperationScope,
    VibeRTCOverallStatus,
    VibeRTCProviderProps,
    VibeRTCState,
} from './types'

const Ctx = createContext<VibeRTCContextValue | null>(null)
const MAX_OPERATION_LOG_SIZE = 200

function toOverallStatus(state: VibeRTCState): VibeRTCOverallStatus {
    if (state.bootError || state.lastError) return 'error'
    if (state.booting || state.status === 'booting' || state.status === 'connecting')
        return 'connecting'
    if (state.status === 'connected') return 'connected'
    return 'none'
}

function toOperationScope(event?: string): VibeRTCOperationScope {
    if (!event) return 'system'
    if (event.includes('error')) return 'error'
    if (
        event.includes('offer') ||
        event.includes('answer') ||
        event.includes('negotiation') ||
        event.includes('epoch') ||
        event.includes('joinRoom') ||
        event.includes('createRoom')
    ) {
        return 'signaling'
    }
    if (event.includes('dc') || event.includes('selected-path')) return 'data'
    if (
        event.includes('ice') ||
        event.includes('connection') ||
        event.includes('connected') ||
        event.includes('phase') ||
        event.includes('pc')
    ) {
        return 'webrtc'
    }
    return 'system'
}

function describeDebugEvent(debugState?: DebugState): string | undefined {
    const event = debugState?.lastEvent
    if (!event) return undefined
    if (event.startsWith('phase-transition:LAN->STUN')) {
        return 'LAN-first did not complete in time, switching to STUN fallback.'
    }
    if (event === 'phase=LAN') return 'LAN-first phase is active. Collecting host candidates.'
    if (event === 'phase=STUN') return 'STUN phase is active. Collecting srflx candidates.'
    if (event === 'negotiationneeded' || event === 'negotiation-bootstrap') {
        return 'Running offer/answer negotiation.'
    }
    if (event === 'onOffer') return 'Received remote offer and preparing local answer.'
    if (event === 'onAnswer') return 'Received remote answer and finalizing negotiation.'
    if (event === 'connected') return 'Peer connected. Waiting for both data channels to open.'
    if (event === 'ice=completed') return 'ICE gathering/check completed.'
    if (event.startsWith('dc-open:')) return 'Data channel opened and ready for traffic.'
    if (event.startsWith('dc-close:')) return 'Data channel closed; reconnect logic may run.'
    if (event.startsWith('selected-path:')) {
        const path = event.split(':')[1]
        return `Connected path selected: ${path}.`
    }
    return `Current operation: ${event}.`
}

function toOverallStatusText(state: VibeRTCState, overallStatus: VibeRTCOverallStatus): string {
    if (state.bootError) return `Signaling bootstrap failed: ${state.bootError.message}`
    if (state.lastError) {
        return `${state.lastError.code ? `${state.lastError.code}: ` : ''}${state.lastError.message}`
    }
    if (overallStatus === 'none') {
        return state.roomId
            ? 'Room selected. Attach or reconnect to establish transport.'
            : 'No active connection. Create or attach to a room.'
    }
    if (overallStatus === 'connected') {
        const path = state.debugState?.selectedPath
        if (path) return `Connected via ${path.toUpperCase()} candidate path.`
        return 'Connected. Fast and reliable channels are ready.'
    }
    const fromDebug = describeDebugEvent(state.debugState)
    if (fromDebug) return fromDebug
    if (state.booting) return 'Initializing signaling backend.'
    return 'Establishing signaling and WebRTC transport.'
}

function toDebugLogLine(debugState: DebugState): string {
    const event = debugState.lastEvent ?? 'debug'
    return [
        event,
        `phase=${debugState.phase}`,
        `pc=${debugState.pcState}`,
        `ice=${debugState.iceState}`,
        `icePhase=${debugState.icePhase}`,
        `gen=${debugState.pcGeneration}`,
    ].join(' | ')
}

type SignalDBWithPresenceOps = SignalDB & {
    auth?: {
        currentUser?: {
            uid?: string | null
        }
    }
    claimCallerIfFree?: () => Promise<boolean>
    claimCalleeIfFree?: () => Promise<boolean>
    tryTakeOver?: (role: 'caller' | 'callee', staleMs: number) => Promise<boolean>
    heartbeat?: (role: 'caller' | 'callee') => Promise<void>
}

export function VibeRTCProvider(props: PropsWithChildren<VibeRTCProviderProps>) {
    const {
        signalServer,
        createSignalServer,
        rtcConfiguration,
        connectionStrategy,
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
    const lastDebugLogKeyRef = useRef<string | null>(null)
    const [operationLog, setOperationLog] = useState<VibeRTCOperationLogEntry[]>([])

    const pushOperation = useCallback(
        (scope: VibeRTCOperationScope, message: string, event?: string) => {
            setOperationLog((prev) => {
                const next = [{ at: Date.now(), scope, message, event }, ...prev]
                return next.slice(0, MAX_OPERATION_LOG_SIZE)
            })
        },
        [],
    )

    const clearOperationLog = useCallback(() => {
        lastDebugLogKeyRef.current = null
        setOperationLog([])
    }, [])

    const getSignalDB = useCallback(async (): Promise<SignalDB> => {
        if (signalDbRef.current) return signalDbRef.current
        if (initPromiseRef.current) return initPromiseRef.current

        if (signalServer) {
            pushOperation('signaling', 'Using provided signaling adapter', 'boot:signal-server')
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
            pushOperation('error', err.message, 'boot:error')
            dispatch({ type: 'BOOT_ERROR', error: err })
            throw err
        }

        pushOperation('signaling', 'Initializing signaling adapter', 'boot:start')
        dispatch({ type: 'BOOT_START' })
        const p = createSignalServer()
            .then((db) => {
                signalDbRef.current = db
                pushOperation('signaling', 'Signaling adapter is ready', 'boot:ok')
                dispatch({ type: 'BOOT_OK' })
                return db
            })
            .catch((e) => {
                const err = normalizeError(e)
                pushOperation('error', `Signaling bootstrap failed: ${err.message}`, 'boot:error')
                dispatch({ type: 'BOOT_ERROR', error: err })
                throw err
            })
            .finally(() => {
                initPromiseRef.current = null
            })

        initPromiseRef.current = p
        return p
    }, [signalServer, createSignalServer, pushOperation])

    const ensureSignaler = useCallback(
        async (role: 'caller' | 'callee'): Promise<RTCSignaler> => {
            const db = await getSignalDB()
            pushOperation('system', `Creating RTCSignaler for role=${role}`, 'signaler:create')
            const s = new RTCSignaler(role, db, { rtcConfiguration, connectionStrategy })

            s.setConnectionStateHandler((pcState) => {
                dispatch({ type: 'SET_STATUS', status: mapPcState(pcState) })
                pushOperation('webrtc', `PeerConnection state: ${pcState}`, 'pc-state')
                if (pcState === 'connected') dispatch({ type: 'SET_LAST_ERROR', error: undefined })
            })
            s.setMessageHandler((text, meta) => {
                const msg: TimedMessage<string> = { at: Date.now(), data: text }
                if (meta?.reliable) dispatch({ type: 'RELIABLE_MESSAGE', message: msg })
                else dispatch({ type: 'FAST_MESSAGE', message: msg })
                pushOperation(
                    'data',
                    `Incoming ${meta?.reliable ? 'reliable' : 'fast'} message: ${text}`,
                    'message:in',
                )
            })
            s.setDebugHandler((debugState) => {
                dispatch({ type: 'SET_DEBUG_DATA', debugState })
                const debugKey = [
                    debugState.pcGeneration,
                    debugState.phase,
                    debugState.lastEvent,
                    debugState.pcState,
                    debugState.iceState,
                    debugState.fast?.state,
                    debugState.reliable?.state,
                    debugState.icePhase,
                ].join('|')
                if (lastDebugLogKeyRef.current === debugKey) return
                lastDebugLogKeyRef.current = debugKey
                const event = debugState.lastEvent
                pushOperation(toOperationScope(event), toDebugLogLine(debugState), event)
            })

            s.setErrorHandler((log) => {
                const err = normalizeError(log)
                dispatch({ type: 'SET_LAST_ERROR', error: err })
                pushOperation(
                    'error',
                    `${err.code ? `${err.code}: ` : ''}${err.message}`,
                    'signaler:error',
                )
            })

            s.setFastOpenHandler(() => {
                dispatch({ type: 'SET_STATUS', status: 'connected' })
                pushOperation('data', 'Fast data channel is open', 'dc:fast-open')
            })
            s.setReliableOpenHandler(() => {
                dispatch({ type: 'SET_STATUS', status: 'connected' })
                pushOperation('data', 'Reliable data channel is open', 'dc:reliable-open')
            })
            s.setFastCloseHandler(() => {
                dispatch({ type: 'SET_STATUS', status: 'disconnected' })
                pushOperation('data', 'Fast data channel closed', 'dc:fast-close')
            })
            s.setReliableCloseHandler(() => {
                dispatch({ type: 'SET_STATUS', status: 'disconnected' })
                pushOperation('data', 'Reliable data channel closed', 'dc:reliable-close')
            })

            signalerRef.current = s
            return s
        },
        [getSignalDB, rtcConfiguration, connectionStrategy, pushOperation],
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
            pushOperation('system', 'Disposing current RTC session', 'session:dispose')
            try {
                await s.hangup()
            } catch {}
        }
        dispatch({ type: 'SET_STATUS', status: 'disconnected' })
    }, [stopRoomWatch, pushOperation])

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
                        pushOperation(
                            'error',
                            'Room was removed on signaling backend',
                            'room:missing',
                        )
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
        [disposeSignaler, getSignalDB, stopRoomWatch, pushOperation],
    )

    const createChannel = useCallback(async () => {
        await disposeSignaler()
        dispatch({ type: 'RESET_MESSAGES' })
        dispatch({ type: 'SET_LAST_ERROR', error: undefined })
        dispatch({ type: 'SET_STATUS', status: 'connecting' })
        pushOperation('signaling', 'Starting caller flow: create room', 'create-channel:start')
        try {
            const s = await ensureSignaler('caller')
            const id = await s.createRoom()
            dispatch({ type: 'SET_ROOM', roomId: id })
            pushOperation('signaling', `Room created: ${id}`, 'create-channel:room-created')
            await s.connect()
            pushOperation(
                'webrtc',
                'Caller started signaling/WebRTC connect',
                'create-channel:connect',
            )
            await startRoomWatch(id)
            return id
        } catch (e) {
            const err = normalizeError(e)
            pushOperation(
                'error',
                `Caller flow failed: ${err.code ? `${err.code}: ` : ''}${err.message}`,
                'create-channel:error',
            )
            dispatch({ type: 'SET_LAST_ERROR', error: err })
            throw e
        }
    }, [disposeSignaler, ensureSignaler, startRoomWatch, pushOperation])

    const joinChannel = useCallback(
        async (roomId: string) => {
            if (!roomId) throw new Error('[rtc-react] joinChannel(roomId) requires roomId')
            await disposeSignaler()
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_LAST_ERROR', error: undefined })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })
            pushOperation(
                'signaling',
                `Starting callee flow: join room ${roomId}`,
                'join-channel:start',
            )
            try {
                const s = await ensureSignaler('callee')
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
                pushOperation(
                    'webrtc',
                    'Callee started signaling/WebRTC connect',
                    'join-channel:connect',
                )
                await startRoomWatch(roomId)
            } catch (e) {
                const err = normalizeError(e)
                pushOperation(
                    'error',
                    `Callee flow failed: ${err.code ? `${err.code}: ` : ''}${err.message}`,
                    'join-channel:error',
                )
                dispatch({ type: 'SET_LAST_ERROR', error: err })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, startRoomWatch, pushOperation],
    )

    const attachAsCaller = useCallback(
        async (roomId: string) => {
            if (!roomId) throw new Error('[rtc-react] attachAsCaller(roomId) requires roomId')
            await disposeSignaler()
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_LAST_ERROR', error: undefined })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })
            pushOperation('signaling', `Attach as caller to room ${roomId}`, 'attach-caller:start')
            try {
                const s = await ensureSignaler('caller')
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
                pushOperation('webrtc', 'Caller attach connect started', 'attach-caller:connect')
                await startRoomWatch(roomId)
                // reconnectSoft "nudge" removed: it caused a race with onnegotiationneeded.
            } catch (e) {
                const err = normalizeError(e)
                pushOperation(
                    'error',
                    `Attach as caller failed: ${err.code ? `${err.code}: ` : ''}${err.message}`,
                    'attach-caller:error',
                )
                dispatch({ type: 'SET_LAST_ERROR', error: err })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, startRoomWatch, pushOperation],
    )

    const attachAsCallee = useCallback(
        async (roomId: string) => {
            if (!roomId) throw new Error('[rtc-react] attachAsCallee(roomId) requires roomId')
            await disposeSignaler()
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_LAST_ERROR', error: undefined })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })
            pushOperation('signaling', `Attach as callee to room ${roomId}`, 'attach-callee:start')
            try {
                const s = await ensureSignaler('callee')
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
                pushOperation('webrtc', 'Callee attach connect started', 'attach-callee:connect')
                await startRoomWatch(roomId)
            } catch (e) {
                const err = normalizeError(e)
                pushOperation(
                    'error',
                    `Attach as callee failed: ${err.code ? `${err.code}: ` : ''}${err.message}`,
                    'attach-callee:error',
                )
                dispatch({ type: 'SET_LAST_ERROR', error: err })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, startRoomWatch, pushOperation],
    )

    const attachAuto = useCallback(
        async (roomId: string, opts?: { allowTakeOver?: boolean; staleMs?: number }) => {
            if (!roomId) throw new Error('[rtc-react] attachAuto(roomId) requires roomId')
            const staleMs = opts?.staleMs ?? 60_000

            await disposeSignaler()
            dispatch({ type: 'RESET_MESSAGES' })
            dispatch({ type: 'SET_LAST_ERROR', error: undefined })
            dispatch({ type: 'SET_STATUS', status: 'connecting' })
            pushOperation(
                'signaling',
                `Auto-attach requested for room ${roomId}`,
                'attach-auto:start',
            )

            try {
                const db = await getSignalDB()
                const dbWithPresence = db as SignalDBWithPresenceOps
                await db.joinRoom(roomId)

                const room = await db.getRoom()
                if (!room) throw new Error('Room not found')

                const meUid = dbWithPresence.auth?.currentUser?.uid ?? null

                let role: 'caller' | 'callee' | null = null

                if (meUid && room.callerUid === meUid) role = 'caller'
                else if (meUid && room.calleeUid === meUid) role = 'callee'
                else {
                    const asCaller = await dbWithPresence.claimCallerIfFree?.()
                    if (asCaller) role = 'caller'
                    else {
                        const asCallee = await dbWithPresence.claimCalleeIfFree?.()
                        if (asCallee) role = 'callee'
                    }

                    if (!role && opts?.allowTakeOver) {
                        const tookCallee = await dbWithPresence.tryTakeOver?.('callee', staleMs)
                        if (tookCallee) role = 'callee'
                        else {
                            const tookCaller = await dbWithPresence.tryTakeOver?.('caller', staleMs)
                            if (tookCaller) role = 'caller'
                        }
                    }
                }

                if (!role) throw new Error('Room already occupied by other UIDs')

                const s = await ensureSignaler(role)
                await s.joinRoom(roomId)
                dispatch({ type: 'SET_ROOM', roomId })
                await s.connect()
                pushOperation('webrtc', `Auto-attach role resolved as ${role}`, 'attach-auto:role')
                await startRoomWatch(roomId)

                // reconnectSoft "nudge" removed for caller.

                let alive = true
                ;(async function beat() {
                    while (alive) {
                        try {
                            await dbWithPresence.heartbeat?.(role)
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
                const err = normalizeError(e)
                pushOperation(
                    'error',
                    `Auto-attach failed: ${err.code ? `${err.code}: ` : ''}${err.message}`,
                    'attach-auto:error',
                )
                dispatch({ type: 'SET_LAST_ERROR', error: err })
                throw e
            }
        },
        [disposeSignaler, ensureSignaler, getSignalDB, startRoomWatch, pushOperation],
    )

    const disconnect = useCallback(async () => {
        pushOperation('system', 'Manual disconnect requested', 'disconnect')
        await disposeSignaler()
        dispatch({ type: 'SET_LAST_ERROR', error: undefined })
    }, [disposeSignaler, pushOperation])

    const endRoom = useCallback(async () => {
        pushOperation('signaling', 'End room requested', 'end-room:start')
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
        pushOperation('signaling', 'Room ended', 'end-room:done')
    }, [disposeSignaler, stopRoomWatch, pushOperation])

    const sendFast = useCallback(
        async (text: string) => {
            const s = signalerRef.current
            if (!s) throw new Error('[rtc-react] Not connected')
            await s.sendFast(text)
            pushOperation('data', `Outgoing fast message: ${text}`, 'message:out-fast')
        },
        [pushOperation],
    )

    const sendReliable = useCallback(
        async (text: string) => {
            const s = signalerRef.current
            if (!s) throw new Error('[rtc-react] Not connected')
            await s.sendReliable(text)
            pushOperation('data', `Outgoing reliable message: ${text}`, 'message:out-reliable')
        },
        [pushOperation],
    )

    const reconnectSoft = useCallback(async () => {
        const s = signalerRef.current
        if (!s) throw new Error('[rtc-react] Not connected')
        dispatch({ type: 'SET_LAST_ERROR', error: undefined })
        pushOperation('webrtc', 'Soft reconnect requested', 'reconnect:soft')
        await s.reconnectSoft()
    }, [pushOperation])

    const reconnectHard = useCallback(
        async (opts?: { awaitReadyMs?: number }) => {
            const s = signalerRef.current
            if (!s) throw new Error('[rtc-react] Not connected')
            dispatch({ type: 'SET_LAST_ERROR', error: undefined })
            pushOperation('webrtc', 'Hard reconnect requested', 'reconnect:hard')
            await s.reconnectHard(opts)
        },
        [pushOperation],
    )

    const overallStatus = useMemo(() => toOverallStatus(state), [state])
    const overallStatusText = useMemo(
        () => toOverallStatusText(state, overallStatus),
        [state, overallStatus],
    )

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
            overallStatus,
            overallStatusText,
            operationLog,
            clearOperationLog,
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
            overallStatus,
            overallStatusText,
            operationLog,
            clearOperationLog,
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
            {state.booting && renderLoading}
            {state.bootError && renderBootError?.(state.bootError)}
            {children}
        </Ctx.Provider>
    )
}

export function useVibeRTC() {
    const ctx = useContext(Ctx)
    if (!ctx) throw new Error('VibeRTCProvider missing')
    return ctx
}
