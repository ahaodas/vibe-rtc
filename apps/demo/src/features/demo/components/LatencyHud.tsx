import type { LatencyTone } from '@/features/demo/model/latency'

type SelectedRoute = {
    localCandidateType?: string | null
    remoteCandidateType?: string | null
    isRelay?: boolean
}

type LatencyHudProps = {
    netLatencyTone: LatencyTone
    netRttMs: number | null
    appPingMs: number | null
    selectedRoute?: SelectedRoute
}

export function LatencyHud({
    netLatencyTone,
    netRttMs,
    appPingMs,
    selectedRoute,
}: LatencyHudProps) {
    const routeLocalType = selectedRoute?.localCandidateType ?? 'unknown'
    const routeRemoteType = selectedRoute?.remoteCandidateType ?? 'unknown'
    const isRelayRoute = selectedRoute?.isRelay === true
    const routeLabel = selectedRoute ? (isRelayRoute ? 'TURN/Relay' : 'Direct') : 'Unknown'
    const routeDetails = selectedRoute ? `${routeLocalType} -> ${routeRemoteType}` : 'unknown'

    return (
        <div className={`latencyHud net-${netLatencyTone}`} data-testid="latency-hud">
            <div className="latencyNetLine" data-testid="latency-net-rtt">
                NET: {netRttMs == null ? '--' : `${netRttMs} ms`}
            </div>
            <div className="latencyAppLine" data-testid="latency-app-rtt">
                APP: {appPingMs == null ? '--' : `${appPingMs} ms`}
            </div>
            <div className="latencyAppLine" data-testid="latency-path-type">
                PATH: {routeLabel}
                {isRelayRoute ? <span className="latencyRelayTag">(TURN)</span> : null}
            </div>
            <div className="latencyAppLine" data-testid="latency-route-details">
                ROUTE: {routeDetails}
            </div>
        </div>
    )
}
