import type { WarningKey } from '@/features/demo/model/types'

export type NetWarningState = {
    key: WarningKey
    message: string
}

export type SessionState = {
    messageText: string
    roomNotFoundModalOpen: boolean
    roomOccupiedModalOpen: boolean
    takeoverModalOpen: boolean
    securityTakeoverDetected: boolean
    takeoverBySessionId: string | null
    connectProgressRatio: number
    hideConnectionMessages: boolean
    qrModalOpen: boolean
    leaveConfirmOpen: boolean
    leavePending: boolean
    removeRoomOnLeave: boolean
    netWarning: NetWarningState | null
    calleeQrDataUrl: string
}

export enum SessionActionType {
    SetMessageText = 'session/setMessageText',
    SetRoomNotFoundModalOpen = 'session/setRoomNotFoundModalOpen',
    SetRoomOccupiedModalOpen = 'session/setRoomOccupiedModalOpen',
    SetTakeoverModalOpen = 'session/setTakeoverModalOpen',
    SetSecurityTakeoverDetected = 'session/setSecurityTakeoverDetected',
    SetTakeoverBySessionId = 'session/setTakeoverBySessionId',
    SetConnectProgressRatio = 'session/setConnectProgressRatio',
    TickConnectProgress = 'session/tickConnectProgress',
    SetHideConnectionMessages = 'session/setHideConnectionMessages',
    SetQrModalOpen = 'session/setQrModalOpen',
    SetLeaveConfirmOpen = 'session/setLeaveConfirmOpen',
    SetLeavePending = 'session/setLeavePending',
    SetRemoveRoomOnLeave = 'session/setRemoveRoomOnLeave',
    SetNetWarning = 'session/setNetWarning',
    SetCalleeQrDataUrl = 'session/setCalleeQrDataUrl',
    ResetForMain = 'session/resetForMain',
}

export const sessionActions = {
    setMessageText: (value: string) =>
        ({
            type: SessionActionType.SetMessageText,
            value,
        }) as const,
    setRoomNotFoundModalOpen: (value: boolean) =>
        ({
            type: SessionActionType.SetRoomNotFoundModalOpen,
            value,
        }) as const,
    setRoomOccupiedModalOpen: (value: boolean) =>
        ({
            type: SessionActionType.SetRoomOccupiedModalOpen,
            value,
        }) as const,
    setTakeoverModalOpen: (value: boolean) =>
        ({
            type: SessionActionType.SetTakeoverModalOpen,
            value,
        }) as const,
    setSecurityTakeoverDetected: (value: boolean) =>
        ({
            type: SessionActionType.SetSecurityTakeoverDetected,
            value,
        }) as const,
    setTakeoverBySessionId: (value: string | null) =>
        ({
            type: SessionActionType.SetTakeoverBySessionId,
            value,
        }) as const,
    setConnectProgressRatio: (value: number) =>
        ({
            type: SessionActionType.SetConnectProgressRatio,
            value,
        }) as const,
    tickConnectProgress: (step: number, max: number) =>
        ({
            type: SessionActionType.TickConnectProgress,
            step,
            max,
        }) as const,
    setHideConnectionMessages: (value: boolean) =>
        ({
            type: SessionActionType.SetHideConnectionMessages,
            value,
        }) as const,
    setQrModalOpen: (value: boolean) =>
        ({
            type: SessionActionType.SetQrModalOpen,
            value,
        }) as const,
    setLeaveConfirmOpen: (value: boolean) =>
        ({
            type: SessionActionType.SetLeaveConfirmOpen,
            value,
        }) as const,
    setLeavePending: (value: boolean) =>
        ({
            type: SessionActionType.SetLeavePending,
            value,
        }) as const,
    setRemoveRoomOnLeave: (value: boolean) =>
        ({
            type: SessionActionType.SetRemoveRoomOnLeave,
            value,
        }) as const,
    setNetWarning: (value: NetWarningState | null) =>
        ({
            type: SessionActionType.SetNetWarning,
            value,
        }) as const,
    setCalleeQrDataUrl: (value: string) =>
        ({
            type: SessionActionType.SetCalleeQrDataUrl,
            value,
        }) as const,
    resetForMain: () =>
        ({
            type: SessionActionType.ResetForMain,
        }) as const,
}

export type SessionAction = (typeof sessionActions)[keyof typeof sessionActions] extends (
    ...args: infer _Args
) => infer Return
    ? Return
    : never

export const sessionInitialState: SessionState = {
    messageText: '',
    roomNotFoundModalOpen: false,
    roomOccupiedModalOpen: false,
    takeoverModalOpen: false,
    securityTakeoverDetected: false,
    takeoverBySessionId: null,
    connectProgressRatio: 0,
    hideConnectionMessages: true,
    qrModalOpen: false,
    leaveConfirmOpen: false,
    leavePending: false,
    removeRoomOnLeave: true,
    netWarning: null,
    calleeQrDataUrl: '',
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
    switch (action.type) {
        case SessionActionType.SetMessageText:
            return { ...state, messageText: action.value }
        case SessionActionType.SetRoomNotFoundModalOpen:
            return { ...state, roomNotFoundModalOpen: action.value }
        case SessionActionType.SetRoomOccupiedModalOpen:
            return { ...state, roomOccupiedModalOpen: action.value }
        case SessionActionType.SetTakeoverModalOpen:
            return { ...state, takeoverModalOpen: action.value }
        case SessionActionType.SetSecurityTakeoverDetected:
            return { ...state, securityTakeoverDetected: action.value }
        case SessionActionType.SetTakeoverBySessionId:
            return { ...state, takeoverBySessionId: action.value }
        case SessionActionType.SetConnectProgressRatio:
            return { ...state, connectProgressRatio: action.value }
        case SessionActionType.TickConnectProgress:
            return {
                ...state,
                connectProgressRatio: Math.min(
                    action.max,
                    state.connectProgressRatio + action.step,
                ),
            }
        case SessionActionType.SetHideConnectionMessages:
            return { ...state, hideConnectionMessages: action.value }
        case SessionActionType.SetQrModalOpen:
            return { ...state, qrModalOpen: action.value }
        case SessionActionType.SetLeaveConfirmOpen:
            return { ...state, leaveConfirmOpen: action.value }
        case SessionActionType.SetLeavePending:
            return { ...state, leavePending: action.value }
        case SessionActionType.SetRemoveRoomOnLeave:
            return { ...state, removeRoomOnLeave: action.value }
        case SessionActionType.SetNetWarning:
            return { ...state, netWarning: action.value }
        case SessionActionType.SetCalleeQrDataUrl:
            return { ...state, calleeQrDataUrl: action.value }
        case SessionActionType.ResetForMain:
            return sessionInitialState
        default:
            return state
    }
}
