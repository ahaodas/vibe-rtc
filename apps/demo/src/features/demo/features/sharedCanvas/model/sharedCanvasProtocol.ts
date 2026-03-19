import type { AttachRole } from '@/features/demo/model/types'

const SHARED_CANVAS_PROTOCOL = 'vibe-demo/shared-canvas'
const SHARED_CANVAS_VERSION = 1

export type CanvasPoint = {
    x: number
    y: number
}

export type SharedCanvasWireEvent =
    | {
          protocol: typeof SHARED_CANVAS_PROTOCOL
          v: typeof SHARED_CANVAS_VERSION
          type: 'open' | 'close' | 'clear'
          role: AttachRole
      }
    | {
          protocol: typeof SHARED_CANVAS_PROTOCOL
          v: typeof SHARED_CANVAS_VERSION
          type: 'stroke-start' | 'stroke-point'
          role: AttachRole
          strokeId: string
          x: number
          y: number
      }
    | {
          protocol: typeof SHARED_CANVAS_PROTOCOL
          v: typeof SHARED_CANVAS_VERSION
          type: 'stroke-end'
          role: AttachRole
          strokeId: string
      }

const isAttachRole = (value: unknown): value is AttachRole =>
    value === 'caller' || value === 'callee'

const clampCoord = (value: number) => Math.max(0, Math.min(1, value))

const toWireCoord = (value: number): number => Math.round(clampCoord(value) * 10_000) / 10_000

const toParsedCoord = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return clampCoord(value)
}

const toStrokeId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized ? normalized : null
}

export function encodeSharedCanvasEvent(event: SharedCanvasWireEvent): string {
    if (event.type === 'stroke-start' || event.type === 'stroke-point') {
        return JSON.stringify({
            ...event,
            x: toWireCoord(event.x),
            y: toWireCoord(event.y),
        })
    }
    return JSON.stringify(event)
}

export function parseSharedCanvasEvent(rawMessage: string): SharedCanvasWireEvent | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(rawMessage)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object') return null

    const candidate = parsed as Record<string, unknown>
    if (candidate.protocol !== SHARED_CANVAS_PROTOCOL) return null
    if (candidate.v !== SHARED_CANVAS_VERSION) return null
    if (!isAttachRole(candidate.role)) return null

    if (candidate.type === 'open' || candidate.type === 'close' || candidate.type === 'clear') {
        return {
            protocol: SHARED_CANVAS_PROTOCOL,
            v: SHARED_CANVAS_VERSION,
            type: candidate.type,
            role: candidate.role,
        }
    }

    if (candidate.type === 'stroke-end') {
        const strokeId = toStrokeId(candidate.strokeId)
        if (!strokeId) return null
        return {
            protocol: SHARED_CANVAS_PROTOCOL,
            v: SHARED_CANVAS_VERSION,
            type: 'stroke-end',
            role: candidate.role,
            strokeId,
        }
    }

    if (candidate.type === 'stroke-start' || candidate.type === 'stroke-point') {
        const strokeId = toStrokeId(candidate.strokeId)
        const x = toParsedCoord(candidate.x)
        const y = toParsedCoord(candidate.y)
        if (!strokeId || x === null || y === null) return null
        return {
            protocol: SHARED_CANVAS_PROTOCOL,
            v: SHARED_CANVAS_VERSION,
            type: candidate.type,
            role: candidate.role,
            strokeId,
            x,
            y,
        }
    }

    return null
}

export { SHARED_CANVAS_PROTOCOL, SHARED_CANVAS_VERSION }
