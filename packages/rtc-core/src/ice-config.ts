const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302']

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
    {
        urls: DEFAULT_STUN_URLS,
    },
]

function cloneIceServer(server: RTCIceServer): RTCIceServer {
    const out: RTCIceServer = { ...server }
    if (Array.isArray(server.urls)) out.urls = [...server.urls]
    return out
}

function cloneIceServers(servers: RTCIceServer[]): RTCIceServer[] {
    return servers.map(cloneIceServer)
}

function parseCsvUrls(raw: string): string[] {
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
}

function normalizeParsedIceServer(input: unknown): RTCIceServer | null {
    if (!input || typeof input !== 'object') return null
    const server = input as RTCIceServer
    if (!server.urls) return null
    return cloneIceServer(server)
}

export function parseIceServers(raw: string | undefined | null): RTCIceServer[] | undefined {
    if (!raw) return undefined
    const source = raw.trim()
    if (!source) return undefined

    if (source.startsWith('[') || source.startsWith('{')) {
        let parsed: unknown
        try {
            parsed = JSON.parse(source)
        } catch (error) {
            throw new Error(`Invalid ICE servers JSON: ${(error as Error).message}`)
        }

        if (Array.isArray(parsed)) {
            const servers = parsed.map(normalizeParsedIceServer).filter(Boolean) as RTCIceServer[]
            if (!servers.length) throw new Error('ICE servers JSON array is empty or invalid')
            return servers
        }

        const single = normalizeParsedIceServer(parsed)
        if (!single) throw new Error('ICE servers JSON object must include "urls"')
        return [single]
    }

    const urls = parseCsvUrls(source)
    if (!urls.length) return undefined
    return [{ urls }]
}

export function withDefaultIceServers(
    rtcConfiguration?: RTCConfiguration,
    fallbackIceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
): RTCConfiguration {
    const config = rtcConfiguration ? { ...rtcConfiguration } : {}
    if (config.iceServers && config.iceServers.length > 0) return config
    return {
        ...config,
        iceServers: cloneIceServers(fallbackIceServers),
    }
}
