export function traceDemo(event: string, payload?: unknown) {
    if (typeof window === 'undefined') return

    const entry = {
        at: new Date().toISOString(),
        event,
        payload,
    }

    const buffer = window.__vibeRtcTrace ?? []
    buffer.push(entry)
    if (buffer.length > 400) buffer.splice(0, buffer.length - 400)
    window.__vibeRtcTrace = buffer

    if (payload === undefined) {
        console.info(`[vibe-demo] ${event}`)
        return
    }

    try {
        console.info(`[vibe-demo] ${event}\n${JSON.stringify(payload, null, 4)}`)
    } catch {
        console.info(`[vibe-demo] ${event}\n${String(payload)}`)
    }
}
