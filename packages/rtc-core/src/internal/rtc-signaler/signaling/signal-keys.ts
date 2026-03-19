export interface DescriptionSignalKeyInput {
    sessionId?: string
    forSessionId?: string
    forGen?: number
    gen?: number
    pcGeneration?: number
    forPcGeneration?: number
    sdp?: string | null
}

export const createDescriptionSignalKey = (input: DescriptionSignalKeyInput): string => {
    const generation =
        input.forGen ?? input.gen ?? input.pcGeneration ?? input.forPcGeneration ?? -1
    return `${input.sessionId ?? 'n/a'}|${input.forSessionId ?? 'n/a'}|${generation}|${input.sdp ?? ''}`
}

export const createStaleSessionLogKey = (
    source: 'offer' | 'answer' | 'candidate',
    remoteSessionId: string | undefined,
    currentSessionId: string | null,
): string => `${source}:${remoteSessionId ?? 'missing'}:${currentSessionId ?? 'none'}`
