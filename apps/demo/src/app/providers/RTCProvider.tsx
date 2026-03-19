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
import {
    DemoSecurityBusProvider,
    useCreateDemoSecurityBus,
} from '@/features/demo/model/securityBus'

type RTCProviderProps = {
    children: ReactNode
}

export function RTCProvider({ children }: RTCProviderProps) {
    const securityBus = useCreateDemoSecurityBus()
    const { publishRoomOccupied, publishShareLink, publishTakenOver } = securityBus
    const rtcConfiguration = createDemoRtcConfiguration()

    const createSignalServer = useCallback(async () => {
        return await createDemoSignalServer({
            publishRoomOccupied,
            publishShareLink,
            publishTakenOver,
        })()
    }, [publishRoomOccupied, publishShareLink, publishTakenOver])

    return (
        <DemoSecurityBusProvider value={securityBus}>
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
        </DemoSecurityBusProvider>
    )
}
