import type { VibeRTCContextValue } from '@vibe-rtc/rtc-react'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { DEMO_ROUTE_PATHS } from '@/features/demo/model/routePaths'
import { type SessionAction, sessionActions } from '@/features/demo/model/sessionReducer'
import type { AttachRole } from '@/features/demo/model/types'

type Dispatch = (action: SessionAction) => void

type UseSessionActionsArgs = {
    rtc: VibeRTCContextValue
    dispatch: Dispatch
    role: AttachRole
    leavePending: boolean
    removeRoomOnLeave: boolean
    messageText: string
}

export function useSessionActions({
    rtc,
    dispatch,
    role,
    leavePending,
    removeRoomOnLeave,
    messageText,
}: UseSessionActionsArgs) {
    const navigate = useNavigate()

    const backToMain = useCallback(() => {
        dispatch(sessionActions.resetForMain())
        void rtc.disconnect().catch(() => {})
        navigate(DEMO_ROUTE_PATHS.home)
    }, [dispatch, navigate, rtc])

    const closeSessionAndReturnMain = useCallback(async () => {
        if (leavePending) return

        dispatch(sessionActions.setLeavePending(true))

        try {
            if (role === 'caller' && removeRoomOnLeave) await rtc.endRoom()
            else await rtc.disconnect()
        } catch {
            // noop
        }

        dispatch(sessionActions.resetForMain())
        navigate(DEMO_ROUTE_PATHS.home)
    }, [dispatch, leavePending, navigate, removeRoomOnLeave, role, rtc])

    const sendFast = useCallback(async () => {
        const text = messageText.trim()
        if (!text) return

        await rtc.sendFast(text)
        dispatch(sessionActions.setMessageText(''))
    }, [dispatch, messageText, rtc])

    const sendReliable = useCallback(async () => {
        const text = messageText.trim()
        if (!text) return

        await rtc.sendReliable(text)
        dispatch(sessionActions.setMessageText(''))
    }, [dispatch, messageText, rtc])

    return {
        backToMain,
        closeSessionAndReturnMain,
        sendFast,
        sendReliable,
    }
}
