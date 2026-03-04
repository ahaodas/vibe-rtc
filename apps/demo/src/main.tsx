// apps/demo/src/main.tsx
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import '@/styles.css'

import { ensureFirebase, FBAdapter } from '@vibe-rtc/rtc-firebase'
import { VibeRTCProvider } from '@vibe-rtc/rtc-react'

const defaultTurnUrls = [
    'turn:a.relay.metered.ca:80?transport=udp',
    'turn:a.relay.metered.ca:80?transport=tcp',
    'turn:a.relay.metered.ca:443',
    'turns:a.relay.metered.ca:443?transport=tcp',
]

const defaultStunUrls = [
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
]

const turnUsername = import.meta.env.VITE_METERED_USER
const turnCredential = import.meta.env.VITE_METERED_CREDENTIAL

const rtcIceServers: RTCIceServer[] = [
    {
        urls: defaultStunUrls,
    },
    ...(turnUsername && turnCredential
        ? [
              {
                  urls: defaultTurnUrls,
                  username: turnUsername,
                  credential: turnCredential,
              } satisfies RTCIceServer,
          ]
        : []),
]

const rtcConfig: RTCConfiguration = {
    iceServers: rtcIceServers,
    iceCandidatePoolSize: 10,
}
const DEMO_LAN_FIRST_TIMEOUT_MS = 4500
const DEMO_PING_INTERVAL_MS = 1000
const DEMO_PING_WINDOW_SIZE = 5
const DEMO_NET_RTT_INTERVAL_MS = 1000
const PROGRESS_STEP_PX = 10
const SECURITY_EVENT_SHARE_LINK = 'vibe:security-share-link'
const SECURITY_EVENT_ROOM_OCCUPIED = 'vibe:security-room-occupied'
const SECURITY_EVENT_TAKEN_OVER = 'vibe:security-taken-over'
const FIRESTORE_EMULATOR_HOST =
    import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ?? import.meta.env.FIRESTORE_EMULATOR_HOST
const FIREBASE_AUTH_EMULATOR_HOST =
    import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST ?? import.meta.env.FIREBASE_AUTH_EMULATOR_HOST

const PRIMARY_HUE_SHIFT_VARS = [
    '--bg',
    '--secondary-bg',
    '--accent',
    '--secondary-accent',
    '--border-light',
    '--border-dark',
    '--slider',
    '--scrollbar-track',
] as const
const HUE_SHIFT_RANGE_DEG = 45

function parseHexColor(raw: string): { r: number; g: number; b: number } | null {
    if (!raw.startsWith('#')) return null
    const hex = raw.slice(1).trim()
    if (hex.length === 3) {
        const r = Number.parseInt(`${hex[0]}${hex[0]}`, 16)
        const g = Number.parseInt(`${hex[1]}${hex[1]}`, 16)
        const b = Number.parseInt(`${hex[2]}${hex[2]}`, 16)
        if ([r, g, b].some((value) => Number.isNaN(value))) return null
        return { r, g, b }
    }
    if (hex.length === 6) {
        const r = Number.parseInt(hex.slice(0, 2), 16)
        const g = Number.parseInt(hex.slice(2, 4), 16)
        const b = Number.parseInt(hex.slice(4, 6), 16)
        if ([r, g, b].some((value) => Number.isNaN(value))) return null
        return { r, g, b }
    }
    return null
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2

    if (max === min) return { h: 0, s: 0, l }

    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    let h = 0
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h /= 6

    return { h: h * 360, s, l }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    const c = (1 - Math.abs(2 * l - 1)) * s
    const hp = h / 60
    const x = c * (1 - Math.abs((hp % 2) - 1))

    let rn = 0
    let gn = 0
    let bn = 0
    if (hp >= 0 && hp < 1) {
        rn = c
        gn = x
    } else if (hp >= 1 && hp < 2) {
        rn = x
        gn = c
    } else if (hp >= 2 && hp < 3) {
        gn = c
        bn = x
    } else if (hp >= 3 && hp < 4) {
        gn = x
        bn = c
    } else if (hp >= 4 && hp < 5) {
        rn = x
        bn = c
    } else {
        rn = c
        bn = x
    }

    const m = l - c / 2
    const r = Math.round((rn + m) * 255)
    const g = Math.round((gn + m) * 255)
    const b = Math.round((bn + m) * 255)
    return { r, g, b }
}

function toHex(value: number): string {
    return value.toString(16).padStart(2, '0')
}

function applyGlobalPrimaryHueShift() {
    const root = document.documentElement
    const styles = getComputedStyle(root)
    const shift = Math.floor(Math.random() * (HUE_SHIFT_RANGE_DEG * 2 + 1)) - HUE_SHIFT_RANGE_DEG

    for (const varName of PRIMARY_HUE_SHIFT_VARS) {
        const raw = styles.getPropertyValue(varName).trim()
        const rgb = parseHexColor(raw)
        if (!rgb) continue
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
        const shiftedHue = (hsl.h + shift + 360) % 360
        const shiftedRgb = hslToRgb(shiftedHue, hsl.s, hsl.l)
        root.style.setProperty(
            varName,
            `#${toHex(shiftedRgb.r)}${toHex(shiftedRgb.g)}${toHex(shiftedRgb.b)}`,
        )
    }
}

applyGlobalPrimaryHueShift()

function BootLoadingOverlay() {
    const [trackWidthPx, setTrackWidthPx] = useState(0)
    const progressTrackRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const node = progressTrackRef.current
        if (!node) return

        const updateTrackWidth = () => {
            setTrackWidthPx(Math.max(0, Math.floor(node.clientWidth)))
        }
        updateTrackWidth()

        const resizeObserver = new ResizeObserver(updateTrackWidth)
        resizeObserver.observe(node)
        return () => resizeObserver.disconnect()
    }, [])

    const rawProgressRatio = 1
    const segmentCount = Math.max(1, Math.floor(trackWidthPx / PROGRESS_STEP_PX))
    const filledSegments =
        rawProgressRatio >= 1 ? segmentCount : Math.floor(rawProgressRatio * segmentCount)
    const progressWidthPercentRaw = (filledSegments / segmentCount) * 100
    const progressWidthPercent = Number.isFinite(progressWidthPercentRaw)
        ? progressWidthPercentRaw
        : 0
    const progressPercentRaw = Math.round(progressWidthPercent)
    const progressPercent = Number.isFinite(progressPercentRaw) ? progressPercentRaw : 0

    return (
        <div className="appModalBackdrop" aria-live="polite">
            <section className="appModal">
                <h2 className="appModalTitle">Loading signaling...</h2>
                <p className="appModalMessage">Initializing signaling adapter and auth.</p>
                <div className="appProgressMeta">{progressPercent}%</div>
                <div ref={progressTrackRef} className="cs-progress-bar appProgress">
                    <div style={{ width: `${progressWidthPercent}%` }} className="bars" />
                </div>
            </section>
        </div>
    )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
    throw new Error('Root element "#root" not found')
}
const root = createRoot(rootElement)

function RTCWrapper({ children }: { children: React.ReactNode }) {
    const createSignalServer = async () => {
        const fbConfig = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
        }
        const { db, auth } = await ensureFirebase(fbConfig, {
            firestoreEmulatorHost: FIRESTORE_EMULATOR_HOST,
            authEmulatorHost: FIREBASE_AUTH_EMULATOR_HOST,
        })
        const adapter = new FBAdapter(db, auth, {
            securityMode: 'demo_hardened',
            importTokensFromHash: true,
            callbacks: {
                onShareLink(payload: { roomId: string; url: string }) {
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent(SECURITY_EVENT_SHARE_LINK, { detail: payload }),
                        )
                    }
                },
                onRoomOccupied(payload: { roomId: string }) {
                    console.info(
                        `[vibe-demo][security] room_occupied\n${JSON.stringify(payload, null, 4)}`,
                    )
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent(SECURITY_EVENT_ROOM_OCCUPIED, { detail: payload }),
                        )
                    }
                },
                onTakenOver(payload: { roomId: string; bySessionId?: string }) {
                    console.info(
                        `[vibe-demo][security] taken_over\n${JSON.stringify(payload, null, 4)}`,
                    )
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent(SECURITY_EVENT_TAKEN_OVER, { detail: payload }),
                        )
                    }
                },
                onSecurityError(err: unknown) {
                    const message = err instanceof Error ? err.message : String(err)
                    console.error(
                        `[vibe-demo][security] error\n${JSON.stringify({ message }, null, 4)}`,
                    )
                },
            },
        })
        return adapter
    }

    return (
        <VibeRTCProvider
            rtcConfiguration={rtcConfig}
            connectionStrategy="LAN_FIRST"
            lanFirstTimeoutMs={DEMO_LAN_FIRST_TIMEOUT_MS}
            pingIntervalMs={DEMO_PING_INTERVAL_MS}
            pingWindowSize={DEMO_PING_WINDOW_SIZE}
            netRttIntervalMs={DEMO_NET_RTT_INTERVAL_MS}
            renderLoading={<BootLoadingOverlay />}
            renderBootError={(error) => (
                <div className="appModalBackdrop" role="alert" aria-live="assertive">
                    <section className="appModal appModalError">
                        <h2 className="appModalTitle">Signaling initialization failed</h2>
                        <p className="appModalMessage">{error.message}</p>
                    </section>
                </div>
            )}
            createSignalServer={createSignalServer}
        >
            {children}
        </VibeRTCProvider>
    )
}

root.render(
    <RTCWrapper>
        <App />
    </RTCWrapper>,
)
