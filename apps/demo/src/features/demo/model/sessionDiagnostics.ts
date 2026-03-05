export function toPingMs(raw: number | undefined | null): number | null {
    if (typeof raw !== 'number') return null
    if (!Number.isFinite(raw) || raw < 0) return null
    return Math.round(raw)
}

export function isRoomNotFoundError(
    message: string | undefined,
    code: string | undefined,
): boolean {
    return code === 'ROOM_NOT_FOUND' || /room not found|no such document/i.test(message ?? '')
}

export function isTakeoverError(message: string | undefined, code: string | undefined): boolean {
    const safeMessage = message ?? ''
    return (
        code === 'TAKEOVER_DETECTED' ||
        (code === 'INVALID_STATE' && /takeover|taken over/i.test(safeMessage)) ||
        /taken over in another tab|takeover detected/i.test(safeMessage)
    )
}
