import {
    resolveNetRttLifecycleAction,
    type SignalerPhase,
    shouldRunPingLifecycle,
} from './runtime-lifecycle'

type PingServiceLike = {
    start: () => void
    pause: () => void
}

type NetRttServiceLike = {
    start: () => void
    stop: () => void
    pause: () => void
}

interface MetricsLifecycleDeps {
    phase: SignalerPhase
    roomId: string | null
    isAnyDataChannelsOpen: () => boolean
    pingService: PingServiceLike
    netRttService?: NetRttServiceLike
    pc?: RTCPeerConnection
}

// Controls ping + network RTT probe lifecycle based on RTCSignaler runtime state.
// Deps remains loosely typed to avoid coupling to RTCSignaler private fields.
export class MetricsLifecycleService {
    constructor(private readonly deps: MetricsLifecycleDeps) {}

    syncPingLifecycle() {
        if (
            shouldRunPingLifecycle(
                this.deps.phase,
                this.deps.roomId,
                this.deps.isAnyDataChannelsOpen(),
            )
        ) {
            this.deps.pingService.start()
            return
        }
        this.deps.pingService.pause()
    }

    syncNetRttLifecycle() {
        const netRtt = this.deps.netRttService
        if (!netRtt || !this.deps.pc) return
        const action = resolveNetRttLifecycleAction({
            phase: this.deps.phase,
            roomId: this.deps.roomId,
            connectionState: this.deps.pc.connectionState,
            iceConnectionState: this.deps.pc.iceConnectionState,
        })
        if (action === 'start') {
            netRtt.start()
            return
        }
        if (action === 'stop') {
            netRtt.stop()
            return
        }
        netRtt.pause()
    }
}
