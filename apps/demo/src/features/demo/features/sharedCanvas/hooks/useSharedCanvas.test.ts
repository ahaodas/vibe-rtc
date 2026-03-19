import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSharedCanvas } from '@/features/demo/features/sharedCanvas/hooks/useSharedCanvas'
import { encodeSharedCanvasEvent } from '@/features/demo/features/sharedCanvas/model/sharedCanvasProtocol'

describe('useSharedCanvas', () => {
    it('opens/closes locally and emits sync events', () => {
        const sendFast = vi.fn().mockResolvedValue(undefined)
        const { result } = renderHook(() => useSharedCanvas({ role: 'caller' }))

        act(() => {
            result.current.openFromLocal(sendFast)
        })

        expect(result.current.isOpen).toBe(true)
        expect(sendFast).toHaveBeenCalledWith(
            encodeSharedCanvasEvent({
                protocol: 'vibe-demo/shared-canvas',
                v: 1,
                type: 'open',
                role: 'caller',
            }),
        )

        act(() => {
            result.current.closeFromLocal(sendFast)
        })

        expect(result.current.isOpen).toBe(false)
        expect(sendFast).toHaveBeenCalledWith(
            encodeSharedCanvasEvent({
                protocol: 'vibe-demo/shared-canvas',
                v: 1,
                type: 'close',
                role: 'caller',
            }),
        )

        act(() => {
            result.current.startLocalStroke(sendFast, { x: 0.1, y: 0.2 })
            result.current.clearFromLocal(sendFast)
        })

        expect(result.current.strokes).toEqual([])
        expect(sendFast).toHaveBeenCalledWith(
            encodeSharedCanvasEvent({
                protocol: 'vibe-demo/shared-canvas',
                v: 1,
                type: 'clear',
                role: 'caller',
            }),
        )
    })

    it('updates state from remote open/close messages', () => {
        const { result } = renderHook(() => useSharedCanvas({ role: 'caller' }))
        const remoteOpen = encodeSharedCanvasEvent({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'open',
            role: 'callee',
        })
        const remoteClose = encodeSharedCanvasEvent({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'close',
            role: 'callee',
        })
        const remoteClear = encodeSharedCanvasEvent({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'clear',
            role: 'callee',
        })

        act(() => {
            const handled = result.current.handleIncomingFastMessage(remoteOpen)
            expect(handled).toBe(true)
        })
        expect(result.current.isOpen).toBe(true)
        act(() => {
            result.current.handleIncomingFastMessage(
                encodeSharedCanvasEvent({
                    protocol: 'vibe-demo/shared-canvas',
                    v: 1,
                    type: 'stroke-start',
                    role: 'callee',
                    strokeId: 'remote-1',
                    x: 0.2,
                    y: 0.2,
                }),
            )
        })
        expect(result.current.strokes).toHaveLength(1)
        act(() => {
            const handled = result.current.handleIncomingFastMessage(remoteClear)
            expect(handled).toBe(true)
        })
        expect(result.current.strokes).toHaveLength(0)

        act(() => {
            const handled = result.current.handleIncomingFastMessage(remoteClose)
            expect(handled).toBe(true)
        })
        expect(result.current.isOpen).toBe(false)
    })

    it('builds local stroke and applies remote stroke-point updates', () => {
        const sendFast = vi.fn().mockResolvedValue(undefined)
        const { result } = renderHook(() => useSharedCanvas({ role: 'caller' }))

        act(() => {
            result.current.startLocalStroke(sendFast, { x: 0.1, y: 0.2 })
            result.current.appendLocalStrokePoint(sendFast, { x: 0.3, y: 0.4 })
            result.current.endLocalStroke(sendFast)
        })

        expect(result.current.strokes).toHaveLength(1)
        expect(result.current.strokes[0]?.points).toHaveLength(2)

        const remoteStart = encodeSharedCanvasEvent({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'stroke-start',
            role: 'callee',
            strokeId: 'remote-stroke',
            x: 0.2,
            y: 0.3,
        })
        const remoteMove = encodeSharedCanvasEvent({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'stroke-point',
            role: 'callee',
            strokeId: 'remote-stroke',
            x: 0.35,
            y: 0.55,
        })

        act(() => {
            result.current.handleIncomingFastMessage(remoteStart)
            result.current.handleIncomingFastMessage(remoteMove)
        })

        expect(result.current.strokes).toHaveLength(2)
        expect(result.current.strokes[1]?.role).toBe('callee')
        expect(result.current.strokes[1]?.points).toEqual([
            { x: 0.2, y: 0.3 },
            { x: 0.35, y: 0.55 },
        ])
    })
})
