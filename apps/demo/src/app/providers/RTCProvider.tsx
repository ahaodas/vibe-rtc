import { VibeRTCProvider } from '@vibe-rtc/rtc-react'
import type { ReactNode } from 'react'
import { useCallback } from 'react'
import { BootLoadingOverlay, renderRtcBootError } from '@/app/providers/rtc/boot-ui'
import { createDemoSignalServer } from '@/app/providers/rtc/create-signal-server'
import { createDemoRtcConfiguration } from '@/app/providers/rtc/rtc-configuration'
import {
    DEMO_LAN_FIRST_TIMEOUT_MS,
    DEMO_NET_RTT_INTERVAL_MS,
    DEMO_PING_INTERVAL_MS,
    DEMO_PING_WINDOW_SIZE,
} from '@/features/demo/model/constants'

type RTCProviderProps = {
    children: ReactNode
}

export function RTCProvider({ children }: RTCProviderProps) {
    const rtcConfiguration = createDemoRtcConfiguration()

    const createSignalServer = useCallback(async () => {
        return await createDemoSignalServer()()
    }, [])

    return (
        <VibeRTCProvider
            rtcConfiguration={rtcConfiguration}
            connectionStrategy="LAN_FIRST"
            lanFirstTimeoutMs={DEMO_LAN_FIRST_TIMEOUT_MS}
            pingIntervalMs={DEMO_PING_INTERVAL_MS}
            pingWindowSize={DEMO_PING_WINDOW_SIZE}
            netRttIntervalMs={DEMO_NET_RTT_INTERVAL_MS}
            renderLoading={<BootLoadingOverlay />}
            renderBootError={renderRtcBootError}
            createSignalServer={createSignalServer}
        >
            {children}
        </VibeRTCProvider>
    )
}
