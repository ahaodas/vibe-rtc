import type { CanvasPoint } from '@/features/demo/features/sharedCanvas/model/sharedCanvasProtocol'
import type { AttachRole } from '@/features/demo/model/types'

export type SharedCanvasStroke = {
    id: string
    role: AttachRole
    points: CanvasPoint[]
}

export type SharedCanvasState = {
    isOpen: boolean
    strokes: SharedCanvasStroke[]
}

type SharedCanvasAction =
    | {
          type: 'canvas/setOpen'
          value: boolean
      }
    | {
          type: 'canvas/clear'
      }
    | {
          type: 'canvas/startStroke'
          strokeId: string
          role: AttachRole
          point: CanvasPoint
      }
    | {
          type: 'canvas/appendStrokePoint'
          strokeId: string
          role: AttachRole
          point: CanvasPoint
      }

export const sharedCanvasInitialState: SharedCanvasState = {
    isOpen: false,
    strokes: [],
}

const pointsAreEqual = (a: CanvasPoint, b: CanvasPoint): boolean => a.x === b.x && a.y === b.y

function appendPointToStroke(stroke: SharedCanvasStroke, point: CanvasPoint): SharedCanvasStroke {
    const lastPoint = stroke.points[stroke.points.length - 1]
    if (lastPoint && pointsAreEqual(lastPoint, point)) return stroke
    return {
        ...stroke,
        points: [...stroke.points, point],
    }
}

export function sharedCanvasReducer(
    state: SharedCanvasState,
    action: SharedCanvasAction,
): SharedCanvasState {
    switch (action.type) {
        case 'canvas/setOpen': {
            if (state.isOpen === action.value) return state
            return {
                ...state,
                isOpen: action.value,
            }
        }
        case 'canvas/clear': {
            if (state.strokes.length === 0) return state
            return {
                ...state,
                strokes: [],
            }
        }
        case 'canvas/startStroke': {
            const existingIndex = state.strokes.findIndex((stroke) => stroke.id === action.strokeId)
            const nextStroke: SharedCanvasStroke = {
                id: action.strokeId,
                role: action.role,
                points: [action.point],
            }
            if (existingIndex === -1) {
                return {
                    ...state,
                    strokes: [...state.strokes, nextStroke],
                }
            }
            return {
                ...state,
                strokes: state.strokes.map((stroke, index) =>
                    index === existingIndex ? nextStroke : stroke,
                ),
            }
        }
        case 'canvas/appendStrokePoint': {
            const existingIndex = state.strokes.findIndex((stroke) => stroke.id === action.strokeId)
            if (existingIndex === -1) {
                return {
                    ...state,
                    strokes: [
                        ...state.strokes,
                        {
                            id: action.strokeId,
                            role: action.role,
                            points: [action.point],
                        },
                    ],
                }
            }
            return {
                ...state,
                strokes: state.strokes.map((stroke, index) =>
                    index === existingIndex ? appendPointToStroke(stroke, action.point) : stroke,
                ),
            }
        }
        default:
            return state
    }
}
