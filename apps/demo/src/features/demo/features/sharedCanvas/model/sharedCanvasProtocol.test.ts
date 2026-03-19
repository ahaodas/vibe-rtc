import { describe, expect, it } from 'vitest'
import {
    encodeSharedCanvasEvent,
    parseSharedCanvasEvent,
} from '@/features/demo/features/sharedCanvas/model/sharedCanvasProtocol'

describe('sharedCanvasProtocol', () => {
    it('encodes and parses open/close/clear events', () => {
        const openRaw = encodeSharedCanvasEvent({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'open',
            role: 'caller',
        })
        const closeRaw = encodeSharedCanvasEvent({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'close',
            role: 'callee',
        })
        const clearRaw = encodeSharedCanvasEvent({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'clear',
            role: 'caller',
        })

        expect(parseSharedCanvasEvent(openRaw)).toEqual({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'open',
            role: 'caller',
        })
        expect(parseSharedCanvasEvent(closeRaw)).toEqual({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'close',
            role: 'callee',
        })
        expect(parseSharedCanvasEvent(clearRaw)).toEqual({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'clear',
            role: 'caller',
        })
    })

    it('clamps and parses stroke coordinates', () => {
        const raw = JSON.stringify({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'stroke-point',
            role: 'caller',
            strokeId: ' stroke-1 ',
            x: 2.5,
            y: -4.2,
        })

        expect(parseSharedCanvasEvent(raw)).toEqual({
            protocol: 'vibe-demo/shared-canvas',
            v: 1,
            type: 'stroke-point',
            role: 'caller',
            strokeId: 'stroke-1',
            x: 1,
            y: 0,
        })
    })

    it('returns null for invalid payloads', () => {
        expect(parseSharedCanvasEvent('not-json')).toBeNull()
        expect(parseSharedCanvasEvent('{"type":"open"}')).toBeNull()
        expect(
            parseSharedCanvasEvent(
                JSON.stringify({
                    protocol: 'vibe-demo/shared-canvas',
                    v: 2,
                    type: 'open',
                    role: 'caller',
                }),
            ),
        ).toBeNull()
        expect(
            parseSharedCanvasEvent(
                JSON.stringify({
                    protocol: 'vibe-demo/shared-canvas',
                    v: 1,
                    type: 'stroke-start',
                    role: 'caller',
                    strokeId: '',
                    x: 0.3,
                    y: 0.4,
                }),
            ),
        ).toBeNull()
    })
})
