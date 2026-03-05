import type { VibeRTCContextValue } from '@vibe-rtc/rtc-react'
import { useEffect, useRef } from 'react'
import { traceDemo } from '@/features/demo/model/trace'
import type { AttachRole } from '@/features/demo/model/types'

type UseSessionTracingArgs = {
    rtc: VibeRTCContextValue
    role: AttachRole
    roomId: string
}

export function useSessionTracing({ rtc, role, roomId }: UseSessionTracingArgs) {
    const prevDebugTraceKeyRef = useRef<string | null>(null)

    useEffect(() => {
        if (!rtc.lastError) return

        traceDemo('state:last_error', {
            code: rtc.lastError.code ?? null,
            message: rtc.lastError.message,
            at: rtc.lastError.at,
            role,
            roomId,
        })
    }, [rtc.lastError, role, roomId])

    useEffect(() => {
        traceDemo('state:overall_status', {
            overallStatus: rtc.overallStatus,
            statusText: rtc.overallStatusText,
            role,
            roomId,
        })
    }, [rtc.overallStatus, rtc.overallStatusText, role, roomId])

    useEffect(() => {
        const debug = rtc.debugState
        if (!debug) return

        const key = [
            debug.pcGeneration,
            debug.phase,
            debug.lastEvent ?? 'none',
            debug.pcState,
            debug.iceState,
            debug.signalingState,
            debug.icePhase,
            debug.sessionId ?? 'none',
        ].join('|')

        if (prevDebugTraceKeyRef.current === key) return

        prevDebugTraceKeyRef.current = key

        traceDemo('state:debug', {
            lastEvent: debug.lastEvent ?? null,
            phase: debug.phase,
            pcState: debug.pcState,
            iceState: debug.iceState,
            signalingState: debug.signalingState,
            icePhase: debug.icePhase,
            sessionId: debug.sessionId,
            participantId: debug.participantId,
            generation: debug.pcGeneration,
            pendingIce: debug.pendingIce,
            fast: debug.fast ?? null,
            reliable: debug.reliable ?? null,
        })
    }, [rtc.debugState])
}
