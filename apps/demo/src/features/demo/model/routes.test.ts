import { describe, expect, it } from 'vitest'
import { APP_BASE_PATH } from '@/features/demo/model/constants'
import { DEMO_ROUTE_QUERY_KEYS } from '@/features/demo/model/routePaths'
import {
    toBasePath,
    toCalleeUrl,
    toRouteStrategyMode,
    toSessionPath,
} from '@/features/demo/model/routes'

describe('routes model', () => {
    it('maps strategy mode from query value', () => {
        expect(toRouteStrategyMode('native')).toBe('native')
        expect(toRouteStrategyMode('default')).toBe('default')
        expect(toRouteStrategyMode('something-else')).toBe('default')
        expect(toRouteStrategyMode(null)).toBe('default')
        expect(toRouteStrategyMode(undefined)).toBe('default')
    })

    it('builds session path with encoded room id and optional native strategy', () => {
        expect(toSessionPath('caller', 'room A/1', 'default')).toBe('/attach/caller/room%20A%2F1')
        expect(toSessionPath('callee', 'room A/1', 'native')).toBe(
            `/attach/callee/room%20A%2F1?${DEMO_ROUTE_QUERY_KEYS.strategy}=native`,
        )
    })

    it('keeps optional sessionId in session route query', () => {
        expect(toSessionPath('callee', 'room-1', 'default', 'session-1')).toBe(
            `/attach/callee/room-1?${DEMO_ROUTE_QUERY_KEYS.sessionId}=session-1`,
        )
        expect(toSessionPath('callee', 'room-1', 'native', 'session-1')).toBe(
            `/attach/callee/room-1?${DEMO_ROUTE_QUERY_KEYS.strategy}=native&${DEMO_ROUTE_QUERY_KEYS.sessionId}=session-1`,
        )
    })

    it('normalizes base path with and without a leading slash', () => {
        expect(toBasePath('attach')).toBe(`${APP_BASE_PATH}/attach`)
        expect(toBasePath('/attach')).toBe(`${APP_BASE_PATH}/attach`)
    })

    it('builds callee url from origin, base path and hash attach path', () => {
        const attachPath = toSessionPath('callee', 'room-42', 'native')
        expect(toCalleeUrl('room-42', 'native')).toBe(
            `${window.location.origin}${toBasePath('/')}#${attachPath}`,
        )
    })
})
