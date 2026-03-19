export const DEMO_ROUTE_PATHS = {
    home: '/',
    attach: '/attach',
    attachSession: '/attach/:role/:roomId',
    wildcard: '*',
} as const

export const DEMO_ROUTE_QUERY_KEYS = {
    strategy: 'strategy',
    sessionId: 'sessionId',
    role: 'role',
    as: 'as',
    roomId: 'roomId',
    room: 'room',
} as const
