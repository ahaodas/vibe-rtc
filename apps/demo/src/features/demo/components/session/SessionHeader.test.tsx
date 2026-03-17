import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionHeader } from '@/features/demo/components/session/SessionHeader'

describe('SessionHeader', () => {
    it('renders role, room id, status and latency widgets', () => {
        const props = {
            role: 'caller' as const,
            roomId: 'room-abc',
            netLatencyTone: 'ok' as const,
            netRttMs: 34,
            appPingMs: 12,
            selectedRoute: {
                localCandidateType: 'host',
                remoteCandidateType: 'srflx',
                isRelay: false,
            },
            statusText: 'Connected',
            statusClassName: 'statusConnected',
            netWarningMessage: null,
            connectProgressRatio: 0.5,
            showQrButton: false,
            qrButtonDisabled: false,
            onShowQr: vi.fn(),
            onOpenLeaveConfirm: vi.fn(),
        }

        render(<SessionHeader {...props} />)

        expect(screen.getByTestId('session-role-title')).toHaveTextContent('CALLER')
        expect(screen.getByTestId('session-room-id-input')).toHaveValue('room-abc')
        expect(screen.getByTestId('session-status-text')).toHaveTextContent('Connected')
        expect(screen.getByTestId('latency-net-rtt')).toHaveTextContent('NET: 34 ms')
        expect(screen.getByTestId('latency-app-rtt')).toHaveTextContent('APP: 12 ms')
        expect(screen.queryByTestId('session-net-warning')).not.toBeInTheDocument()
        expect(screen.queryByTestId('show-qr-btn')).not.toBeInTheDocument()
    })

    it('renders net warning and forwards QR/close actions', () => {
        const onShowQr = vi.fn()
        const onOpenLeaveConfirm = vi.fn()
        const props = {
            role: 'callee' as const,
            roomId: 'room-qr',
            netLatencyTone: 'warn' as const,
            netRttMs: 87,
            appPingMs: 40,
            selectedRoute: {
                localCandidateType: 'relay',
                remoteCandidateType: 'relay',
                isRelay: true,
            },
            statusText: 'Connecting...',
            statusClassName: 'statusConnecting',
            netWarningMessage: 'Relay route detected.',
            connectProgressRatio: 0.25,
            showQrButton: true,
            qrButtonDisabled: false,
            onShowQr,
            onOpenLeaveConfirm,
        }

        render(<SessionHeader {...props} />)

        fireEvent.click(screen.getByTestId('show-qr-btn'))
        fireEvent.click(screen.getByTestId('session-close-btn'))

        expect(onShowQr).toHaveBeenCalledTimes(1)
        expect(onOpenLeaveConfirm).toHaveBeenCalledTimes(1)
        expect(screen.getByTestId('session-net-warning')).toHaveTextContent('Relay route detected.')
        expect(screen.getByTestId('latency-path-type')).toHaveTextContent('PATH: TURN/Relay')
    })
})
