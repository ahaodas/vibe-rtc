import type { ConnectionStrategy } from '@vibe-rtc/rtc-core'
import { ensureFirebase, FBAdapter } from '@vibe-rtc/rtc-firebase'
import {
    type RoomInvite,
    type UseVibeRTCOptions,
    useVibeRTCSession,
    VibeRTCProvider,
} from '@vibe-rtc/rtc-react'
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

const REQUIRED_FIREBASE_ENV_KEYS = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const

const WAIT_READY_TIMEOUT_MS = 20_000

type Role = 'caller' | 'callee'

type HookState = {
    status: string
    invite: RoomInvite | null
    lastError?: {
        code?: string
        message: string
    } | null
}

type HookAppApi = {
    hostRoom: () => Promise<RoomInvite>
    joinWithInvite: (invite: RoomInvite, role?: Role) => Promise<void>
    setRole: (role: Role) => Promise<void>
    setInvite: (invite: RoomInvite | null) => Promise<void>
    start: () => Promise<void>
    stop: () => Promise<void>
    waitReadyNoAssist: (timeoutMs?: number) => Promise<void>
    waitReady: (timeoutMs?: number) => Promise<void>
    sendFast: (text: string) => Promise<void>
    sendReliable: (text: string) => Promise<void>
    takeMessages: () => string[]
    getState: () => HookState
    takeSecurityEvents: () => string[]
    attachFromHash: () => Promise<void>
}

declare global {
    interface Window {
        hookApp: HookAppApi
    }
}

function readEnv(name: string): string {
    const raw = (import.meta.env as Record<string, unknown>)[name]
    return typeof raw === 'string' ? raw.trim() : ''
}

function missingFirebaseEnvKeys(): string[] {
    return REQUIRED_FIREBASE_ENV_KEYS.filter((key) => !readEnv(key))
}

function assertFirebaseHarnessConfig() {
    const missing = missingFirebaseEnvKeys()
    if (missing.length > 0) {
        throw new Error(`[rtc-e2e-hook] missing Firebase env vars: ${missing.join(', ')}`)
    }
}

const firebaseConfig = {
    apiKey: readEnv('VITE_FIREBASE_API_KEY'),
    authDomain: `${readEnv('VITE_FIREBASE_PROJECT_ID')}.firebaseapp.com`,
    projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: `${readEnv('VITE_FIREBASE_PROJECT_ID')}.appspot.com`,
    messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readEnv('VITE_FIREBASE_APP_ID'),
}
const FIRESTORE_EMULATOR_HOST =
    readEnv('VITE_FIRESTORE_EMULATOR_HOST') || readEnv('FIRESTORE_EMULATOR_HOST')
const FIREBASE_AUTH_EMULATOR_HOST =
    readEnv('VITE_FIREBASE_AUTH_EMULATOR_HOST') || readEnv('FIREBASE_AUTH_EMULATOR_HOST')

function normalizeInvite(invite: RoomInvite | null | undefined): RoomInvite | null {
    if (!invite) return null
    const roomId = invite.roomId.trim()
    const sessionId = typeof invite.sessionId === 'string' ? invite.sessionId.trim() : ''
    if (!roomId) return null
    return {
        roomId,
        sessionId: sessionId || undefined,
        connectionStrategy: invite.connectionStrategy,
    }
}

function parseHookAttachHash(hashRaw: string): { role: Role; invite: RoomInvite } | null {
    const hash = hashRaw.replace(/^#/, '')
    const normalized = hash.startsWith('/') ? hash : `/${hash}`
    const [path, query = ''] = normalized.split('?')
    const match = path.match(/^\/hook\/(caller|callee)$/)
    if (!match?.[1]) return null
    const params = new URLSearchParams(query)
    const rawInvite = params.get('invite')
    if (!rawInvite) return null

    try {
        const parsed = JSON.parse(rawInvite) as Partial<RoomInvite>
        if (
            typeof parsed.roomId !== 'string' ||
            (parsed.connectionStrategy !== 'LAN_FIRST' &&
                parsed.connectionStrategy !== 'DEFAULT' &&
                parsed.connectionStrategy !== 'BROWSER_NATIVE')
        ) {
            return null
        }
        const invite = normalizeInvite({
            roomId: parsed.roomId,
            sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
            connectionStrategy: parsed.connectionStrategy,
        })
        if (!invite) return null
        return { role: match[1] as Role, invite }
    } catch {
        return null
    }
}

async function waitForCondition<T>(
    getValue: () => T | null | undefined,
    timeoutMs: number,
    label: string,
): Promise<T> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        const value = getValue()
        if (value != null) return value
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`[rtc-e2e-hook] timeout waiting for ${label}`)
}

function HookHarnessSession(props: { securityEventsRef: MutableRefObject<string[]> }) {
    const [options, setOptions] = useState<UseVibeRTCOptions>({
        role: 'caller',
        invite: null,
        autoStart: false,
        autoCreate: false,
        logMessages: false,
    })

    const messagesRef = useRef<string[]>([])
    const lastErrorRef = useRef<HookState['lastError']>(null)

    const session = useVibeRTCSession({
        ...options,
        onFastMessage: (message) => {
            messagesRef.current.push(message)
        },
        onReliableMessage: (message) => {
            messagesRef.current.push(message)
        },
        onError: (error) => {
            lastErrorRef.current = {
                code: error.code,
                message: error.message,
            }
        },
    })
    const sessionRef = useRef(session)
    sessionRef.current = session

    const applyOptions = useCallback((patch: Partial<UseVibeRTCOptions>) => {
        setOptions((prev) => ({ ...prev, ...patch }))
    }, [])

    const waitReady = useCallback(async (timeoutMs = WAIT_READY_TIMEOUT_MS) => {
        const startedAt = Date.now()
        while (Date.now() - startedAt < timeoutMs) {
            if (sessionRef.current.status === 'connected') return
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error(
            `[rtc-e2e-hook] waitReady timeout; state=${JSON.stringify({
                status: sessionRef.current.status,
                invite: sessionRef.current.invite,
                lastError: sessionRef.current.lastError,
            })}`,
        )
    }, [])

    useEffect(() => {
        window.hookApp = {
            hostRoom: async () => {
                applyOptions({
                    role: 'caller',
                    invite: null,
                    autoStart: true,
                    autoCreate: true,
                })
                const invite = await waitForCondition(
                    () => sessionRef.current.invite,
                    WAIT_READY_TIMEOUT_MS,
                    'created invite',
                )
                return invite
            },
            joinWithInvite: async (invite, role = 'callee') => {
                const normalizedInvite = normalizeInvite(invite)
                if (!normalizedInvite) throw new Error('[rtc-e2e-hook] joinWithInvite: invalid invite')
                applyOptions({
                    role,
                    invite: normalizedInvite,
                    autoStart: true,
                    autoCreate: false,
                })
            },
            setRole: async (role) => {
                applyOptions({ role })
            },
            setInvite: async (invite) => {
                applyOptions({ invite: normalizeInvite(invite) })
            },
            start: async () => {
                await sessionRef.current.start()
            },
            stop: async () => {
                await sessionRef.current.stop()
            },
            waitReadyNoAssist: async (timeoutMs = WAIT_READY_TIMEOUT_MS) => {
                await waitReady(timeoutMs)
            },
            waitReady: async (timeoutMs = WAIT_READY_TIMEOUT_MS) => {
                await waitReady(timeoutMs)
            },
            sendFast: async (text: string) => {
                await sessionRef.current.sendFast(text)
            },
            sendReliable: async (text: string) => {
                await sessionRef.current.sendReliable(text)
            },
            takeMessages: () => {
                const out = messagesRef.current
                messagesRef.current = []
                return out
            },
            getState: () => ({
                status: sessionRef.current.status,
                invite: sessionRef.current.invite,
                lastError:
                    sessionRef.current.lastError != null
                        ? {
                              code: sessionRef.current.lastError.code,
                              message: sessionRef.current.lastError.message,
                          }
                        : lastErrorRef.current,
            }),
            takeSecurityEvents: () => {
                const out = props.securityEventsRef.current
                props.securityEventsRef.current = []
                return out
            },
            attachFromHash: async () => {
                const parsed = parseHookAttachHash(window.location.hash)
                if (!parsed) throw new Error(`Invalid hook attach hash: ${window.location.hash}`)
                applyOptions({
                    role: parsed.role,
                    invite: parsed.invite,
                    autoStart: true,
                    autoCreate: false,
                })
            },
        }
    }, [applyOptions, props.securityEventsRef, waitReady])

    return null
}

function HookHarnessApp() {
    const securityEventsRef = useRef<string[]>([])
    const createSignalServer = useCallback(async () => {
        assertFirebaseHarnessConfig()
        const { db, auth } = await ensureFirebase(firebaseConfig, {
            firestoreEmulatorHost: FIRESTORE_EMULATOR_HOST,
            authEmulatorHost: FIREBASE_AUTH_EMULATOR_HOST,
        })
        return new FBAdapter(db, auth, {
            securityMode: 'demo_hardened',
            callbacks: {
                onTakenOver(payload) {
                    securityEventsRef.current.push(
                        `taken_over:${payload.roomId}:${payload.bySessionId ?? ''}`,
                    )
                },
                onRoomOccupied(payload) {
                    securityEventsRef.current.push(`room_occupied:${payload.roomId}`)
                },
                onSecurityError(error) {
                    const message = error instanceof Error ? error.message : String(error)
                    securityEventsRef.current.push(`security_error:${message}`)
                },
            },
        })
    }, [])

    return (
        <VibeRTCProvider
            createSignalServer={createSignalServer}
            connectionStrategy={'LAN_FIRST' satisfies ConnectionStrategy}
            lanFirstTimeoutMs={3_500}
        >
            <HookHarnessSession securityEventsRef={securityEventsRef} />
        </VibeRTCProvider>
    )
}

const rootNode = document.getElementById('app')
if (!rootNode) throw new Error('[rtc-e2e-hook] #app container not found')

createRoot(rootNode).render(<HookHarnessApp />)
