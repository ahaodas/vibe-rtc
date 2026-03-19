import { useVibeRTCSession } from '@vibe-rtc/rtc-react'
import { useEffect, useReducer, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Credits } from '@/features/demo/components/Credits'
import {
    CREATE_PROGRESS_FINISH_TICK_MS,
    CREATE_PROGRESS_IDLE_STEP,
    CREATE_PROGRESS_IDLE_TICK_MS,
    CREATE_PROGRESS_MAX_BEFORE_READY,
    PROGRESS_STEP_PX,
} from '@/features/demo/model/constants'
import { homeActions, homeInitialState, homeReducer } from '@/features/demo/model/homeReducer'
import { toSessionPath } from '@/features/demo/model/routes'
import type { RouteStrategyMode } from '@/features/demo/model/types'
import { AppButton } from '@/shared/ui/AppButton'
import { AppInput } from '@/shared/ui/AppInput'
import { AppModal } from '@/shared/ui/AppModal'
import { SegmentedProgressBar } from '@/shared/ui/SegmentedProgressBar'

const NOOP_PING_HANDLER = () => {}

export function HomePage() {
    const navigate = useNavigate()
    const [state, dispatch] = useReducer(homeReducer, homeInitialState)
    const createNavigationQueuedRef = useRef(false)
    const rtc = useVibeRTCSession({
        role: 'caller',
        invite: null,
        autoStart: state.createPending,
        autoCreate: state.createPending,
        connectionStrategy: state.createStrategy === 'native' ? 'BROWSER_NATIVE' : undefined,
        debug: true,
        logMessages: true,
        onPing: NOOP_PING_HANDLER,
    })

    const normalizedJoinRoomId = state.joinRoomIdInput.trim()
    const canJoinRoom = normalizedJoinRoomId.length > 0
    const createProgressPercent = Math.round(
        Math.max(0, Math.min(1, state.createProgressRatio)) * 100,
    )

    const createRoom = (strategyMode: RouteStrategyMode) => {
        if (state.createPending) return
        dispatch(homeActions.setCreatePending(true))
        dispatch(homeActions.setCreateStrategy(strategyMode))
        dispatch(homeActions.setCreateProgressRatio(0))
    }

    useEffect(() => {
        if (!state.createPending) return
        const idleTimer = window.setInterval(() => {
            dispatch(
                homeActions.tickCreateProgress(
                    CREATE_PROGRESS_IDLE_STEP,
                    CREATE_PROGRESS_MAX_BEFORE_READY,
                ),
            )
        }, CREATE_PROGRESS_IDLE_TICK_MS)
        return () => {
            window.clearInterval(idleTimer)
        }
    }, [state.createPending])

    useEffect(() => {
        if (!state.createPending) {
            createNavigationQueuedRef.current = false
            return
        }
        const roomId = rtc.invite?.roomId?.trim()
        if (!roomId || createNavigationQueuedRef.current) return
        createNavigationQueuedRef.current = true
        const sessionId = rtc.invite?.sessionId?.trim()
        dispatch(homeActions.setCreateProgressRatio(1))
        const finishTimer = window.setTimeout(() => {
            navigate(
                toSessionPath(
                    'caller',
                    roomId,
                    state.createStrategy,
                    sessionId?.length ? sessionId : undefined,
                ),
            )
        }, CREATE_PROGRESS_FINISH_TICK_MS)
        return () => {
            window.clearTimeout(finishTimer)
        }
    }, [
        navigate,
        rtc.invite?.roomId,
        rtc.invite?.sessionId,
        state.createPending,
        state.createStrategy,
    ])

    useEffect(() => {
        if (!state.createPending) return
        if (!rtc.lastError) return
        dispatch(homeActions.resetCreateState())
    }, [state.createPending, rtc.lastError])

    const joinRoom = () => {
        if (!canJoinRoom) return

        dispatch(homeActions.setJoinModalOpen(false))
        navigate(toSessionPath('callee', normalizedJoinRoomId, 'default'))
    }

    const loadingStatusText =
        typeof rtc.overallStatusText === 'string' && rtc.overallStatusText.trim().length > 0
            ? rtc.overallStatusText
            : 'Preparing room...'

    return (
        <main className="demoShell demoShellInitial" data-testid="home-page">
            {state.joinModalOpen ? (
                <AppModal
                    title="Join Room"
                    onClose={() => dispatch(homeActions.setJoinModalOpen(false))}
                    size="leave"
                    testId="join-room-modal"
                    titleTestId="join-room-modal-title"
                >
                    <p className="appModalMessage" data-testid="join-room-modal-message">
                        Enter Room ID to attach as CALLEE.
                    </p>
                    <AppInput
                        id="join-room-id"
                        className="roomInput"
                        value={state.joinRoomIdInput}
                        onChange={(event) =>
                            dispatch(homeActions.setJoinRoomIdInput(event.target.value))
                        }
                        placeholder="Room ID"
                        testId="join-room-input"
                        onKeyDown={(event) => {
                            if (event.key !== 'Enter') return
                            event.preventDefault()
                            joinRoom()
                        }}
                    />
                    <menu className="leaveModalActions">
                        <AppButton
                            onClick={() => dispatch(homeActions.setJoinModalOpen(false))}
                            testId="join-room-cancel-btn"
                        >
                            Cancel
                        </AppButton>
                        <AppButton
                            onClick={joinRoom}
                            disabled={!canJoinRoom}
                            testId="join-room-submit-btn"
                        >
                            Join
                        </AppButton>
                    </menu>
                </AppModal>
            ) : null}

            {state.createPending ? (
                <div
                    className="appModalBackdrop"
                    aria-live="polite"
                    data-testid="create-room-overlay"
                >
                    <section className="appModal">
                        <h2 className="appModalTitle" data-testid="create-room-overlay-title">
                            Creating room...
                        </h2>
                        <p className="appModalMessage" data-testid="create-room-overlay-message">
                            {loadingStatusText}
                        </p>
                        <div
                            className="appProgressMeta"
                            data-testid="create-room-overlay-progress-meta"
                        >
                            {createProgressPercent}%
                        </div>
                        <SegmentedProgressBar
                            ratio={state.createProgressRatio}
                            stepPx={PROGRESS_STEP_PX}
                            className="cs-progress-bar appProgress"
                            testId="create-room-progress"
                            barTestId="create-room-progress-bar"
                        />
                    </section>
                </div>
            ) : null}

            <section className="card initialCard" data-testid="home-card">
                <h1 data-testid="home-title">VIBE-RTC DEMO</h1>
                <section className="initialInfo" data-testid="home-description">
                    <p className="initialInfoText">
                        This page demonstrates LAN-first WebRTC connection setup, with automatic
                        STUN fallback when direct local candidates do not connect fast enough.
                    </p>
                    <p className="initialInfoText">
                        The demo is tuned to be resilient to caller/callee page reload races: after
                        refreshes it re-attaches, re-negotiates, and restores channels.
                    </p>
                    <p className="initialInfoText">
                        How to use:
                        <br />
                        1. Press <b>Create Room</b> (LAN-first) or <b>Create Room (Native ICE)</b>.
                        <br />
                        2. Open the callee link/QR on a second device.
                        <br />
                        3. Wait until channels are ready, then send test messages with <b>Fast</b>{' '}
                        and <b>Reliable</b>.
                        <br />
                        4. Watch status, progress bars, and operation log to inspect signaling and
                        WebRTC state transitions.
                    </p>
                </section>
                <AppButton
                    onClick={() => createRoom('default')}
                    disabled={state.createPending}
                    testId="create-room-default-btn"
                >
                    {state.createPending && state.createStrategy === 'default'
                        ? 'Creating...'
                        : 'Create Room'}
                </AppButton>
                <AppButton
                    onClick={() => createRoom('native')}
                    disabled={state.createPending}
                    testId="create-room-native-btn"
                >
                    {state.createPending && state.createStrategy === 'native'
                        ? 'Creating...'
                        : 'Create Room (Native ICE)'}
                </AppButton>
                <AppButton
                    onClick={() => dispatch(homeActions.setJoinModalOpen(true))}
                    disabled={state.createPending}
                    testId="open-join-room-btn"
                >
                    Join Room
                </AppButton>
                <Credits />
            </section>
        </main>
    )
}
