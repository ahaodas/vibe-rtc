import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useReducer } from 'react'

type ShareLinkPayload = {
    roomId: string
    url: string
}

type RoomOccupiedPayload = {
    roomId: string
}

type TakenOverPayload = {
    roomId: string
    bySessionId?: string
}

type SecurityEventEnvelope<Payload> = {
    id: number
    payload: Payload
}

type SecurityBusState = {
    sequence: number
    shareLink: SecurityEventEnvelope<ShareLinkPayload> | null
    roomOccupied: SecurityEventEnvelope<RoomOccupiedPayload> | null
    takenOver: SecurityEventEnvelope<TakenOverPayload> | null
}

enum SecurityBusActionType {
    PublishShareLink = 'securityBus/publishShareLink',
    PublishRoomOccupied = 'securityBus/publishRoomOccupied',
    PublishTakenOver = 'securityBus/publishTakenOver',
}

type SecurityBusAction =
    | {
          type: SecurityBusActionType.PublishShareLink
          payload: ShareLinkPayload
      }
    | {
          type: SecurityBusActionType.PublishRoomOccupied
          payload: RoomOccupiedPayload
      }
    | {
          type: SecurityBusActionType.PublishTakenOver
          payload: TakenOverPayload
      }

const initialSecurityBusState: SecurityBusState = {
    sequence: 0,
    shareLink: null,
    roomOccupied: null,
    takenOver: null,
}

function securityBusReducer(state: SecurityBusState, action: SecurityBusAction): SecurityBusState {
    const nextId = state.sequence + 1

    switch (action.type) {
        case SecurityBusActionType.PublishShareLink:
            return {
                ...state,
                sequence: nextId,
                shareLink: { id: nextId, payload: action.payload },
            }
        case SecurityBusActionType.PublishRoomOccupied:
            return {
                ...state,
                sequence: nextId,
                roomOccupied: { id: nextId, payload: action.payload },
            }
        case SecurityBusActionType.PublishTakenOver:
            return {
                ...state,
                sequence: nextId,
                takenOver: { id: nextId, payload: action.payload },
            }
        default:
            return state
    }
}

export type DemoSecurityBusValue = {
    state: SecurityBusState
    publishShareLink: (payload: ShareLinkPayload) => void
    publishRoomOccupied: (payload: RoomOccupiedPayload) => void
    publishTakenOver: (payload: TakenOverPayload) => void
}

const DemoSecurityBusContext = createContext<DemoSecurityBusValue | null>(null)

export function useCreateDemoSecurityBus(): DemoSecurityBusValue {
    const [state, dispatch] = useReducer(securityBusReducer, initialSecurityBusState)

    const publishShareLink = useCallback((payload: ShareLinkPayload) => {
        dispatch({
            type: SecurityBusActionType.PublishShareLink,
            payload,
        })
    }, [])

    const publishRoomOccupied = useCallback((payload: RoomOccupiedPayload) => {
        dispatch({
            type: SecurityBusActionType.PublishRoomOccupied,
            payload,
        })
    }, [])

    const publishTakenOver = useCallback((payload: TakenOverPayload) => {
        dispatch({
            type: SecurityBusActionType.PublishTakenOver,
            payload,
        })
    }, [])

    return useMemo(
        () => ({
            state,
            publishShareLink,
            publishRoomOccupied,
            publishTakenOver,
        }),
        [publishRoomOccupied, publishShareLink, publishTakenOver, state],
    )
}

type DemoSecurityBusProviderProps = {
    value: DemoSecurityBusValue
    children: ReactNode
}

export function DemoSecurityBusProvider({ value, children }: DemoSecurityBusProviderProps) {
    return (
        <DemoSecurityBusContext.Provider value={value}>{children}</DemoSecurityBusContext.Provider>
    )
}

export function useDemoSecurityBus() {
    const context = useContext(DemoSecurityBusContext)
    if (!context) {
        throw new Error('useDemoSecurityBus must be used inside DemoSecurityBusProvider')
    }

    return context
}
