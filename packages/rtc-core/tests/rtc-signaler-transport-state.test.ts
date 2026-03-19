import { describe, expect, it } from 'vitest'
import {
    areBothDataChannelsOpen,
    isAnyDataChannelOpen,
    isClosedOrFailedTransportState,
    isConnectedTransportState,
} from '../src/internal/rtc-signaler/connection/transport-state'

const mockChannel = (readyState: RTCDataChannelState) =>
    ({ readyState }) as unknown as RTCDataChannel

describe('rtc-signaler transport state helpers', () => {
    it('detects connected transport states', () => {
        expect(isConnectedTransportState('connected', 'new')).toBe(true)
        expect(isConnectedTransportState('connecting', 'connected')).toBe(true)
        expect(isConnectedTransportState('connecting', 'completed')).toBe(true)
        expect(isConnectedTransportState('connecting', 'checking')).toBe(false)
    })

    it('detects unhealthy transport states', () => {
        expect(isClosedOrFailedTransportState('disconnected', 'new')).toBe(true)
        expect(isClosedOrFailedTransportState('connected', 'failed')).toBe(true)
        expect(isClosedOrFailedTransportState('connected', 'connected')).toBe(false)
    })

    it('detects data channel open states', () => {
        const open = mockChannel('open')
        const closed = mockChannel('closed')
        expect(areBothDataChannelsOpen(open, open)).toBe(true)
        expect(areBothDataChannelsOpen(open, closed)).toBe(false)
        expect(isAnyDataChannelOpen(open, closed)).toBe(true)
        expect(isAnyDataChannelOpen(closed, closed)).toBe(false)
    })
})
