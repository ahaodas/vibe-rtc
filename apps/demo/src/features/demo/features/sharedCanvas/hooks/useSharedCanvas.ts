import { useCallback, useReducer, useRef } from 'react'
import {
    type CanvasPoint,
    encodeSharedCanvasEvent,
    parseSharedCanvasEvent,
    SHARED_CANVAS_PROTOCOL,
    SHARED_CANVAS_VERSION,
} from '@/features/demo/features/sharedCanvas/model/sharedCanvasProtocol'
import {
    sharedCanvasInitialState,
    sharedCanvasReducer,
} from '@/features/demo/features/sharedCanvas/model/sharedCanvasReducer'
import type { AttachRole } from '@/features/demo/model/types'

type FastSender = (message: string) => Promise<void>

type UseSharedCanvasArgs = {
    role: AttachRole
}

const roleColors: Record<AttachRole, string> = {
    caller: '#ff3e3e',
    callee: '#3f7cff',
}

const buildStrokeId = (role: AttachRole) => {
    const randomPart = Math.random().toString(36).slice(2, 10)
    return `${role}-${Date.now().toString(36)}-${randomPart}`
}

const sendEvent = (sendFast: FastSender, event: Parameters<typeof encodeSharedCanvasEvent>[0]) => {
    void sendFast(encodeSharedCanvasEvent(event)).catch(() => {})
}

export function useSharedCanvas({ role }: UseSharedCanvasArgs) {
    const [state, dispatch] = useReducer(sharedCanvasReducer, sharedCanvasInitialState)
    const activeLocalStrokeIdRef = useRef<string | null>(null)

    const openFromLocal = useCallback(
        (sendFast: FastSender) => {
            dispatch({ type: 'canvas/setOpen', value: true })
            sendEvent(sendFast, {
                protocol: SHARED_CANVAS_PROTOCOL,
                v: SHARED_CANVAS_VERSION,
                type: 'open',
                role,
            })
        },
        [role],
    )

    const closeFromLocal = useCallback(
        (sendFast: FastSender) => {
            activeLocalStrokeIdRef.current = null
            dispatch({ type: 'canvas/setOpen', value: false })
            sendEvent(sendFast, {
                protocol: SHARED_CANVAS_PROTOCOL,
                v: SHARED_CANVAS_VERSION,
                type: 'close',
                role,
            })
        },
        [role],
    )

    const clearFromLocal = useCallback(
        (sendFast: FastSender) => {
            activeLocalStrokeIdRef.current = null
            dispatch({ type: 'canvas/clear' })
            sendEvent(sendFast, {
                protocol: SHARED_CANVAS_PROTOCOL,
                v: SHARED_CANVAS_VERSION,
                type: 'clear',
                role,
            })
        },
        [role],
    )

    const startLocalStroke = useCallback(
        (sendFast: FastSender, point: CanvasPoint) => {
            const strokeId = buildStrokeId(role)
            activeLocalStrokeIdRef.current = strokeId
            dispatch({
                type: 'canvas/startStroke',
                strokeId,
                role,
                point,
            })
            sendEvent(sendFast, {
                protocol: SHARED_CANVAS_PROTOCOL,
                v: SHARED_CANVAS_VERSION,
                type: 'stroke-start',
                role,
                strokeId,
                x: point.x,
                y: point.y,
            })
        },
        [role],
    )

    const appendLocalStrokePoint = useCallback(
        (sendFast: FastSender, point: CanvasPoint) => {
            const strokeId = activeLocalStrokeIdRef.current
            if (!strokeId) return
            dispatch({
                type: 'canvas/appendStrokePoint',
                strokeId,
                role,
                point,
            })
            sendEvent(sendFast, {
                protocol: SHARED_CANVAS_PROTOCOL,
                v: SHARED_CANVAS_VERSION,
                type: 'stroke-point',
                role,
                strokeId,
                x: point.x,
                y: point.y,
            })
        },
        [role],
    )

    const endLocalStroke = useCallback(
        (sendFast: FastSender) => {
            const strokeId = activeLocalStrokeIdRef.current
            if (!strokeId) return
            activeLocalStrokeIdRef.current = null
            sendEvent(sendFast, {
                protocol: SHARED_CANVAS_PROTOCOL,
                v: SHARED_CANVAS_VERSION,
                type: 'stroke-end',
                role,
                strokeId,
            })
        },
        [role],
    )

    const cancelLocalStroke = useCallback(() => {
        activeLocalStrokeIdRef.current = null
    }, [])

    const handleIncomingFastMessage = useCallback(
        (rawMessage: string): boolean => {
            const event = parseSharedCanvasEvent(rawMessage)
            if (!event) return false
            if (event.role === role) return true

            switch (event.type) {
                case 'open': {
                    dispatch({ type: 'canvas/setOpen', value: true })
                    return true
                }
                case 'close': {
                    activeLocalStrokeIdRef.current = null
                    dispatch({ type: 'canvas/setOpen', value: false })
                    return true
                }
                case 'stroke-start': {
                    dispatch({ type: 'canvas/setOpen', value: true })
                    dispatch({
                        type: 'canvas/startStroke',
                        strokeId: event.strokeId,
                        role: event.role,
                        point: { x: event.x, y: event.y },
                    })
                    return true
                }
                case 'stroke-point': {
                    dispatch({ type: 'canvas/setOpen', value: true })
                    dispatch({
                        type: 'canvas/appendStrokePoint',
                        strokeId: event.strokeId,
                        role: event.role,
                        point: { x: event.x, y: event.y },
                    })
                    return true
                }
                case 'clear': {
                    activeLocalStrokeIdRef.current = null
                    dispatch({ type: 'canvas/clear' })
                    return true
                }
                case 'stroke-end':
                    return true
                default:
                    return false
            }
        },
        [role],
    )

    return {
        isOpen: state.isOpen,
        strokes: state.strokes,
        roleColors,
        openFromLocal,
        closeFromLocal,
        clearFromLocal,
        startLocalStroke,
        appendLocalStrokePoint,
        endLocalStroke,
        cancelLocalStroke,
        handleIncomingFastMessage,
    }
}
