import { type RTCError, RTCErrorCode } from '../../../errors'
import { isWaitReadySatisfied } from './wait-ready'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ReadinessDeps {
    pc?: RTCPeerConnection
    dcFast?: RTCDataChannel
    dcReliable?: RTCDataChannel
    defaultWaitReadyTimeoutMs: number
    isTakeoverStopping: () => boolean
    raiseError: (
        err: unknown,
        fallbackCode: RTCErrorCode,
        phase: 'transport',
        retriable: boolean,
        message?: string,
        rethrow?: boolean,
        details?: Record<string, unknown>,
    ) => RTCError
}

// Handles readiness polling and transport inspection snapshots.
// Deps stays loosely typed to avoid coupling to RTCSignaler private surface.
export class ReadinessService {
    constructor(private readonly deps: ReadinessDeps) {}

    inspect() {
        return {
            pcState: this.deps.pc?.connectionState ?? 'none',
            iceState: this.deps.pc?.iceConnectionState ?? 'none',
            signalingState: this.deps.pc?.signalingState ?? 'none',
            fast: this.deps.dcFast
                ? {
                      label: this.deps.dcFast.label,
                      state: this.deps.dcFast.readyState,
                      ba: this.deps.dcFast.bufferedAmount,
                  }
                : null,
            reliable: this.deps.dcReliable
                ? {
                      label: this.deps.dcReliable.label,
                      state: this.deps.dcReliable.readyState,
                      ba: this.deps.dcReliable.bufferedAmount,
                  }
                : null,
        }
    }

    async waitReady(opts: { timeoutMs?: number } = {}) {
        const timeoutMs = opts.timeoutMs ?? this.deps.defaultWaitReadyTimeoutMs
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            if (this.deps.isTakeoverStopping()) {
                throw this.deps.raiseError(
                    new Error('waitReady aborted after takeover'),
                    RTCErrorCode.INVALID_STATE,
                    'transport',
                    false,
                    'waitReady aborted after takeover',
                    false,
                    { inspect: this.inspect(), timeoutMs },
                )
            }
            if (isWaitReadySatisfied(this.inspect())) return
            await sleep(100)
        }
        throw this.deps.raiseError(
            new Error('waitReady timeout'),
            RTCErrorCode.WAIT_READY_TIMEOUT,
            'transport',
            true,
            'waitReady timeout',
            false,
            { inspect: this.inspect(), timeoutMs },
        )
    }
}
