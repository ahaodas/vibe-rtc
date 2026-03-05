import { useEffect } from 'react'

type UseSessionModalStateArgs = {
    role: 'caller' | 'callee'
    roomId: string
    isRoomNotFoundError: boolean
    isTakeoverError: boolean
    takeoverModalOpen: boolean
    channelReadyForMessages: boolean
    setRoomNotFoundModalOpen: (value: boolean) => void
    setTakeoverModalOpen: (value: boolean) => void
    setSecurityTakeoverDetected: (value: boolean) => void
    setTakeoverBySessionId: (value: string | null) => void
    setQrModalOpen: (value: boolean) => void
}

export function useSessionModalState({
    role,
    roomId,
    isRoomNotFoundError,
    isTakeoverError,
    takeoverModalOpen,
    channelReadyForMessages,
    setRoomNotFoundModalOpen,
    setTakeoverModalOpen,
    setSecurityTakeoverDetected,
    setTakeoverBySessionId,
    setQrModalOpen,
}: UseSessionModalStateArgs) {
    useEffect(() => {
        if (!isRoomNotFoundError) return
        setRoomNotFoundModalOpen(true)
    }, [isRoomNotFoundError, setRoomNotFoundModalOpen])

    useEffect(() => {
        if (!isTakeoverError) return

        setTakeoverModalOpen(true)
        setSecurityTakeoverDetected(false)
        setTakeoverBySessionId(null)
    }, [isTakeoverError, setSecurityTakeoverDetected, setTakeoverBySessionId, setTakeoverModalOpen])

    useEffect(() => {
        if (isTakeoverError || takeoverModalOpen) {
            setQrModalOpen(false)
            return
        }

        if (role === 'caller' && roomId && !channelReadyForMessages) {
            setQrModalOpen(true)
            return
        }

        setQrModalOpen(false)
    }, [channelReadyForMessages, isTakeoverError, role, roomId, setQrModalOpen, takeoverModalOpen])
}
