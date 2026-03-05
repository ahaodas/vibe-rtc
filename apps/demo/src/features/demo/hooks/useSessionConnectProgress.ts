import { useEffect, useRef } from 'react'
import {
    CONNECT_PROGRESS_MAX_BEFORE_READY,
    CONNECT_PROGRESS_STEP,
    CONNECT_PROGRESS_TICK_MS,
} from '@/features/demo/model/constants'

type UseSessionConnectProgressArgs = {
    channelReadyForMessages: boolean
    overallStatus: string
    setConnectProgressRatio: (value: number) => void
    tickConnectProgress: (step: number, max: number) => void
}

export function useSessionConnectProgress({
    channelReadyForMessages,
    overallStatus,
    setConnectProgressRatio,
    tickConnectProgress,
}: UseSessionConnectProgressArgs) {
    const prevOverallStatusRef = useRef<string | null>(null)

    useEffect(() => {
        if (channelReadyForMessages || overallStatus === 'error') {
            setConnectProgressRatio(0)
            return
        }

        const timerId = window.setInterval(() => {
            tickConnectProgress(CONNECT_PROGRESS_STEP, CONNECT_PROGRESS_MAX_BEFORE_READY)
        }, CONNECT_PROGRESS_TICK_MS)

        return () => window.clearInterval(timerId)
    }, [channelReadyForMessages, overallStatus, setConnectProgressRatio, tickConnectProgress])

    useEffect(() => {
        const previous = prevOverallStatusRef.current

        if (overallStatus === 'connecting' && previous !== 'connecting') {
            setConnectProgressRatio(0)
        }

        prevOverallStatusRef.current = overallStatus
    }, [overallStatus, setConnectProgressRatio])
}
