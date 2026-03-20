import { type RoomInvite, useVibeRTCSession } from '@vibe-rtc/rtc-react'
import { useCallback, useMemo, useReducer } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Credits } from '@/features/demo/components/Credits'
import { MessageComposer } from '@/features/demo/components/MessageComposer'
import { OperationLog } from '@/features/demo/components/OperationLog'
import { SessionHeader } from '@/features/demo/components/session/SessionHeader'
import { SessionOverlays } from '@/features/demo/components/session/SessionOverlays'
import { SharedCanvasModal } from '@/features/demo/features/sharedCanvas/components/SharedCanvasModal'
import { useSharedCanvas } from '@/features/demo/features/sharedCanvas/hooks/useSharedCanvas'
import { useSessionActions } from '@/features/demo/hooks/useSessionActions'
import { useSessionConnectProgress } from '@/features/demo/hooks/useSessionConnectProgress'
import { useSessionModalState } from '@/features/demo/hooks/useSessionModalState'
import { useSessionNetworkWarning } from '@/features/demo/hooks/useSessionNetworkWarning'
import { useSessionQrCode } from '@/features/demo/hooks/useSessionQrCode'
import { useSessionTracing } from '@/features/demo/hooks/useSessionTracing'
import { resolveLatencyTone } from '@/features/demo/model/latency'
import { DEMO_ROUTE_PATHS, DEMO_ROUTE_QUERY_KEYS } from '@/features/demo/model/routePaths'
import { toCalleeUrl, toRouteStrategyMode } from '@/features/demo/model/routes'
import {
    isRoomNotFoundError,
    isTakeoverError,
    toPingMs,
} from '@/features/demo/model/sessionDiagnostics'
import {
    isChannelMessage,
    selectVisibleLog,
    sortOperationLog,
} from '@/features/demo/model/sessionLog'
import {
    sessionActions,
    sessionInitialState,
    sessionReducer,
} from '@/features/demo/model/sessionReducer'
import type { AttachRole, RouteStrategyMode } from '@/features/demo/model/types'
import { AppButton } from '@/shared/ui/AppButton'

const NOOP_PING_HANDLER = () => {}

export function SessionPage() {
    const params = useParams<{ role: string; roomId: string }>()
    const [searchParams] = useSearchParams()
    const [state, dispatch] = useReducer(sessionReducer, sessionInitialState)

    const role: AttachRole | null =
        params.role === 'caller' || params.role === 'callee' ? params.role : null
    const roomId = (params.roomId ?? '').trim()
    const isRouteValid = Boolean(role && roomId)

    const routeRole: AttachRole = role ?? 'caller'
    const routeRoomId = roomId

    const strategyMode: RouteStrategyMode = toRouteStrategyMode(
        searchParams.get(DEMO_ROUTE_QUERY_KEYS.strategy),
    )
    const inviteSessionId = (searchParams.get(DEMO_ROUTE_QUERY_KEYS.sessionId) ?? '').trim()
    const invite = useMemo<RoomInvite | null>(() => {
        if (!isRouteValid) return null
        return {
            roomId: routeRoomId,
            sessionId: inviteSessionId || undefined,
            connectionStrategy: strategyMode === 'native' ? 'BROWSER_NATIVE' : 'LAN_FIRST',
        }
    }, [inviteSessionId, isRouteValid, routeRoomId, strategyMode])

    const setRoomNotFoundModalOpen = useCallback(
        (value: boolean) => dispatch(sessionActions.setRoomNotFoundModalOpen(value)),
        [],
    )
    const setRoomOccupiedModalOpen = useCallback(
        (value: boolean) => dispatch(sessionActions.setRoomOccupiedModalOpen(value)),
        [],
    )
    const setTakeoverModalOpen = useCallback(
        (value: boolean) => dispatch(sessionActions.setTakeoverModalOpen(value)),
        [],
    )
    const setSecurityTakeoverDetected = useCallback(
        (value: boolean) => dispatch(sessionActions.setSecurityTakeoverDetected(value)),
        [],
    )
    const setTakeoverBySessionId = useCallback(
        (value: string | null) => dispatch(sessionActions.setTakeoverBySessionId(value)),
        [],
    )
    const setQrModalOpen = useCallback(
        (value: boolean) => dispatch(sessionActions.setQrModalOpen(value)),
        [],
    )
    const setCalleeQrDataUrl = useCallback(
        (value: string) => dispatch(sessionActions.setCalleeQrDataUrl(value)),
        [],
    )
    const setConnectProgressRatio = useCallback(
        (value: number) => dispatch(sessionActions.setConnectProgressRatio(value)),
        [],
    )
    const tickConnectProgress = useCallback(
        (step: number, max: number) => dispatch(sessionActions.tickConnectProgress(step, max)),
        [],
    )
    const setNetWarning = useCallback(
        (value: typeof state.netWarning) => dispatch(sessionActions.setNetWarning(value)),
        [],
    )
    const sharedCanvas = useSharedCanvas({ role: routeRole })

    const handleFastMessage = useCallback(
        (message: string) => {
            sharedCanvas.handleIncomingFastMessage(message)
        },
        [sharedCanvas.handleIncomingFastMessage],
    )

    const handleTakenOver = useCallback(
        (payload: { bySessionId?: string }) => {
            setTakeoverBySessionId(payload.bySessionId?.trim() || null)
            setSecurityTakeoverDetected(true)
            setTakeoverModalOpen(true)
        },
        [setSecurityTakeoverDetected, setTakeoverBySessionId, setTakeoverModalOpen],
    )

    const rtc = useVibeRTCSession({
        role: routeRole,
        invite,
        autoStart: isRouteValid,
        autoCreate: false,
        debug: true,
        logMessages: true,
        onPing: NOOP_PING_HANDLER,
        onTakenOver: handleTakenOver,
        onFastMessage: handleFastMessage,
    })

    useSessionTracing({
        rtc,
        role: routeRole,
        roomId: routeRoomId,
    })

    const fastState = rtc.debugState?.fast?.state
    const reliableState = rtc.debugState?.reliable?.state
    const fastReady = fastState === 'open' || (rtc.overallStatus === 'connected' && !fastState)
    const reliableReady =
        reliableState === 'open' || (rtc.overallStatus === 'connected' && !reliableState)
    const channelReadyForMessages = fastReady || reliableReady

    const appSmoothedPing = rtc.debugState?.ping?.smoothedRttMs
    const appLastPing = rtc.debugState?.ping?.lastRttMs
    const appPingMs = toPingMs(typeof appSmoothedPing === 'number' ? appSmoothedPing : appLastPing)

    const netRttMs = toPingMs(rtc.debugState?.netRtt?.rttMs)
    const selectedRoute = rtc.debugState?.netRtt?.route
    const isRelayRoute = selectedRoute?.isRelay === true
    const netLatencyTone = resolveLatencyTone(netRttMs)

    const calleeUrl = useMemo(() => {
        if (routeRole !== 'caller') return ''
        return toCalleeUrl(routeRoomId, strategyMode)
    }, [routeRole, routeRoomId, strategyMode])

    useSessionQrCode({
        calleeUrl,
        onChange: setCalleeQrDataUrl,
    })

    useSessionConnectProgress({
        channelReadyForMessages,
        overallStatus: rtc.overallStatus,
        setConnectProgressRatio,
        tickConnectProgress,
    })

    useSessionNetworkWarning({
        isRelayRoute,
        netRttMs,
        netWarning: state.netWarning,
        setNetWarning,
    })

    const takeoverError = isTakeoverError(rtc.lastError?.message, rtc.lastError?.code)
    const roomNotFound = isRoomNotFoundError(rtc.lastError?.message, rtc.lastError?.code)

    useSessionModalState({
        role: routeRole,
        roomId: routeRoomId,
        isRoomNotFoundError: roomNotFound,
        isTakeoverError: takeoverError,
        takeoverModalOpen: state.takeoverModalOpen,
        channelReadyForMessages,
        setRoomNotFoundModalOpen,
        setTakeoverModalOpen,
        setSecurityTakeoverDetected,
        setTakeoverBySessionId,
        setQrModalOpen,
    })

    const orderedLog = useMemo(() => sortOperationLog(rtc.operationLog), [rtc.operationLog])
    const visibleLog = useMemo(
        () => selectVisibleLog(orderedLog, state.hideConnectionMessages),
        [orderedLog, state.hideConnectionMessages],
    )

    const hasMessage = state.messageText.trim().length > 0

    const { backToMain, closeSessionAndReturnMain, sendFast, sendReliable } = useSessionActions({
        rtc,
        dispatch,
        role: routeRole,
        leavePending: state.leavePending,
        removeRoomOnLeave: state.removeRoomOnLeave,
        messageText: state.messageText,
    })
    const openCanvas = useCallback(() => {
        sharedCanvas.openFromLocal(rtc.sendFast)
    }, [rtc.sendFast, sharedCanvas.openFromLocal])
    const closeCanvas = useCallback(() => {
        sharedCanvas.closeFromLocal(rtc.sendFast)
    }, [rtc.sendFast, sharedCanvas.closeFromLocal])
    const clearCanvas = useCallback(() => {
        sharedCanvas.clearFromLocal(rtc.sendFast)
    }, [rtc.sendFast, sharedCanvas.clearFromLocal])
    const handleCanvasStrokeStart = useCallback(
        (point: { x: number; y: number }) => {
            sharedCanvas.startLocalStroke(rtc.sendFast, point)
        },
        [rtc.sendFast, sharedCanvas.startLocalStroke],
    )
    const handleCanvasStrokeMove = useCallback(
        (point: { x: number; y: number }) => {
            sharedCanvas.appendLocalStrokePoint(rtc.sendFast, point)
        },
        [rtc.sendFast, sharedCanvas.appendLocalStrokePoint],
    )
    const handleCanvasStrokeEnd = useCallback(() => {
        sharedCanvas.endLocalStroke(rtc.sendFast)
    }, [rtc.sendFast, sharedCanvas.endLocalStroke])

    const showQrButton =
        routeRole === 'caller' &&
        !takeoverError &&
        !state.takeoverModalOpen &&
        !channelReadyForMessages &&
        Boolean(calleeUrl)

    if (!isRouteValid) {
        return <Navigate to={DEMO_ROUTE_PATHS.home} replace />
    }

    return (
        <main className="demoShell demoShellChat" data-testid="session-page">
            <SessionOverlays
                role={routeRole}
                roomId={routeRoomId}
                isRoomNotFoundError={roomNotFound}
                isTakeoverError={takeoverError}
                roomNotFoundModalOpen={state.roomNotFoundModalOpen}
                roomOccupiedModalOpen={state.roomOccupiedModalOpen}
                takeoverModalOpen={state.takeoverModalOpen}
                securityTakeoverDetected={state.securityTakeoverDetected}
                takeoverBySessionId={state.takeoverBySessionId}
                leaveConfirmOpen={state.leaveConfirmOpen}
                leavePending={state.leavePending}
                removeRoomOnLeave={state.removeRoomOnLeave}
                qrModalOpen={state.qrModalOpen}
                channelReadyForMessages={channelReadyForMessages}
                calleeUrl={calleeUrl}
                calleeQrDataUrl={state.calleeQrDataUrl}
                onBackToMain={backToMain}
                onSetRoomNotFoundModalOpen={setRoomNotFoundModalOpen}
                onSetRoomOccupiedModalOpen={setRoomOccupiedModalOpen}
                onSetLeaveConfirmOpen={(value) =>
                    dispatch(sessionActions.setLeaveConfirmOpen(value))
                }
                onSetRemoveRoomOnLeave={(value) =>
                    dispatch(sessionActions.setRemoveRoomOnLeave(value))
                }
                onCloseSession={() => void closeSessionAndReturnMain()}
                onSetQrModalOpen={setQrModalOpen}
            />

            <section className="card chatPageCard" data-testid="session-card">
                <SessionHeader
                    role={routeRole}
                    roomId={routeRoomId}
                    netLatencyTone={netLatencyTone}
                    netRttMs={netRttMs}
                    appPingMs={appPingMs}
                    selectedRoute={selectedRoute}
                    statusText={rtc.overallStatusText}
                    statusClassName={`statusLine status-${rtc.overallStatus}`}
                    netWarningMessage={state.netWarning?.message ?? null}
                    connectProgressRatio={state.connectProgressRatio}
                    showQrButton={showQrButton}
                    qrButtonDisabled={state.qrModalOpen}
                    onShowQr={() => dispatch(sessionActions.setQrModalOpen(true))}
                    onOpenLeaveConfirm={() => {
                        dispatch(sessionActions.setRemoveRoomOnLeave(routeRole === 'caller'))
                        dispatch(sessionActions.setLeaveConfirmOpen(true))
                    }}
                />
                <div className="sessionToolRow">
                    <AppButton
                        className="canvasToggleBtn"
                        disabled={!channelReadyForMessages}
                        onClick={sharedCanvas.isOpen ? closeCanvas : openCanvas}
                        testId="shared-canvas-toggle-btn"
                    >
                        {sharedCanvas.isOpen ? 'Close Canvas' : 'Open Canvas'}
                    </AppButton>
                </div>

                <OperationLog
                    entries={visibleLog}
                    hideConnectionMessages={state.hideConnectionMessages}
                    onHideConnectionMessagesChange={(value) =>
                        dispatch(sessionActions.setHideConnectionMessages(value))
                    }
                    isChannelMessage={isChannelMessage}
                />

                <MessageComposer
                    value={state.messageText}
                    disabled={!channelReadyForMessages}
                    canSendFast={fastReady && hasMessage}
                    canSendReliable={reliableReady && hasMessage}
                    onChange={(value) => dispatch(sessionActions.setMessageText(value))}
                    onSendFast={() => void sendFast()}
                    onSendReliable={() => void sendReliable()}
                />

                <Credits />
            </section>
            <SharedCanvasModal
                isOpen={sharedCanvas.isOpen}
                strokes={sharedCanvas.strokes}
                roleColors={sharedCanvas.roleColors}
                onClose={closeCanvas}
                onClear={clearCanvas}
                onStrokeStart={handleCanvasStrokeStart}
                onStrokeMove={handleCanvasStrokeMove}
                onStrokeEnd={handleCanvasStrokeEnd}
            />
        </main>
    )
}
