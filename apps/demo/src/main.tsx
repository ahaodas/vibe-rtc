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

const envTurnUrls = import.meta.env.VITE_TURN_URLS?.trim()
const turnUrls = envTurnUrls
    ? envTurnUrls
          .split(',')
          .map((u) => u.trim())
          .filter(Boolean)
    : defaultTurnUrls

const turnUsername = import.meta.env.VITE_TURN_USERNAME ?? import.meta.env.VITE_METERED_USER
const turnCredential =
    import.meta.env.VITE_TURN_CREDENTIAL ?? import.meta.env.VITE_METERED_CREDENTIAL

const rtcIceServers: RTCIceServer[] = [
    {
        urls: [
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302',
            'stun:stun3.l.google.com:19302',
        ],
    },
    ...(turnUsername && turnCredential
        ? [
              {
                  urls: turnUrls,
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
const PROGRESS_STEP_PX = 10
const buildSha = import.meta.env.VITE_BUILD_SHA?.trim() || 'local-dev'

console.info(`[vibe-rtc demo] build=${buildSha}`)

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
    // Option A: provider creates the adapter itself (booting/error handled internally).
    const createSignalServer = async () => {
        const fbConfig = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
        }
        const { db, auth } = await ensureFirebase(fbConfig)
        return new FBAdapter(db, auth)
    }

    return (
        <VibeRTCProvider
            rtcConfiguration={rtcConfig}
            connectionStrategy="LAN_FIRST"
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
