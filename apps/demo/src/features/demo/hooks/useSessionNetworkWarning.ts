import { useEffect, useRef } from 'react'
import {
    HIGH_DIRECT_NET_RTT_MS,
    HIGH_DIRECT_NET_RTT_STREAK,
    WARNING_COOLDOWN_MS,
    WARNING_STICKY_MS,
} from '@/features/demo/model/constants'
import type { NetWarningState } from '@/features/demo/model/sessionReducer'
import type { WarningKey } from '@/features/demo/model/types'

type UseSessionNetworkWarningArgs = {
    isRelayRoute: boolean
    netRttMs: number | null
    netWarning: NetWarningState | null
    setNetWarning: (value: NetWarningState | null) => void
}

export function useSessionNetworkWarning({
    isRelayRoute,
    netRttMs,
    netWarning,
    setNetWarning,
}: UseSessionNetworkWarningArgs) {
    const warningTimerRef = useRef<number | undefined>(undefined)
    const warningCooldownRef = useRef<Record<WarningKey, number>>({ relay: 0, 'high-direct': 0 })
    const highDirectStreakRef = useRef(0)

    useEffect(() => {
        const showWarning = (key: WarningKey, message: string) => {
            const nowTs = Date.now()
            const lastTs = warningCooldownRef.current[key] ?? 0
            if (nowTs - lastTs < WARNING_COOLDOWN_MS) return

            warningCooldownRef.current[key] = nowTs
            setNetWarning({ key, message })

            if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)

            warningTimerRef.current = window.setTimeout(() => {
                setNetWarning(null)
                warningTimerRef.current = undefined
            }, WARNING_STICKY_MS)
        }

        if (isRelayRoute) {
            highDirectStreakRef.current = 0
            if (netWarning?.key === 'relay') setNetWarning(null)
            return
        }

        if (typeof netRttMs === 'number' && netRttMs > HIGH_DIRECT_NET_RTT_MS) {
            highDirectStreakRef.current += 1
            if (highDirectStreakRef.current >= HIGH_DIRECT_NET_RTT_STREAK) {
                showWarning(
                    'high-direct',
                    'High network RTT on direct connection — check Wi-Fi / power saving / device load.',
                )
                highDirectStreakRef.current = 0
            }
            return
        }

        highDirectStreakRef.current = 0
    }, [isRelayRoute, netRttMs, netWarning?.key, setNetWarning])

    useEffect(() => {
        return () => {
            if (!warningTimerRef.current) return
            window.clearTimeout(warningTimerRef.current)
            warningTimerRef.current = undefined
        }
    }, [])
}
