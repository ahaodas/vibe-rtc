import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { SessionNavigationState } from '@/features/demo/model/sessionNavigation'
import { traceDemo } from '@/features/demo/model/trace'
import type {
    AttachRole,
    RouteStrategyMode,
    SessionConnectOptions,
} from '@/features/demo/model/types'

type UseSessionAttachmentArgs = {
    isRouteValid: boolean
    role: AttachRole
    roomId: string
    strategyMode: RouteStrategyMode
    sessionOptions: SessionConnectOptions | undefined
    attachAsCaller: (roomId: string, options?: SessionConnectOptions) => Promise<void>
    attachAsCallee: (roomId: string, options?: SessionConnectOptions) => Promise<void>
}

export function useSessionAttachment({
    isRouteValid,
    role,
    roomId,
    strategyMode,
    sessionOptions,
    attachAsCaller,
    attachAsCallee,
}: UseSessionAttachmentArgs) {
    const navigate = useNavigate()
    const location = useLocation()

    const skipInitialAttachRef = useRef<boolean>(
        Boolean((location.state as SessionNavigationState | null)?.alreadyAttached),
    )

    useEffect(() => {
        if (!isRouteValid) return
        if (!(location.state as SessionNavigationState | null)?.alreadyAttached) return

        navigate(
            {
                pathname: location.pathname,
                search: location.search,
            },
            { replace: true, state: null },
        )
    }, [isRouteValid, location.pathname, location.search, location.state, navigate])

    useEffect(() => {
        if (!isRouteValid) return

        if (skipInitialAttachRef.current) {
            skipInitialAttachRef.current = false
            traceDemo('attach:skip_initial', { role, roomId, strategyMode })
            return
        }

        traceDemo('attach:start', { role, roomId, strategyMode })

        const attachPromise =
            role === 'caller'
                ? attachAsCaller(roomId, sessionOptions)
                : attachAsCallee(roomId, sessionOptions)

        void attachPromise
            .then(() => {
                traceDemo('attach:ok', { role, roomId, strategyMode })
            })
            .catch((error: unknown) => {
                traceDemo('attach:error', {
                    role,
                    roomId,
                    strategyMode,
                    message: error instanceof Error ? error.message : String(error),
                })
            })
    }, [isRouteValid, role, roomId, strategyMode, sessionOptions, attachAsCaller, attachAsCallee])
}
