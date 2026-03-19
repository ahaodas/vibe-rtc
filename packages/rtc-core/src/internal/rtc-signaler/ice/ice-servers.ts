const flattenIceUrls = (iceServers: RTCIceServer[]): string[] => {
    const urls: string[] = []
    for (const server of iceServers) {
        const raw = server.urls
        if (typeof raw === 'string') {
            urls.push(raw)
            continue
        }
        if (!Array.isArray(raw)) continue
        for (const url of raw) {
            if (typeof url === 'string') urls.push(url)
        }
    }
    return urls
}

export const summarizeIceServers = (
    iceServers: RTCIceServer[],
): {
    stunCount: number
    turnCount: number
    urlsSample: string[]
} => {
    const urls = flattenIceUrls(iceServers)
    let stunCount = 0
    let turnCount = 0

    for (const url of urls) {
        const lower = url.toLowerCase()
        if (lower.startsWith('stun:') || lower.startsWith('stuns:')) stunCount += 1
        if (lower.startsWith('turn:') || lower.startsWith('turns:')) turnCount += 1
    }

    return {
        stunCount,
        turnCount,
        urlsSample: urls.slice(0, 3),
    }
}
