import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSessionModalState } from '@/features/demo/hooks/useSessionModalState'

type HookProps = Parameters<typeof useSessionModalState>[0]

function makeProps(overrides: Partial<HookProps> = {}): HookProps {
    return {
        role: 'caller',
        roomId: 'room-1',
        isRoomNotFoundError: false,
        isTakeoverError: false,
        takeoverModalOpen: false,
        channelReadyForMessages: false,
        setRoomNotFoundModalOpen: vi.fn(),
        setTakeoverModalOpen: vi.fn(),
        setSecurityTakeoverDetected: vi.fn(),
        setTakeoverBySessionId: vi.fn(),
        setQrModalOpen: vi.fn(),
        ...overrides,
    }
}

describe('useSessionModalState', () => {
    it('opens room-not-found modal when room-not-found error appears', () => {
        const props = makeProps({ isRoomNotFoundError: true })

        renderHook(() => useSessionModalState(props))

        expect(props.setRoomNotFoundModalOpen).toHaveBeenCalledWith(true)
    })

    it('opens takeover modal on takeover error', () => {
        const props = makeProps({ isTakeoverError: true })

        renderHook(() => useSessionModalState(props))

        expect(props.setTakeoverModalOpen).toHaveBeenCalledWith(true)
        expect(props.setSecurityTakeoverDetected).toHaveBeenCalledWith(false)
        expect(props.setTakeoverBySessionId).toHaveBeenCalledWith(null)
        expect(props.setQrModalOpen).toHaveBeenCalledWith(false)
    })

    it('opens qr modal for caller while channel is not ready', () => {
        const props = makeProps({
            role: 'caller',
            roomId: 'room-qr',
            channelReadyForMessages: false,
            isTakeoverError: false,
            takeoverModalOpen: false,
        })

        renderHook(() => useSessionModalState(props))

        expect(props.setQrModalOpen).toHaveBeenCalledWith(true)
    })

    it('hides qr modal for callee or ready channel', () => {
        const calleeProps = makeProps({
            role: 'callee',
            channelReadyForMessages: false,
        })

        renderHook(() => useSessionModalState(calleeProps))

        expect(calleeProps.setQrModalOpen).toHaveBeenCalledWith(false)

        const readyProps = makeProps({
            role: 'caller',
            channelReadyForMessages: true,
        })

        renderHook(() => useSessionModalState(readyProps))

        expect(readyProps.setQrModalOpen).toHaveBeenCalledWith(false)
    })
})
