export enum RTCErrorCode {
    ROOM_NOT_SELECTED = 'ROOM_NOT_SELECTED',
    AUTH_REQUIRED = 'AUTH_REQUIRED',
    DB_UNAVAILABLE = 'DB_UNAVAILABLE',
    SIGNAL_TIMEOUT = 'SIGNAL_TIMEOUT',
    WAIT_READY_TIMEOUT = 'WAIT_READY_TIMEOUT',
    SIGNALING_FAILED = 'SIGNALING_FAILED',
    INVALID_STATE = 'INVALID_STATE',
    UNKNOWN = 'UNKNOWN',
}

export type RTCErrorPhase =
    | 'room'
    | 'signaling'
    | 'negotiation'
    | 'reconnect'
    | 'transport'
    | 'lifecycle'

export type RTCErrorOptions = {
    message?: string
    cause?: unknown
    phase?: RTCErrorPhase
    retriable?: boolean
    details?: Record<string, unknown>
}

export class RTCError extends Error {
    readonly code: RTCErrorCode
    readonly cause?: unknown
    readonly phase?: RTCErrorPhase
    readonly retriable: boolean
    readonly details?: Record<string, unknown>

    constructor(code: RTCErrorCode, opts: RTCErrorOptions = {}) {
        super(opts.message ?? code)
        this.name = 'RTCError'
        this.code = code
        this.cause = opts.cause
        this.phase = opts.phase
        this.retriable = opts.retriable ?? false
        this.details = opts.details
    }
}

export function isRTCError(err: unknown): err is RTCError {
    return err instanceof RTCError
}

function toMessage(err: unknown): string {
    if (typeof err === 'string') return err
    if (err && typeof err === 'object' && 'message' in err) {
        const msg = (err as { message?: unknown }).message
        if (typeof msg === 'string') return msg
    }
    return String(err)
}

function guessCodeFromMessage(msg: string, fallbackCode: RTCErrorCode): RTCErrorCode {
    const normalized = msg.toLowerCase()
    if (normalized.includes('room not selected')) return RTCErrorCode.ROOM_NOT_SELECTED
    if (normalized.includes('auth required')) return RTCErrorCode.AUTH_REQUIRED
    return fallbackCode
}

export function toRTCError(
    err: unknown,
    opts: {
        fallbackCode?: RTCErrorCode
        phase?: RTCErrorPhase
        retriable?: boolean
        message?: string
        details?: Record<string, unknown>
    } = {},
): RTCError {
    if (isRTCError(err)) return err
    const fallbackCode = opts.fallbackCode ?? RTCErrorCode.UNKNOWN
    const rawMessage = toMessage(err)
    const code = guessCodeFromMessage(rawMessage, fallbackCode)
    return new RTCError(code, {
        message: opts.message ?? rawMessage,
        cause: err,
        phase: opts.phase,
        retriable: opts.retriable,
        details: opts.details,
    })
}
