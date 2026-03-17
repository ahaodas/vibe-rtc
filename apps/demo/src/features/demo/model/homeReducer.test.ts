import { describe, expect, it } from 'vitest'
import { homeActions, homeInitialState, homeReducer } from '@/features/demo/model/homeReducer'

describe('homeReducer', () => {
    it('updates create state and clamps progress by max value', () => {
        let state = homeInitialState

        state = homeReducer(state, homeActions.setCreatePending(true))
        state = homeReducer(state, homeActions.setCreateStrategy('native'))
        state = homeReducer(state, homeActions.setCreateProgressRatio(0.6))
        state = homeReducer(state, homeActions.tickCreateProgress(0.5, 0.9))

        expect(state.createPending).toBe(true)
        expect(state.createStrategy).toBe('native')
        expect(state.createProgressRatio).toBe(0.9)
    })

    it('updates join modal/input and keeps them on create reset', () => {
        let state = homeInitialState

        state = homeReducer(state, homeActions.setJoinModalOpen(true))
        state = homeReducer(state, homeActions.setJoinRoomIdInput('room-42'))
        state = homeReducer(state, homeActions.setCreatePending(true))
        state = homeReducer(state, homeActions.setCreateStrategy('native'))
        state = homeReducer(state, homeActions.setCreateProgressRatio(0.5))

        state = homeReducer(state, homeActions.resetCreateState())

        expect(state.createPending).toBe(false)
        expect(state.createStrategy).toBe('default')
        expect(state.createProgressRatio).toBe(0)
        expect(state.joinModalOpen).toBe(true)
        expect(state.joinRoomIdInput).toBe('room-42')
    })
})
