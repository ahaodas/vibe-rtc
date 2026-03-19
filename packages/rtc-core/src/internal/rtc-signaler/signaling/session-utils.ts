export const createSessionId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    const randomPart = Math.random().toString(16).slice(2, 10)
    return `sess-${Date.now().toString(16)}-${randomPart}`
}

export const getSignalSessionId = (signal: unknown): string | undefined => {
    const raw = (signal as { sessionId?: unknown } | null | undefined)?.sessionId
    if (typeof raw !== 'string') return undefined
    const value = raw.trim()
    return value.length > 0 ? value : undefined
}

export const getSignalTargetSessionId = (signal: unknown): string | undefined => {
    const raw = (signal as { forSessionId?: unknown } | null | undefined)?.forSessionId
    if (typeof raw !== 'string') return undefined
    const value = raw.trim()
    return value.length > 0 ? value : undefined
}

export const errorMessage = (error: unknown): string => {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string') return message
    }
    return String(error)
}

export const isTakeoverWriteError = (error: unknown): boolean => {
    const directMessage = errorMessage(error).toLowerCase()
    if (directMessage.includes('taken over')) return true
    if (!(error && typeof error === 'object' && 'cause' in error)) return false
    const cause = (error as { cause?: unknown }).cause
    const causeMessage = errorMessage(cause).toLowerCase()
    return causeMessage.includes('taken over')
}
