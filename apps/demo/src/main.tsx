// apps/demo/src/main.tsx
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import '@/styles.css'

import type { SignalDB } from '@vibe-rtc/rtc-core'
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
    // 'free.expressturn.com:3478'
]

const envTurnUrls = import.meta.env.VITE_TURN_URLS?.trim()
const turnUrls = envTurnUrls
    ? envTurnUrls
          .split(',')
          .map((u: string) => u.trim())
          .filter(Boolean)
    : defaultTurnUrls
const envStunUrls = import.meta.env.VITE_STUN_URLS?.trim()
const stunUrls = envStunUrls
    ? envStunUrls
          .split(',')
          .map((u: string) => u.trim())
          .filter(Boolean)
    : defaultStunUrls

const turnUsername = import.meta.env.VITE_TURN_USERNAME ?? import.meta.env.VITE_METERED_USER
const turnCredential =
    import.meta.env.VITE_TURN_CREDENTIAL ?? import.meta.env.VITE_METERED_CREDENTIAL

const searchParams = new URLSearchParams(window.location.search)
const forceConsoleDebug = searchParams.get('debugConsole') === '1'
const forceTurnOnlyByQuery = searchParams.get('turnOnly') === '1'
const forceTurnOnlyByEnv = import.meta.env.VITE_FORCE_TURN_ONLY === '1'
const FORCE_TURN_ONLY = forceTurnOnlyByQuery || forceTurnOnlyByEnv

const turnServer =
    turnUsername && turnCredential
        ? ({
              urls: turnUrls,
              username: turnUsername,
              credential: turnCredential,
          } satisfies RTCIceServer)
        : null

const rtcIceServers: RTCIceServer[] = FORCE_TURN_ONLY
    ? turnServer
        ? [turnServer]
        : []
    : [
          {
              urls: stunUrls,
          },
          ...(turnServer ? [turnServer] : []),
      ]

const rtcConfig: RTCConfiguration = {
    iceServers: rtcIceServers,
    iceCandidatePoolSize: 10,
    ...(FORCE_TURN_ONLY ? { iceTransportPolicy: 'relay' as const } : {}),
}
const demoConnectionStrategy = FORCE_TURN_ONLY ? 'DEFAULT' : 'LAN_FIRST'
const DEMO_LAN_FIRST_TIMEOUT_MS = 4500
const PROGRESS_STEP_PX = 10
const buildSha = import.meta.env.VITE_BUILD_SHA?.trim() || 'local-dev'
const DEMO_CONSOLE_DEBUG =
    import.meta.env.DEV || import.meta.env.VITE_DEMO_CONSOLE_DEBUG === '1' || forceConsoleDebug
let signalingOpSeq = 0

if (DEMO_CONSOLE_DEBUG) {
    console.info(`[vibe-rtc demo] build=${buildSha}`)
    console.info('[vibe-rtc demo] rtc mode', {
        forceTurnOnly: FORCE_TURN_ONLY,
        connectionStrategy: demoConnectionStrategy,
        iceTransportPolicy: rtcConfig.iceTransportPolicy ?? 'all',
        iceServers: rtcIceServers.map((server) => server.urls),
    })
}

function authSnapshot(auth: {
    currentUser?: { uid?: string | null; isAnonymous?: boolean } | null
}) {
    const user = auth.currentUser
    return {
        uid: user?.uid ?? null,
        isAnonymous: user?.isAnonymous ?? null,
    }
}

function toLogArg(value: unknown): unknown {
    if (typeof value === 'function') return '[Function]'
    if (value == null) return value
    if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}...` : value
    if (typeof value !== 'object') return value
    try {
        return JSON.parse(JSON.stringify(value))
    } catch {
        return '[UnserializableObject]'
    }
}

function wrapSignalDbWithConsoleDebug(
    db: SignalDB,
    getAuth: () => { uid: string | null; isAnonymous: boolean | null },
): SignalDB {
    return new Proxy(db, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver)
            if (typeof value !== 'function') return value

            return (...args: unknown[]) => {
                const opId = ++signalingOpSeq
                const method = String(prop)
                const safeArgs = args.map(toLogArg)

                if (DEMO_CONSOLE_DEBUG) {
                    console.info(`[vibe-rtc demo][signal:${opId}] ${method}:start`, {
                        args: safeArgs,
                        auth: getAuth(),
                    })
                }

                try {
                    const result = value.apply(target, args)
                    if (
                        result &&
                        (typeof result === 'object' || typeof result === 'function') &&
                        'then' in result &&
                        typeof (result as Promise<unknown>).then === 'function'
                    ) {
                        return (result as Promise<unknown>)
                            .then((resolved) => {
                                if (DEMO_CONSOLE_DEBUG) {
                                    console.info(`[vibe-rtc demo][signal:${opId}] ${method}:ok`, {
                                        auth: getAuth(),
                                    })
                                }
                                return resolved
                            })
                            .catch((error) => {
                                console.error(`[vibe-rtc demo][signal:${opId}] ${method}:error`, {
                                    auth: getAuth(),
                                    error,
                                })
                                throw error
                            })
                    }

                    if (DEMO_CONSOLE_DEBUG) {
                        console.info(`[vibe-rtc demo][signal:${opId}] ${method}:ok`, {
                            auth: getAuth(),
                        })
                    }
                    return result
                } catch (error) {
                    console.error(`[vibe-rtc demo][signal:${opId}] ${method}:error`, {
                        auth: getAuth(),
                        error,
                    })
                    throw error
                }
            }
        },
    }) as SignalDB
}

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
        if (DEMO_CONSOLE_DEBUG) {
            console.info('[vibe-rtc demo][auth] ensureFirebase:start')
        }
        const { db, auth } = await ensureFirebase(fbConfig)
        if (DEMO_CONSOLE_DEBUG) {
            console.info('[vibe-rtc demo][auth] ensureFirebase:ok', authSnapshot(auth))
        }
        const adapter = new FBAdapter(db, auth)
        if (!DEMO_CONSOLE_DEBUG) return adapter as unknown as SignalDB
        return wrapSignalDbWithConsoleDebug(adapter as unknown as SignalDB, () =>
            authSnapshot(auth),
        )
    }

    return (
        <VibeRTCProvider
            rtcConfiguration={rtcConfig}
            connectionStrategy={demoConnectionStrategy}
            lanFirstTimeoutMs={
                demoConnectionStrategy === 'LAN_FIRST' ? DEMO_LAN_FIRST_TIMEOUT_MS : undefined
            }
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
