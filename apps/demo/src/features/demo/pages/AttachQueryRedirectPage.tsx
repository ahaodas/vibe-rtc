import { Navigate, useSearchParams } from 'react-router-dom'
import { DEMO_ROUTE_PATHS, DEMO_ROUTE_QUERY_KEYS } from '@/features/demo/model/routePaths'
import { toRouteStrategyMode, toSessionPath } from '@/features/demo/model/routes'

export function AttachQueryRedirectPage() {
    const [searchParams] = useSearchParams()

    const roleRaw =
        searchParams.get(DEMO_ROUTE_QUERY_KEYS.role) ?? searchParams.get(DEMO_ROUTE_QUERY_KEYS.as)
    const roomIdRaw =
        searchParams.get(DEMO_ROUTE_QUERY_KEYS.roomId) ??
        searchParams.get(DEMO_ROUTE_QUERY_KEYS.room)
    const strategyMode = toRouteStrategyMode(searchParams.get(DEMO_ROUTE_QUERY_KEYS.strategy))

    const role = roleRaw === 'caller' || roleRaw === 'callee' ? roleRaw : null
    const roomId = roomIdRaw?.trim() ?? ''

    if (!role || !roomId) {
        return <Navigate to={DEMO_ROUTE_PATHS.home} replace />
    }

    return <Navigate to={toSessionPath(role, roomId, strategyMode)} replace />
}
