import * as QRCode from 'qrcode'
import { useEffect } from 'react'
import { QR_BACKGROUND, QR_FOREGROUND } from '@/features/demo/model/constants'

type UseSessionQrCodeArgs = {
    calleeUrl: string
    onChange: (value: string) => void
}

export function useSessionQrCode({ calleeUrl, onChange }: UseSessionQrCodeArgs) {
    useEffect(() => {
        let cancelled = false

        if (!calleeUrl) {
            onChange('')
            return
        }

        void QRCode.toDataURL(calleeUrl, {
            width: 768,
            margin: 0,
            color: {
                dark: QR_FOREGROUND,
                light: QR_BACKGROUND,
            },
        })
            .then((dataUrl) => {
                if (cancelled) return
                onChange(dataUrl)
            })
            .catch(() => {
                if (cancelled) return
                onChange('')
            })

        return () => {
            cancelled = true
        }
    }, [calleeUrl, onChange])
}
