import type { RouteStrategyMode } from '@/features/demo/model/types'

export type HomeState = {
    createPending: boolean
    createStrategy: RouteStrategyMode
    createProgressRatio: number
    joinModalOpen: boolean
    joinRoomIdInput: string
}

export enum HomeActionType {
    SetCreatePending = 'home/setCreatePending',
    SetCreateStrategy = 'home/setCreateStrategy',
    SetCreateProgressRatio = 'home/setCreateProgressRatio',
    TickCreateProgress = 'home/tickCreateProgress',
    SetJoinModalOpen = 'home/setJoinModalOpen',
    SetJoinRoomIdInput = 'home/setJoinRoomIdInput',
    ResetCreateState = 'home/resetCreateState',
}

export const homeActions = {
    setCreatePending: (value: boolean) =>
        ({
            type: HomeActionType.SetCreatePending,
            value,
        }) as const,
    setCreateStrategy: (value: RouteStrategyMode) =>
        ({
            type: HomeActionType.SetCreateStrategy,
            value,
        }) as const,
    setCreateProgressRatio: (value: number) =>
        ({
            type: HomeActionType.SetCreateProgressRatio,
            value,
        }) as const,
    tickCreateProgress: (value: number, max: number) =>
        ({
            type: HomeActionType.TickCreateProgress,
            value,
            max,
        }) as const,
    setJoinModalOpen: (value: boolean) =>
        ({
            type: HomeActionType.SetJoinModalOpen,
            value,
        }) as const,
    setJoinRoomIdInput: (value: string) =>
        ({
            type: HomeActionType.SetJoinRoomIdInput,
            value,
        }) as const,
    resetCreateState: () =>
        ({
            type: HomeActionType.ResetCreateState,
        }) as const,
}

export type HomeAction = (typeof homeActions)[keyof typeof homeActions] extends (
    ...args: infer _Args
) => infer Return
    ? Return
    : never

export const homeInitialState: HomeState = {
    createPending: false,
    createStrategy: 'default',
    createProgressRatio: 0,
    joinModalOpen: false,
    joinRoomIdInput: '',
}

export function homeReducer(state: HomeState, action: HomeAction): HomeState {
    switch (action.type) {
        case HomeActionType.SetCreatePending:
            return { ...state, createPending: action.value }
        case HomeActionType.SetCreateStrategy:
            return { ...state, createStrategy: action.value }
        case HomeActionType.SetCreateProgressRatio:
            return { ...state, createProgressRatio: action.value }
        case HomeActionType.TickCreateProgress:
            return {
                ...state,
                createProgressRatio: Math.min(action.max, state.createProgressRatio + action.value),
            }
        case HomeActionType.SetJoinModalOpen:
            return { ...state, joinModalOpen: action.value }
        case HomeActionType.SetJoinRoomIdInput:
            return { ...state, joinRoomIdInput: action.value }
        case HomeActionType.ResetCreateState:
            return {
                ...state,
                createPending: false,
                createProgressRatio: 0,
                createStrategy: 'default',
            }
        default:
            return state
    }
}
