import { type ConnectionStrategy, RTCSignaler } from '@vibe-rtc/rtc-core'
import { ensureFirebase, FBAdapter } from '@vibe-rtc/rtc-firebase'
import { doc, getDoc } from 'firebase/firestore'

const REQUIRED_FIREBASE_ENV_KEYS = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const

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
        throw new Error(`[rtc-e2e] missing Firebase env vars: ${missing.join(', ')}`)
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

type Who = 'caller' | 'callee'
type MakeOptions = {
    connectionStrategy?: ConnectionStrategy
}
type RoleApi = ReturnType<typeof make> extends Promise<infer T> ? T : never
type AppApi = {
    makeCaller: (opts?: MakeOptions) => Promise<RoleApi>
    makeCallee: (opts?: MakeOptions) => Promise<RoleApi>
    attachFromHash: () => Promise<void>
}

declare global {
    interface Window {
        app: AppApi
    }
}

const rtcConfiguration: RTCConfiguration = {
    iceServers: [
        {
            urls: [
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302',
                'stun:stun3.l.google.com:19302',
            ],
        },
    ],
}

function makeLogger(prefix: string) {
    return {
        msg: (t: string) => console.log(`[${prefix}] msg`, t),
        state: (s: RTCPeerConnectionState) => console.log(`[${prefix}] state`, s),
        err: (e: unknown) => console.error(`[${prefix}] error`, e),
    }
}

function parseAttachHash(hashRaw: string): {
    who: Who
    roomId: string
    connectionStrategy: ConnectionStrategy
} | null {
    const hash = hashRaw.replace(/^#/, '')
    const normalized = hash.startsWith('/') ? hash : `/${hash}`
    const [path, query = ''] = normalized.split('?')
    const match = path.match(/^\/attach\/(caller|callee)\/([^/]+)$/)
    if (!match?.[1] || !match[2]) return null
    const roomId = decodeURIComponent(match[2]).trim()
    if (!roomId) return null
    const params = new URLSearchParams(query)
    const strategy = params.get('strategy') === 'native' ? 'BROWSER_NATIVE' : 'DEFAULT'
    return {
        who: match[1] as Who,
        roomId,
        connectionStrategy: strategy,
    }
}

async function make(role: Who, opts: MakeOptions = {}) {
    assertFirebaseHarnessConfig()
    const mode = FIRESTORE_EMULATOR_HOST || FIREBASE_AUTH_EMULATOR_HOST ? 'emulator' : 'real'
    let db: Awaited<ReturnType<typeof ensureFirebase>>['db']
    let auth: Awaited<ReturnType<typeof ensureFirebase>>['auth']
    try {
        ;({ db, auth } = await ensureFirebase(firebaseConfig, {
            firestoreEmulatorHost: FIRESTORE_EMULATOR_HOST,
            authEmulatorHost: FIREBASE_AUTH_EMULATOR_HOST,
        }))
    } catch (error) {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        throw new Error(
            `[rtc-e2e] ensureFirebase failed (${mode} mode): ${reason}. ` +
                `firestoreEmulatorHost=${FIRESTORE_EMULATOR_HOST || 'off'}, ` +
                `authEmulatorHost=${FIREBASE_AUTH_EMULATOR_HOST || 'off'}`,
        )
    }
    let securityEvents: string[] = []
    const signalDb = new FBAdapter(db, auth, {
        securityMode: 'demo_hardened',
        callbacks: {
            onTakenOver(payload) {
                securityEvents.push(`taken_over:${payload.roomId}:${payload.bySessionId ?? ''}`)
            },
            onRoomOccupied(payload) {
                securityEvents.push(`room_occupied:${payload.roomId}`)
            },
            onSecurityError(error) {
                const message = error instanceof Error ? error.message : String(error)
                securityEvents.push(`security_error:${message}`)
            },
        },
    })
    const connectionStrategy = opts.connectionStrategy ?? 'DEFAULT'

    const log = makeLogger(role)
    const s = new RTCSignaler(role, signalDb, {
        debug: true,
        rtcConfiguration,
        connectionStrategy,
    })

    // Basic handlers so states are visible in console.
    s.setMessageHandler((t) => log.msg(t))
    s.setConnectionStateHandler((st) => log.state(st))
    s.setErrorHandler((e) => log.err(e))

    // Inbox for tests.
    let inbox: string[] = []
    let currentRoomId: string | null = null
    s.setMessageHandler((t) => inbox.push(t))

    const isReady = () => {
        const st = s.inspect()
        return (
            st.pcState === 'connected' && st.fast?.state === 'open' && st.reliable?.state === 'open'
        )
    }

    async function waitReadyNoAssist(timeoutMs = 15000) {
        const startedAt = Date.now()
        while (Date.now() - startedAt < timeoutMs) {
            if (isReady()) return
            await new Promise((r) => setTimeout(r, 100))
        }
        if (isReady()) return
        throw new Error(`waitReadyNoAssist timeout: ${JSON.stringify(s.inspect())}`)
    }

    return {
        hostRoom: async () => {
            const id = await signalDb.createRoom()
            await s.joinRoom(id)
            await s.connect()
            currentRoomId = id
            return id
        },
        joinRoom: async (id: string) => {
            await signalDb.joinRoom(id)
            await s.joinRoom(id)
            await s.connect()
            currentRoomId = id
        },

        // Test helpers.
        waitReadyNoAssist,
        waitReady: (ms = 15000) => s.waitReady({ timeoutMs: ms }),
        sendFast: (m: string) => s.sendFast(m),
        sendReliable: (m: string) => s.sendReliable(m),
        reconnectSoft: () => s.reconnectSoft(),
        reconnectHard: (opts?: { awaitReadyMs?: number }) => s.reconnectHard(opts),
        takeMessages: () => {
            const out = inbox
            inbox = []
            return out
        },
        flush: () => {
            inbox = []
        },
        getState: () => s.inspect(),
        debugSignal: async () => {
            const uid = auth.currentUser?.uid ?? null
            if (!uid || !currentRoomId) return null
            const [callerLease, calleeLease, callerDoc, calleeDoc] = await Promise.all([
                getDoc(doc(db, 'rooms', currentRoomId, 'leases', 'caller')),
                getDoc(doc(db, 'rooms', currentRoomId, 'leases', 'callee')),
                getDoc(doc(db, 'rooms', currentRoomId, 'callers', uid)),
                getDoc(doc(db, 'rooms', currentRoomId, 'callees', uid)),
            ])
            return {
                uid,
                roomId: currentRoomId,
                callerLease: callerLease.exists() ? callerLease.data() : null,
                calleeLease: calleeLease.exists() ? calleeLease.data() : null,
                callerDoc: callerDoc.exists() ? callerDoc.data() : null,
                calleeDoc: calleeDoc.exists() ? calleeDoc.data() : null,
            }
        },
        takeSecurityEvents: () => {
            const out = securityEvents
            securityEvents = []
            return out
        },

        hangup: () => s.hangup(),
        endRoom: () => s.endRoom(),
    }
}

window.app = {
    makeCaller: (opts) => make('caller', opts),
    makeCallee: (opts) => make('callee', opts),
    attachFromHash: async () => {
        const parsed = parseAttachHash(window.location.hash)
        if (!parsed) {
            throw new Error(`Invalid attach hash: ${window.location.hash}`)
        }
        const api = await make(parsed.who, { connectionStrategy: parsed.connectionStrategy })
        ;(window as Window & { caller?: RoleApi; callee?: RoleApi })[parsed.who] = api
        await api.joinRoom(parsed.roomId)
    },
}
