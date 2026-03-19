import {
    type ConnectionStrategy,
    type DebugState,
    RTCSignaler,
    type SignalDB,
} from '@vibe-rtc/rtc-core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVibeRTCRuntimeContextOptional } from './context'
import { mapPcState, normalizeError } from './state'
import type {
    ConnectionStatus,
    InviteDrivenVibeRTCResult,
    RoomInvite,
    UseVibeRTCOptions,
    VibeRTCError,
    VibeRTCOperationLogEntry,
    VibeRTCOperationScope,
    VibeRTCOverallStatus,
    VibeRTCRuntimeContextValue,
} from './types'

type NormalizedSemanticOptions = {
    role: 'caller' | 'callee'
    invite: RoomInvite | null
    connectionStrategy?: ConnectionStrategy
    autoStart: boolean
    autoCreate: boolean
    debug: boolean
    logMessages: boolean
    hasOnPing: boolean
    hasOnTakenOver: boolean
    hasFastSubscriber: boolean
    hasReliableSubscriber: boolean
}

type ActiveSessionMeta = {
    source: 'invite' | 'create'
    role: 'caller' | 'callee'
    roomId: string
    connectionStrategy: ConnectionStrategy
    diagnosticsEnabled: boolean
    pingEnabled: boolean
}

const DEFAULT_CONNECTION_STRATEGY: ConnectionStrategy = 'LAN_FIRST'
const MAX_OPERATION_LOG_SIZE = 200

const createFallbackSessionId = () => {
    const randomPart = Math.random().toString(36).slice(2, 10)
    return `session-${Date.now().toString(36)}-${randomPart}`
}

const normalizeInvite = (invite?: RoomInvite | null): RoomInvite | null => {
    if (!invite) return null
    const roomId = invite.roomId.trim()
    if (!roomId) return null
    const rawSessionId = typeof invite.sessionId === 'string' ? invite.sessionId.trim() : ''
    return {
        roomId,
        sessionId: rawSessionId || undefined,
        connectionStrategy: invite.connectionStrategy,
    }
}

const isSameInvite = (a: RoomInvite | null, b: RoomInvite | null): boolean => {
    if (a === b) return true
    if (!a || !b) return false
    return (
        a.roomId === b.roomId &&
        (a.sessionId ?? undefined) === (b.sessionId ?? undefined) &&
        a.connectionStrategy === b.connectionStrategy
    )
}

const isSameInviteHandle = (a: RoomInvite | null, b: RoomInvite | null): boolean => {
    if (!a || !b) return false
    return a.roomId === b.roomId && a.connectionStrategy === b.connectionStrategy
}

const toJoinUrl = (invite: RoomInvite | null): string | null => {
    if (!invite) return null
    if (typeof window === 'undefined' || !window.location) return null
    const encodedInvite = encodeURIComponent(JSON.stringify(invite))
    return `${window.location.origin}${window.location.pathname}?invite=${encodedInvite}`
}

const normalizeSemanticOptions = (options: UseVibeRTCOptions): NormalizedSemanticOptions => {
    return {
        role: options.role,
        invite: normalizeInvite(options.invite),
        connectionStrategy: options.connectionStrategy,
        autoStart: options.autoStart ?? true,
        autoCreate: options.autoCreate ?? false,
        debug: options.debug ?? false,
        logMessages: options.logMessages ?? false,
        hasOnPing: typeof options.onPing === 'function',
        hasOnTakenOver: typeof options.onTakenOver === 'function',
        hasFastSubscriber: typeof options.onFastMessage === 'function',
        hasReliableSubscriber: typeof options.onReliableMessage === 'function',
    }
}

const resolveRoleSessionId = (
    signalDb: SignalDB,
    role: 'caller' | 'callee',
    fallbackSessionId?: string | null,
): string => {
    const withRoleSession = signalDb as SignalDB & {
        getRoleSessionId?: (targetRole: 'caller' | 'callee') => string | null
    }
    const roleSessionId = withRoleSession.getRoleSessionId?.(role)
    if (typeof roleSessionId === 'string') {
        const normalized = roleSessionId.trim()
        if (normalized) return normalized
    }
    const fallback = fallbackSessionId?.trim()
    if (fallback) return fallback
    return createFallbackSessionId()
}

const toOperationScope = (event?: string): VibeRTCOperationScope => {
    if (!event) return 'system'
    const loweredEvent = event.toLowerCase()
    if (loweredEvent.includes('error')) return 'error'
    if (
        loweredEvent.includes('offer') ||
        loweredEvent.includes('answer') ||
        loweredEvent.includes('negotiation') ||
        loweredEvent.includes('epoch') ||
        loweredEvent.includes('joinroom') ||
        loweredEvent.includes('createroom')
    ) {
        return 'signaling'
    }
    if (loweredEvent.includes('dc') || loweredEvent.includes('selected-path')) return 'data'
    if (
        loweredEvent.includes('ice') ||
        loweredEvent.includes('connection') ||
        loweredEvent.includes('connected') ||
        loweredEvent.includes('phase') ||
        loweredEvent.includes('pc')
    ) {
        return 'webrtc'
    }
    return 'system'
}

const toDebugLogLine = (state: DebugState): string => {
    const event = state.lastEvent ?? 'debug'
    return [
        event,
        `phase=${state.phase}`,
        `pc=${state.pcState}`,
        `ice=${state.iceState}`,
        `icePhase=${state.icePhase}`,
        `gen=${state.pcGeneration}`,
    ].join(' | ')
}

const describeDebugEvent = (debugState?: DebugState): string | undefined => {
    const event = debugState?.lastEvent
    if (!event) return undefined
    if (event.startsWith('phase-transition:LAN->STUN')) {
        return 'LAN-first did not complete in time, switching to STUN fallback.'
    }
    if (event.startsWith('phase-transition:LAN->TURN_ENABLED')) {
        return 'LAN-first did not complete in time, enabling TURN fallback.'
    }
    if (event.startsWith('phase-transition:STUN_ONLY->TURN_ENABLED')) {
        return 'STUN-only did not connect in time, enabling TURN fallback.'
    }
    if (event === 'phase=LAN') return 'LAN-first phase is active. Collecting host candidates.'
    if (event === 'phase=STUN_ONLY')
        return 'STUN-only phase is active. Collecting srflx candidates.'
    if (event === 'phase=TURN_ENABLED') {
        return 'TURN-enabled phase is active. Using TURN server candidates only.'
    }
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

const toOverallStatus = (args: {
    status: ConnectionStatus
    invite: RoomInvite | null
    lastError?: VibeRTCError
}): VibeRTCOverallStatus => {
    if (args.lastError) return 'error'
    if (args.status === 'connecting') return 'connecting'
    if (args.status === 'disconnected' && args.invite) return 'connecting'
    if (args.status === 'connected') return 'connected'
    return 'none'
}

const toOverallStatusText = (args: {
    status: ConnectionStatus
    overallStatus: VibeRTCOverallStatus
    invite: RoomInvite | null
    lastError?: VibeRTCError
    debugState?: DebugState
}): string => {
    if (args.lastError) {
        return `${args.lastError.code ? `${args.lastError.code}: ` : ''}${args.lastError.message}`
    }
    if (args.overallStatus === 'none') {
        return args.invite
            ? 'Room selected. Ready to establish transport.'
            : 'No active connection. Pass invite or enable caller auto-create.'
    }
    if (args.overallStatus === 'connected') {
        const route = args.debugState?.netRtt?.route
        if (route) {
            const localType = route.localCandidateType ?? 'unknown'
            const remoteType = route.remoteCandidateType ?? 'unknown'
            const pathLabel = route.isRelay ? 'TURN/relay' : 'direct'
            return `Connected via ${pathLabel} route (${localType} -> ${remoteType}).`
        }
        const path = args.debugState?.selectedPath
        if (path && path !== 'unknown') return `Connected via ${path.toUpperCase()} candidate path.`
        return 'Connected. Fast and reliable channels are ready.'
    }
    const fromDebug = describeDebugEvent(args.debugState)
    if (fromDebug) return fromDebug
    if (args.status === 'disconnected') return 'Connection lost. Re-establishing transport.'
    return 'Establishing signaling and WebRTC transport.'
}

export function useVibeRTCSession(options: UseVibeRTCOptions): InviteDrivenVibeRTCResult {
    const runtimeContext = useVibeRTCRuntimeContextOptional()
    if (!runtimeContext) throw new Error('VibeRTCProvider missing')
    const runtime: VibeRTCRuntimeContextValue = runtimeContext

    const semantic = useMemo(() => normalizeSemanticOptions(options), [options])

    const callbacksRef = useRef({
        onPing: options?.onPing,
        onTakenOver: options?.onTakenOver,
        onFastMessage: options?.onFastMessage,
        onReliableMessage: options?.onReliableMessage,
        onError: options?.onError,
    })
    callbacksRef.current = {
        onPing: options?.onPing,
        onTakenOver: options?.onTakenOver,
        onFastMessage: options?.onFastMessage,
        onReliableMessage: options?.onReliableMessage,
        onError: options?.onError,
    }

    const semanticRef = useRef<NormalizedSemanticOptions>(semantic)
    semanticRef.current = semantic
    const semanticTrigger = useMemo(
        () =>
            JSON.stringify({
                role: semantic.role,
                roomId: semantic.invite?.roomId ?? '',
                sessionId: semantic.invite?.sessionId ?? '',
                inviteStrategy: semantic.invite?.connectionStrategy ?? '',
                connectionStrategy: semantic.connectionStrategy,
                autoStart: semantic.autoStart,
                autoCreate: semantic.autoCreate,
                debug: semantic.debug,
                logMessages: semantic.logMessages,
                hasOnPing: semantic.hasOnPing,
                hasOnTakenOver: semantic.hasOnTakenOver,
                hasFastSubscriber: semantic.hasFastSubscriber,
                hasReliableSubscriber: semantic.hasReliableSubscriber,
            }),
        [
            semantic.role,
            semantic.invite?.roomId,
            semantic.invite?.sessionId,
            semantic.invite?.connectionStrategy,
            semantic.connectionStrategy,
            semantic.autoStart,
            semantic.autoCreate,
            semantic.debug,
            semantic.logMessages,
            semantic.hasOnPing,
            semantic.hasOnTakenOver,
            semantic.hasFastSubscriber,
            semantic.hasReliableSubscriber,
        ],
    )

    const signalerRef = useRef<RTCSignaler | null>(null)
    const activeMetaRef = useRef<ActiveSessionMeta | null>(null)
    const runModeRef = useRef<'none' | 'auto' | 'manual'>('none')
    const syncTicketRef = useRef(0)
    const syncQueueRef = useRef<Promise<void>>(Promise.resolve())
    const messageHandlerUnsubRef = useRef<(() => void) | null>(null)
    const debugHandlerUnsubRef = useRef<(() => void) | null>(null)
    const lastDebugKeyRef = useRef<string | null>(null)
    const lastTakeoverKeyRef = useRef<string | null>(null)

    const [status, setStatusState] = useState<ConnectionStatus>('idle')
    const statusRef = useRef<ConnectionStatus>('idle')
    const setStatus = useCallback((next: ConnectionStatus) => {
        if (statusRef.current === next) return
        statusRef.current = next
        setStatusState(next)
    }, [])

    const [invite, setInviteState] = useState<RoomInvite | null>(semantic.invite)
    const inviteRef = useRef<RoomInvite | null>(semantic.invite)
    const setInvite = useCallback((next: RoomInvite | null) => {
        if (isSameInvite(inviteRef.current, next)) return
        inviteRef.current = next
        setInviteState(next)
    }, [])

    const [lastError, setLastErrorState] = useState<VibeRTCError | undefined>(undefined)
    const [debugState, setDebugState] = useState<DebugState | undefined>(undefined)
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
        setOperationLog([])
    }, [])

    const pushOperationIfEnabled = useCallback(
        (scope: VibeRTCOperationScope, message: string, event?: string) => {
            const currentSemantic = semanticRef.current
            if (!currentSemantic.debug && !currentSemantic.logMessages) return
            pushOperation(scope, message, event)
        },
        [pushOperation],
    )

    const clearDynamicHandlers = useCallback(() => {
        if (messageHandlerUnsubRef.current) {
            messageHandlerUnsubRef.current()
            messageHandlerUnsubRef.current = null
        }
        if (debugHandlerUnsubRef.current) {
            debugHandlerUnsubRef.current()
            debugHandlerUnsubRef.current = null
        }
        lastDebugKeyRef.current = null
        lastTakeoverKeyRef.current = null
    }, [])

    const syncDynamicHandlers = useCallback(() => {
        const signaler = signalerRef.current
        const currentSemantic = semanticRef.current
        if (!signaler) return

        const shouldHandleMessages =
            currentSemantic.logMessages ||
            currentSemantic.hasFastSubscriber ||
            currentSemantic.hasReliableSubscriber

        if (shouldHandleMessages && !messageHandlerUnsubRef.current) {
            messageHandlerUnsubRef.current = signaler.setMessageHandler((text, meta) => {
                const latestSemantic = semanticRef.current
                if (!latestSemantic) return
                if (latestSemantic.logMessages) {
                    const streamLabel = meta?.reliable ? 'reliable' : 'fast'
                    console.info(`[rtc-react] inbound:${streamLabel}`, text)
                    pushOperation(
                        'data',
                        `Incoming ${streamLabel} message: ${text}`,
                        `message:${streamLabel}`,
                    )
                }
                if (meta?.reliable) {
                    callbacksRef.current.onReliableMessage?.(text)
                    return
                }
                callbacksRef.current.onFastMessage?.(text)
            })
        }

        if (!shouldHandleMessages && messageHandlerUnsubRef.current) {
            messageHandlerUnsubRef.current()
            messageHandlerUnsubRef.current = null
        }

        const shouldHandleDebug =
            currentSemantic.debug ||
            currentSemantic.logMessages ||
            currentSemantic.hasOnPing ||
            currentSemantic.hasOnTakenOver

        if (shouldHandleDebug && !debugHandlerUnsubRef.current) {
            debugHandlerUnsubRef.current = signaler.setDebugHandler((debugState) => {
                const latestSemantic = semanticRef.current
                if (!latestSemantic) return

                if (latestSemantic.hasOnPing) {
                    callbacksRef.current.onPing?.(debugState.ping)
                }

                if (latestSemantic.hasOnTakenOver && debugState.lastEvent === 'takeover-detected') {
                    const takeoverDebugState = debugState as DebugState & {
                        takeoverBySessionId?: string | null
                    }
                    const bySessionIdRaw =
                        typeof takeoverDebugState.takeoverBySessionId === 'string'
                            ? takeoverDebugState.takeoverBySessionId.trim()
                            : ''
                    const roomId = debugState.roomId?.trim() ?? ''
                    if (roomId) {
                        const takeoverKey = [
                            roomId,
                            debugState.role,
                            bySessionIdRaw || 'none',
                            String(debugState.pcGeneration),
                        ].join('|')
                        if (lastTakeoverKeyRef.current !== takeoverKey) {
                            lastTakeoverKeyRef.current = takeoverKey
                            callbacksRef.current.onTakenOver?.({
                                roomId,
                                role: debugState.role,
                                bySessionId: bySessionIdRaw || undefined,
                            })
                        }
                    }
                }

                if (latestSemantic.debug || latestSemantic.logMessages) {
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
                    if (lastDebugKeyRef.current !== debugKey) {
                        lastDebugKeyRef.current = debugKey
                        if (latestSemantic.debug) {
                            setDebugState(debugState)
                        }
                        if (latestSemantic.logMessages) {
                            pushOperation(
                                toOperationScope(debugState.lastEvent),
                                toDebugLogLine(debugState),
                                debugState.lastEvent,
                            )
                        }
                    }
                }

                if (latestSemantic.debug && latestSemantic.logMessages) {
                    const eventLabel = debugState.lastEvent ?? 'debug'
                    console.info(`[rtc-react] debug:${eventLabel}`, debugState)
                }
            })
        }

        if (!shouldHandleDebug && debugHandlerUnsubRef.current) {
            debugHandlerUnsubRef.current()
            debugHandlerUnsubRef.current = null
            lastDebugKeyRef.current = null
            lastTakeoverKeyRef.current = null
            setDebugState(undefined)
        }
    }, [pushOperation])

    const disposeCurrentSignaler = useCallback(async () => {
        clearDynamicHandlers()
        const signaler = signalerRef.current
        signalerRef.current = null
        activeMetaRef.current = null
        setDebugState(undefined)
        if (!signaler) return
        try {
            await signaler.hangup()
        } catch {}
    }, [clearDynamicHandlers])

    const createAndConfigureSignaler = useCallback(
        async (
            role: 'caller' | 'callee',
            connectionStrategy: ConnectionStrategy,
            currentSemantic: NormalizedSemanticOptions,
        ) => {
            const signalDb = await runtime.getSignalDB()
            const enableDebug = currentSemantic.debug || currentSemantic.logMessages
            const enablePing = currentSemantic.hasOnPing
            const signaler = new RTCSignaler(role, signalDb, {
                rtcConfiguration: runtime.rtcConfiguration,
                connectionStrategy,
                lanFirstTimeoutMs: runtime.lanFirstTimeoutMs,
                pingIntervalMs: enablePing ? runtime.pingIntervalMs : 0,
                pingWindowSize: enablePing ? runtime.pingWindowSize : undefined,
                netRttIntervalMs: enableDebug ? runtime.netRttIntervalMs : 0,
                debug: enableDebug,
            })

            signaler.setConnectionStateHandler((pcState) => {
                const mappedStatus = mapPcState(pcState)
                setStatus(mappedStatus === 'booting' ? 'connecting' : mappedStatus)
                if (pcState === 'connected') setLastErrorState(undefined)
            })
            signaler.setFastOpenHandler(() => {
                setStatus('connected')
            })
            signaler.setReliableOpenHandler(() => {
                setStatus('connected')
            })
            signaler.setFastCloseHandler(() => {
                setStatus('disconnected')
            })
            signaler.setReliableCloseHandler(() => {
                setStatus('disconnected')
            })
            signaler.setErrorHandler((error) => {
                const normalized = normalizeError(error)
                setLastErrorState(normalized)
                setStatus('error')
                pushOperationIfEnabled(
                    'error',
                    `${normalized.code ? `${normalized.code}: ` : ''}${normalized.message}`,
                    'signaler:error',
                )
                callbacksRef.current.onError?.(normalized)
            })

            signalerRef.current = signaler
            syncDynamicHandlers()

            return { signaler, signalDb }
        },
        [runtime, setStatus, syncDynamicHandlers, pushOperationIfEnabled],
    )

    const shouldRestartForTarget = useCallback(
        (
            target:
                | { type: 'none' }
                | { type: 'create'; connectionStrategy: ConnectionStrategy }
                | { type: 'join'; invite: RoomInvite },
            currentSemantic: NormalizedSemanticOptions,
        ): boolean => {
            const active = activeMetaRef.current
            if (!active) return true
            if (active.role !== currentSemantic.role) return true
            if (
                active.diagnosticsEnabled !== (currentSemantic.debug || currentSemantic.logMessages)
            ) {
                return true
            }
            if (active.pingEnabled !== currentSemantic.hasOnPing) return true
            if (target.type === 'none') return true
            if (target.type === 'create') {
                return (
                    active.source !== 'create' ||
                    active.connectionStrategy !== target.connectionStrategy
                )
            }
            return (
                active.source !== 'invite' ||
                active.roomId !== target.invite.roomId ||
                active.connectionStrategy !== target.invite.connectionStrategy
            )
        },
        [],
    )

    const syncLatest = useCallback(
        async (ticket: number) => {
            const currentSemantic = semanticRef.current

            if (runModeRef.current === 'none') {
                if (currentSemantic.autoStart) runModeRef.current = 'auto'
            } else if (runModeRef.current === 'auto' && !currentSemantic.autoStart) {
                runModeRef.current = 'none'
            }

            const shouldRun = runModeRef.current !== 'none'
            if (!shouldRun) {
                await disposeCurrentSignaler()
                if (ticket !== syncTicketRef.current) return
                setStatus('idle')
                if (currentSemantic.invite) setInvite(currentSemantic.invite)
                else if (activeMetaRef.current?.source !== 'create') setInvite(null)
                return
            }

            const target:
                | { type: 'none' }
                | { type: 'create'; connectionStrategy: ConnectionStrategy }
                | { type: 'join'; invite: RoomInvite } = currentSemantic.invite
                ? { type: 'join', invite: currentSemantic.invite }
                : currentSemantic.role === 'caller' && currentSemantic.autoCreate
                  ? {
                        type: 'create',
                        connectionStrategy:
                            currentSemantic.connectionStrategy ??
                            runtime.connectionStrategy ??
                            DEFAULT_CONNECTION_STRATEGY,
                    }
                  : { type: 'none' }

            if (target.type === 'none') {
                await disposeCurrentSignaler()
                if (ticket !== syncTicketRef.current) return
                setStatus('idle')
                setInvite(currentSemantic.invite)
                return
            }

            const restartNeeded = shouldRestartForTarget(target, currentSemantic)
            if (!restartNeeded && signalerRef.current) {
                syncDynamicHandlers()
                if (
                    target.type === 'join' &&
                    target.invite.sessionId &&
                    isSameInviteHandle(inviteRef.current, target.invite) &&
                    inviteRef.current?.sessionId !== target.invite.sessionId
                ) {
                    setInvite({
                        roomId: target.invite.roomId,
                        sessionId: target.invite.sessionId,
                        connectionStrategy: target.invite.connectionStrategy,
                    })
                }
                return
            }

            await disposeCurrentSignaler()
            if (ticket !== syncTicketRef.current) return

            setStatus('connecting')
            setLastErrorState(undefined)

            try {
                if (target.type === 'join') {
                    const { signaler, signalDb } = await createAndConfigureSignaler(
                        currentSemantic.role,
                        target.invite.connectionStrategy,
                        currentSemantic,
                    )
                    if (ticket !== syncTicketRef.current) {
                        await signaler.hangup().catch(() => {})
                        return
                    }
                    await signaler.joinRoom(target.invite.roomId)
                    if (ticket !== syncTicketRef.current) {
                        await signaler.hangup().catch(() => {})
                        return
                    }
                    await signaler.connect()
                    if (ticket !== syncTicketRef.current) {
                        await signaler.hangup().catch(() => {})
                        return
                    }

                    const effectiveInvite: RoomInvite = {
                        roomId: target.invite.roomId,
                        sessionId: resolveRoleSessionId(
                            signalDb,
                            currentSemantic.role,
                            target.invite.sessionId,
                        ),
                        connectionStrategy: target.invite.connectionStrategy,
                    }
                    setInvite(effectiveInvite)
                    activeMetaRef.current = {
                        source: 'invite',
                        role: currentSemantic.role,
                        roomId: effectiveInvite.roomId,
                        connectionStrategy: effectiveInvite.connectionStrategy,
                        diagnosticsEnabled: currentSemantic.debug || currentSemantic.logMessages,
                        pingEnabled: currentSemantic.hasOnPing,
                    }
                    return
                }

                const { signaler, signalDb } = await createAndConfigureSignaler(
                    currentSemantic.role,
                    target.connectionStrategy,
                    currentSemantic,
                )
                if (ticket !== syncTicketRef.current) {
                    await signaler.hangup().catch(() => {})
                    return
                }

                const roomId = await signaler.createRoom()
                if (ticket !== syncTicketRef.current) {
                    await signaler.hangup().catch(() => {})
                    return
                }

                await signaler.connect()
                if (ticket !== syncTicketRef.current) {
                    await signaler.hangup().catch(() => {})
                    return
                }

                const effectiveInvite: RoomInvite = {
                    roomId,
                    sessionId: resolveRoleSessionId(signalDb, currentSemantic.role),
                    connectionStrategy: target.connectionStrategy,
                }
                setInvite(effectiveInvite)
                activeMetaRef.current = {
                    source: 'create',
                    role: currentSemantic.role,
                    roomId: effectiveInvite.roomId,
                    connectionStrategy: effectiveInvite.connectionStrategy,
                    diagnosticsEnabled: currentSemantic.debug || currentSemantic.logMessages,
                    pingEnabled: currentSemantic.hasOnPing,
                }
            } catch (error) {
                const normalized = normalizeError(error)
                setLastErrorState(normalized)
                setStatus('error')
                pushOperationIfEnabled(
                    'error',
                    `${normalized.code ? `${normalized.code}: ` : ''}${normalized.message}`,
                    'session:error',
                )
                callbacksRef.current.onError?.(normalized)
            }
        },
        [
            runtime,
            createAndConfigureSignaler,
            disposeCurrentSignaler,
            setInvite,
            setStatus,
            shouldRestartForTarget,
            syncDynamicHandlers,
            pushOperationIfEnabled,
        ],
    )

    const enqueueSync = useCallback(async () => {
        const ticket = ++syncTicketRef.current
        const run = async () => {
            if (ticket !== syncTicketRef.current) return
            await syncLatest(ticket)
        }
        syncQueueRef.current = syncQueueRef.current.then(run, run)
        await syncQueueRef.current
    }, [syncLatest])

    const enqueueSyncRef = useRef(enqueueSync)
    enqueueSyncRef.current = enqueueSync

    useEffect(() => {
        void semanticTrigger
        void enqueueSyncRef.current()
    }, [semanticTrigger])

    useEffect(() => {
        return () => {
            runModeRef.current = 'none'
            syncTicketRef.current += 1
            void disposeCurrentSignaler()
        }
    }, [disposeCurrentSignaler])

    const start = useCallback(async () => {
        runModeRef.current = 'manual'
        await enqueueSync()
    }, [enqueueSync])

    const stop = useCallback(async () => {
        runModeRef.current = 'none'
        await enqueueSync()
    }, [enqueueSync])

    const endRoom = useCallback(async () => {
        const signaler = signalerRef.current
        if (!signaler) throw new Error('[rtc-react] Not connected')
        await signaler.endRoom()
        runModeRef.current = 'none'
        await disposeCurrentSignaler()
        setStatus('idle')
        setInvite(null)
    }, [disposeCurrentSignaler, setStatus, setInvite])

    const sendFast = useCallback(async (text: string) => {
        const signaler = signalerRef.current
        if (!signaler) throw new Error('[rtc-react] Not connected')
        await signaler.sendFast(text)
    }, [])

    const sendReliable = useCallback(async (text: string) => {
        const signaler = signalerRef.current
        if (!signaler) throw new Error('[rtc-react] Not connected')
        await signaler.sendReliable(text)
    }, [])

    const reconnectSoft = useCallback(async () => {
        const signaler = signalerRef.current
        if (!signaler) throw new Error('[rtc-react] Not connected')
        await signaler.reconnectSoft()
    }, [])

    const reconnectHard = useCallback(async (opts?: { awaitReadyMs?: number }) => {
        const signaler = signalerRef.current
        if (!signaler) throw new Error('[rtc-react] Not connected')
        await signaler.reconnectHard(opts)
    }, [])

    const overallStatus = useMemo(
        () => toOverallStatus({ status, invite, lastError }),
        [status, invite, lastError],
    )

    const overallStatusText = useMemo(
        () => toOverallStatusText({ status, overallStatus, invite, lastError, debugState }),
        [status, overallStatus, invite, lastError, debugState],
    )

    return useMemo(
        () => ({
            invite,
            joinUrl: toJoinUrl(invite),
            status,
            overallStatus,
            overallStatusText,
            lastError,
            debugState,
            operationLog,
            clearOperationLog,
            start,
            stop,
            endRoom,
            sendFast,
            sendReliable,
            reconnectSoft,
            reconnectHard,
        }),
        [
            invite,
            status,
            overallStatus,
            overallStatusText,
            lastError,
            debugState,
            operationLog,
            clearOperationLog,
            start,
            stop,
            endRoom,
            sendFast,
            sendReliable,
            reconnectSoft,
            reconnectHard,
        ],
    )
}
