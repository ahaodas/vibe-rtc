import * as QRCode from 'qrcode'
import { useEffect } from 'react'

const FALLBACK_QR_FOREGROUND = '#000000'
const FALLBACK_QR_BACKGROUND = '#ffffff'

function resolveQrPalette() {
    if (typeof window === 'undefined') {
        return {
            foreground: FALLBACK_QR_FOREGROUND,
            background: FALLBACK_QR_BACKGROUND,
        }
    }

    const styles = window.getComputedStyle(document.documentElement)
    const foreground = styles.getPropertyValue('--accent').trim()
    const background = styles.getPropertyValue('--bg').trim()

    return {
        foreground: foreground || FALLBACK_QR_FOREGROUND,
        background: background || FALLBACK_QR_BACKGROUND,
    }
}

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

        const palette = resolveQrPalette()

        void QRCode.toDataURL(calleeUrl, {
            width: 768,
            margin: 0,
            color: {
                dark: palette.foreground,
                light: palette.background,
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
