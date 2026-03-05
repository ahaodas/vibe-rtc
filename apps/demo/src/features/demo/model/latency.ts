export type LatencyTone = 'none' | 'good' | 'ok' | 'warn' | 'bad'

export function resolveLatencyTone(latencyMs: number | null): LatencyTone {
    if (latencyMs == null) return 'none'
    if (latencyMs < 20) return 'good'
    if (latencyMs < 60) return 'ok'
    if (latencyMs < 120) return 'warn'
    return 'bad'
}
