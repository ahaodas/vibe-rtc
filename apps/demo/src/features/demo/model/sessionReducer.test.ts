import { describe, expect, it } from 'vitest'
import {
    sessionActions,
    sessionInitialState,
    sessionReducer,
} from '@/features/demo/model/sessionReducer'

describe('sessionReducer', () => {
    it('updates message/warnings/modals state fields', () => {
        let state = sessionInitialState

        state = sessionReducer(state, sessionActions.setMessageText('hello'))
        state = sessionReducer(state, sessionActions.setHideConnectionMessages(false))
        state = sessionReducer(state, sessionActions.setRoomNotFoundModalOpen(true))
        state = sessionReducer(
            state,
            sessionActions.setNetWarning({ key: 'relay', message: 'Relay path is active.' }),
        )

        expect(state.messageText).toBe('hello')
        expect(state.hideConnectionMessages).toBe(false)
        expect(state.roomNotFoundModalOpen).toBe(true)
        expect(state.netWarning).toEqual({ key: 'relay', message: 'Relay path is active.' })
    })

    it('clamps connect progress to max on tick', () => {
        let state = sessionInitialState

        state = sessionReducer(state, sessionActions.setConnectProgressRatio(0.7))
        state = sessionReducer(state, sessionActions.tickConnectProgress(0.4, 0.92))

        expect(state.connectProgressRatio).toBe(0.92)
    })

    it('resets to initial state for main view', () => {
        let state = sessionInitialState

        state = sessionReducer(state, sessionActions.setMessageText('to reset'))
        state = sessionReducer(state, sessionActions.setQrModalOpen(true))
        state = sessionReducer(state, sessionActions.setLeavePending(true))
        state = sessionReducer(state, sessionActions.setRemoveRoomOnLeave(false))
        state = sessionReducer(state, sessionActions.resetForMain())

        expect(state).toEqual(sessionInitialState)
    })
})
