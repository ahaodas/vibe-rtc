export type AttachRole = 'caller' | 'callee'

export type RouteStrategyMode = 'default' | 'native'

export type SessionConnectOptions = {
    connectionStrategy: 'BROWSER_NATIVE'
}

export type WarningKey = 'relay' | 'high-direct'

export type DemoTraceEntry = {
    at: string
    event: string
    payload?: unknown
}

declare global {
    interface Window {
        __vibeRtcTrace?: DemoTraceEntry[]
    }
}
