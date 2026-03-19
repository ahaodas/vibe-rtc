import type { PointerEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type { CanvasPoint } from '@/features/demo/features/sharedCanvas/model/sharedCanvasProtocol'
import type { SharedCanvasStroke } from '@/features/demo/features/sharedCanvas/model/sharedCanvasReducer'
import type { AttachRole } from '@/features/demo/model/types'
import { AppButton } from '@/shared/ui/AppButton'
import { AppModal } from '@/shared/ui/AppModal'

const CANVAS_WIDTH = 960
const CANVAS_HEIGHT = 540

type SharedCanvasModalProps = {
    isOpen: boolean
    strokes: SharedCanvasStroke[]
    roleColors: Record<AttachRole, string>
    onClose: () => void
    onClear: () => void
    onStrokeStart: (point: CanvasPoint) => void
    onStrokeMove: (point: CanvasPoint) => void
    onStrokeEnd: () => void
}

function toPoint(event: PointerEvent<HTMLCanvasElement>): CanvasPoint | null {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    const x = (event.clientX - bounds.left) / bounds.width
    const y = (event.clientY - bounds.top) / bounds.height
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
    }
}

function drawStroke(
    context: CanvasRenderingContext2D,
    stroke: SharedCanvasStroke,
    roleColors: Record<AttachRole, string>,
) {
    if (stroke.points.length === 0) return
    context.lineWidth = 3
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = roleColors[stroke.role]
    context.fillStyle = roleColors[stroke.role]

    if (stroke.points.length === 1) {
        const point = stroke.points[0]
        context.beginPath()
        context.arc(point.x * CANVAS_WIDTH, point.y * CANVAS_HEIGHT, 2, 0, Math.PI * 2)
        context.fill()
        return
    }

    context.beginPath()
    stroke.points.forEach((point, index) => {
        const px = point.x * CANVAS_WIDTH
        const py = point.y * CANVAS_HEIGHT
        if (index === 0) {
            context.moveTo(px, py)
            return
        }
        context.lineTo(px, py)
    })
    context.stroke()
}

export function SharedCanvasModal({
    isOpen,
    strokes,
    roleColors,
    onClose,
    onClear,
    onStrokeStart,
    onStrokeMove,
    onStrokeEnd,
}: SharedCanvasModalProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const activePointerIdRef = useRef<number | null>(null)

    useEffect(() => {
        if (!isOpen) {
            activePointerIdRef.current = null
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen) return
        const canvas = canvasRef.current
        if (!canvas) return
        const context = canvas.getContext('2d')
        if (!context) return

        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

        for (const stroke of strokes) {
            drawStroke(context, stroke, roleColors)
        }
    }, [isOpen, roleColors, strokes])

    const handlePointerDown = useCallback(
        (event: PointerEvent<HTMLCanvasElement>) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return
            if (activePointerIdRef.current !== null) return

            const point = toPoint(event)
            if (!point) return

            activePointerIdRef.current = event.pointerId
            if (typeof event.currentTarget.setPointerCapture === 'function') {
                event.currentTarget.setPointerCapture(event.pointerId)
            }
            onStrokeStart(point)
            event.preventDefault()
        },
        [onStrokeStart],
    )

    const handlePointerMove = useCallback(
        (event: PointerEvent<HTMLCanvasElement>) => {
            if (activePointerIdRef.current !== event.pointerId) return
            const point = toPoint(event)
            if (!point) return
            onStrokeMove(point)
            event.preventDefault()
        },
        [onStrokeMove],
    )

    const handlePointerEnd = useCallback(
        (event: PointerEvent<HTMLCanvasElement>) => {
            if (activePointerIdRef.current !== event.pointerId) return
            activePointerIdRef.current = null
            if (
                typeof event.currentTarget.hasPointerCapture === 'function' &&
                typeof event.currentTarget.releasePointerCapture === 'function' &&
                event.currentTarget.hasPointerCapture(event.pointerId)
            ) {
                event.currentTarget.releasePointerCapture(event.pointerId)
            }
            onStrokeEnd()
            event.preventDefault()
        },
        [onStrokeEnd],
    )

    if (!isOpen) return null

    return (
        <AppModal
            title="Shared Canvas"
            testId="shared-canvas-modal"
            titleTestId="shared-canvas-title"
            onClose={onClose}
            modalClassName="sharedCanvasModal"
        >
            <p className="sharedCanvasHint" data-testid="shared-canvas-hint">
                Draw with mouse or touch. Caller uses red, callee uses blue.
            </p>
            <div className="sharedCanvasActions">
                <AppButton
                    className="sharedCanvasClearBtn"
                    testId="shared-canvas-clear-btn"
                    disabled={strokes.length === 0}
                    onClick={onClear}
                >
                    Clear canvas
                </AppButton>
            </div>
            <div className="sharedCanvasWrap">
                <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    className="sharedCanvasBoard"
                    data-testid="shared-canvas-element"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerEnd}
                    onPointerCancel={handlePointerEnd}
                    onPointerLeave={handlePointerEnd}
                />
            </div>
        </AppModal>
    )
}
