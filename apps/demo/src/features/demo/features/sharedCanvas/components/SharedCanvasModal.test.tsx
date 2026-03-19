import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SharedCanvasModal } from '@/features/demo/features/sharedCanvas/components/SharedCanvasModal'

describe('SharedCanvasModal', () => {
    beforeEach(() => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
            return {
                fillRect: vi.fn(),
                beginPath: vi.fn(),
                arc: vi.fn(),
                fill: vi.fn(),
                moveTo: vi.fn(),
                lineTo: vi.fn(),
                stroke: vi.fn(),
                set lineWidth(_: number) {},
                set lineCap(_: CanvasLineCap) {},
                set lineJoin(_: CanvasLineJoin) {},
                set strokeStyle(_: string) {},
                set fillStyle(_: string) {},
            } as unknown as CanvasRenderingContext2D
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('does not render when closed', () => {
        render(
            <SharedCanvasModal
                isOpen={false}
                strokes={[]}
                roleColors={{ caller: '#ff3e3e', callee: '#3f7cff' }}
                onClose={vi.fn()}
                onClear={vi.fn()}
                onStrokeStart={vi.fn()}
                onStrokeMove={vi.fn()}
                onStrokeEnd={vi.fn()}
            />,
        )

        expect(screen.queryByTestId('shared-canvas-modal')).not.toBeInTheDocument()
    })

    it('renders modal and forwards close click', () => {
        const onClose = vi.fn()
        const onClear = vi.fn()
        render(
            <SharedCanvasModal
                isOpen
                strokes={[
                    {
                        id: 'stroke-1',
                        role: 'caller',
                        points: [{ x: 0.2, y: 0.2 }],
                    },
                ]}
                roleColors={{ caller: '#ff3e3e', callee: '#3f7cff' }}
                onClose={onClose}
                onClear={onClear}
                onStrokeStart={vi.fn()}
                onStrokeMove={vi.fn()}
                onStrokeEnd={vi.fn()}
            />,
        )

        expect(screen.getByTestId('shared-canvas-title')).toHaveTextContent('Shared Canvas')
        fireEvent.click(screen.getByTestId('shared-canvas-clear-btn'))
        expect(onClear).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByTestId('shared-canvas-modal-close'))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('forwards pointer draw events', () => {
        const onStrokeStart = vi.fn()
        const onStrokeMove = vi.fn()
        const onStrokeEnd = vi.fn()
        render(
            <SharedCanvasModal
                isOpen
                strokes={[]}
                roleColors={{ caller: '#ff3e3e', callee: '#3f7cff' }}
                onClose={vi.fn()}
                onClear={vi.fn()}
                onStrokeStart={onStrokeStart}
                onStrokeMove={onStrokeMove}
                onStrokeEnd={onStrokeEnd}
            />,
        )

        const canvas = screen.getByTestId('shared-canvas-element')
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            value: () => ({
                left: 0,
                top: 0,
                width: 300,
                height: 150,
                right: 300,
                bottom: 150,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
        })

        fireEvent.pointerDown(canvas, {
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 75,
            clientY: 45,
        })
        fireEvent.pointerMove(canvas, {
            pointerId: 1,
            pointerType: 'mouse',
            buttons: 1,
            clientX: 150,
            clientY: 90,
        })
        fireEvent.pointerUp(canvas, {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 150,
            clientY: 90,
        })

        expect(onStrokeStart).toHaveBeenCalledWith({ x: 0.25, y: 0.3 })
        expect(onStrokeMove).toHaveBeenCalledWith({ x: 0.5, y: 0.6 })
        expect(onStrokeEnd).toHaveBeenCalledTimes(1)
    })
})
