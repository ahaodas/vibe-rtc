import { ensureFirebase, FBAdapter } from '@vibe-rtc/rtc-firebase'
import { VibeRTCProvider } from '@vibe-rtc/rtc-react'
import type { ReactNode } from 'react'
import { useCallback } from 'react'
import {
    DEMO_LAN_FIRST_TIMEOUT_MS,
    DEMO_NET_RTT_INTERVAL_MS,
    DEMO_PING_INTERVAL_MS,
    DEMO_PING_WINDOW_SIZE,
    FIREBASE_AUTH_EMULATOR_HOST,
    FIRESTORE_EMULATOR_HOST,
    PROGRESS_STEP_PX,
} from '@/features/demo/model/constants'
import {
    DemoSecurityBusProvider,
    useCreateDemoSecurityBus,
} from '@/features/demo/model/securityBus'
import { SegmentedProgressBar } from '@/shared/ui/SegmentedProgressBar'

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

function rgbToHsl(r: number, g: number, b: number) {
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

function hslToRgb(h: number, s: number, l: number) {
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

    return {
        r: Math.round((rn + m) * 255),
        g: Math.round((gn + m) * 255),
        b: Math.round((bn + m) * 255),
    }
}

function toHex(value: number) {
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
    return (
        <div className="appModalBackdrop" aria-live="polite" data-testid="rtc-boot-loading">
            <section className="appModal">
                <h2 className="appModalTitle" data-testid="rtc-boot-loading-title">
                    Loading signaling...
                </h2>
                <p className="appModalMessage" data-testid="rtc-boot-loading-message">
                    Initializing signaling adapter and auth.
                </p>
                <div className="appProgressMeta" data-testid="rtc-boot-loading-progress-meta">
                    100%
                </div>
                <SegmentedProgressBar
                    ratio={1}
                    stepPx={PROGRESS_STEP_PX}
                    className="cs-progress-bar appProgress"
                    testId="rtc-boot-loading-progress"
                    barTestId="rtc-boot-loading-progress-bar"
                />
            </section>
        </div>
    )
}

type RTCProviderProps = {
    children: ReactNode
}

export function RTCProvider({ children }: RTCProviderProps) {
    const securityBus = useCreateDemoSecurityBus()
    const { publishRoomOccupied, publishShareLink, publishTakenOver } = securityBus
    const turnUsername = import.meta.env.VITE_METERED_USER
    const turnCredential = import.meta.env.VITE_METERED_CREDENTIAL

    const rtcConfiguration: RTCConfiguration = {
        iceServers: [
            { urls: defaultStunUrls },
            ...(turnUsername && turnCredential
                ? [
                      {
                          urls: defaultTurnUrls,
                          username: turnUsername,
                          credential: turnCredential,
                      } satisfies RTCIceServer,
                  ]
                : []),
        ],
        iceCandidatePoolSize: 10,
    }

    const createSignalServer = useCallback(async () => {
        const firebaseConfig = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
        }

        const { db, auth } = await ensureFirebase(firebaseConfig, {
            firestoreEmulatorHost: FIRESTORE_EMULATOR_HOST,
            authEmulatorHost: FIREBASE_AUTH_EMULATOR_HOST,
        })

        return new FBAdapter(db, auth, {
            securityMode: 'demo_hardened',
            importTokensFromHash: true,
            callbacks: {
                onShareLink(payload: { roomId: string; url: string }) {
                    publishShareLink(payload)
                },
                onRoomOccupied(payload: { roomId: string }) {
                    console.info(
                        `[vibe-demo][security] room_occupied\n${JSON.stringify(payload, null, 4)}`,
                    )
                    publishRoomOccupied(payload)
                },
                onTakenOver(payload: { roomId: string; bySessionId?: string }) {
                    console.info(
                        `[vibe-demo][security] taken_over\n${JSON.stringify(payload, null, 4)}`,
                    )
                    publishTakenOver(payload)
                },
                onSecurityError(error: unknown) {
                    const message = error instanceof Error ? error.message : String(error)
                    console.error(
                        `[vibe-demo][security] error\n${JSON.stringify({ message }, null, 4)}`,
                    )
                },
            },
        })
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
                renderBootError={(error) => (
                    <div
                        className="appModalBackdrop"
                        role="alert"
                        aria-live="assertive"
                        data-testid="rtc-boot-error"
                    >
                        <section className="appModal appModalError">
                            <h2 className="appModalTitle" data-testid="rtc-boot-error-title">
                                Signaling initialization failed
                            </h2>
                            <p className="appModalMessage" data-testid="rtc-boot-error-message">
                                {error.message}
                            </p>
                        </section>
                    </div>
                )}
                createSignalServer={createSignalServer}
            >
                {children}
            </VibeRTCProvider>
        </DemoSecurityBusProvider>
    )
}
