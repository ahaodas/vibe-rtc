import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionQrCode } from '@/features/demo/hooks/useSessionQrCode'

const { mockedToDataURL } = vi.hoisted(() => ({
    mockedToDataURL: vi.fn(),
}))

vi.mock('qrcode', () => ({
    toDataURL: mockedToDataURL,
}))

describe('useSessionQrCode', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockedToDataURL.mockReset()
        document.documentElement.style.setProperty('--bg', '#112233')
        document.documentElement.style.setProperty('--accent', '#aabbcc')
    })

    it('uses palette from CSS variables for QR colors', async () => {
        mockedToDataURL.mockResolvedValue('data:image/png;base64,qr')
        const onChange = vi.fn()

        renderHook(() => useSessionQrCode({ calleeUrl: 'https://example.test/room', onChange }))

        await waitFor(() => {
            expect(mockedToDataURL).toHaveBeenCalledWith('https://example.test/room', {
                width: 768,
                margin: 0,
                color: {
                    dark: '#aabbcc',
                    light: '#112233',
                },
            })
        })
        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith('data:image/png;base64,qr')
        })
    })

    it('resets qr data when callee url is empty', () => {
        const onChange = vi.fn()

        renderHook(() => useSessionQrCode({ calleeUrl: '', onChange }))

        expect(onChange).toHaveBeenCalledWith('')
        expect(mockedToDataURL).not.toHaveBeenCalled()
    })
})
