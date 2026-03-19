import { APP_BASE_PATH } from '@/features/demo/model/constants'
import { DEMO_ROUTE_PATHS, DEMO_ROUTE_QUERY_KEYS } from '@/features/demo/model/routePaths'
import type { AttachRole, RouteStrategyMode } from '@/features/demo/model/types'

export function toRouteStrategyMode(value: string | null | undefined): RouteStrategyMode {
    return value === 'native' ? 'native' : 'default'
}

export function toSessionPath(
    role: AttachRole,
    roomId: string,
    strategyMode: RouteStrategyMode,
    sessionId?: string | null,
) {
    const encodedRoomId = encodeURIComponent(roomId)
    const basePath = `${DEMO_ROUTE_PATHS.attach}/${role}/${encodedRoomId}`
    const query = new URLSearchParams()
    if (strategyMode === 'native') query.set(DEMO_ROUTE_QUERY_KEYS.strategy, 'native')
    const normalizedSessionId = sessionId?.trim()
    if (normalizedSessionId) query.set(DEMO_ROUTE_QUERY_KEYS.sessionId, normalizedSessionId)
    const queryString = query.toString()
    return queryString ? `${basePath}?${queryString}` : basePath
}

export function toBasePath(path: string) {
    return `${APP_BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`
}

export function toCalleeUrl(roomId: string, strategyMode: RouteStrategyMode) {
    const attachPath = toSessionPath('callee', roomId, strategyMode)
    return `${window.location.origin}${toBasePath('/')}#${attachPath}`
}
