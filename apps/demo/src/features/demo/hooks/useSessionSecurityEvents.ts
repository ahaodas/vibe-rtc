import { useEffect, useRef } from 'react'
import { useDemoSecurityBus } from '@/features/demo/model/securityBus'
import { traceDemo } from '@/features/demo/model/trace'
import type { AttachRole } from '@/features/demo/model/types'

type UseSessionSecurityEventsArgs = {
    isRouteValid: boolean
    role: AttachRole
    roomId: string
    onRoomOccupied: () => void
    onTakenOver: (bySessionId: string | null) => void
}

export function useSessionSecurityEvents({
    isRouteValid,
    role,
    roomId,
    onRoomOccupied,
    onTakenOver,
}: UseSessionSecurityEventsArgs) {
    const { state } = useDemoSecurityBus()

    const handledRoomOccupiedIdRef = useRef<number | null>(null)
    const handledTakenOverIdRef = useRef<number | null>(null)

    useEffect(() => {
        if (!isRouteValid) return

        const event = state.roomOccupied
        if (!event) return
        if (handledRoomOccupiedIdRef.current === event.id) return

        handledRoomOccupiedIdRef.current = event.id

        if (event.payload.roomId !== roomId) return

        traceDemo('security:room_occupied:accepted', {
            detail: event.payload,
            activeRoomId: roomId,
            role,
        })

        onRoomOccupied()
    }, [isRouteValid, onRoomOccupied, role, roomId, state.roomOccupied])

    useEffect(() => {
        if (!isRouteValid) return

        const event = state.takenOver
        if (!event) return
        if (handledTakenOverIdRef.current === event.id) return

        handledTakenOverIdRef.current = event.id

        if (event.payload.roomId !== roomId) return

        traceDemo('security:taken_over:accepted', {
            detail: event.payload,
            activeRoomId: roomId,
            role,
        })

        onTakenOver(event.payload.bySessionId ?? null)
    }, [isRouteValid, onTakenOver, role, roomId, state.takenOver])
}
