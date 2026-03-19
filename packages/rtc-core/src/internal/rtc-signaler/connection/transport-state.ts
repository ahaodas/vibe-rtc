export const isConnectedTransportState = (
    connectionState?: RTCPeerConnectionState | null,
    iceState?: RTCIceConnectionState | null,
): boolean =>
    connectionState === 'connected' || iceState === 'connected' || iceState === 'completed'

export const isClosedOrFailedTransportState = (
    connectionState?: RTCPeerConnectionState | null,
    iceState?: RTCIceConnectionState | null,
): boolean =>
    connectionState === 'disconnected' ||
    connectionState === 'failed' ||
    connectionState === 'closed' ||
    iceState === 'disconnected' ||
    iceState === 'failed' ||
    iceState === 'closed'

export const areBothDataChannelsOpen = (
    fast?: RTCDataChannel,
    reliable?: RTCDataChannel,
): boolean => fast?.readyState === 'open' && reliable?.readyState === 'open'

export const isAnyDataChannelOpen = (fast?: RTCDataChannel, reliable?: RTCDataChannel): boolean =>
    fast?.readyState === 'open' || reliable?.readyState === 'open'
