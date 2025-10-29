import { RTCSignaler } from '@vibe-rtc/rtc-core'
import { FBAdapter } from '@vibe-rtc/rtc-firebase'
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, signInAnonymously } from 'firebase/auth'

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)

await signInAnonymously(auth)

function makeWaitReady(signaler: RTCSignaler) {
    let fast = false,
        rel = false
    let resolve!: () => void
    const p = new Promise<void>((r) => (resolve = r))
    const check = () => {
        if (fast && rel) resolve()
    }

    signaler.setFastOpenHandler(() => {
        fast = true
        check()
    })
    signaler.setReliableOpenHandler(() => {
        rel = true
        check()
    })
    return () => p
}

function makeLogger(prefix: string) {
    return {
        msg: (t: string) => console.log(`[${prefix}] msg`, t),
        state: (s: RTCPeerConnectionState) => console.log(`[${prefix}] state`, s),
        err: (e: unknown) => console.error(`[${prefix}] error`, e),
    }
}
type Role = 'caller' | 'callee'
async function make(role: Role) {
    const signalDb = new FBAdapter(db, auth) // ← твой адаптер

    const log = makeLogger(role)
    const s = new RTCSignaler(role, signalDb, { rtcConfiguration: { iceServers: [] } })
    s.setMessageHandler((t) => log.msg(t))
    s.setConnectionStateHandler((st) => log.state(st))
    s.setErrorHandler((e) => log.err(e))
    const waitReady = makeWaitReady(s)

    let inbox: string[] = []
    s.setMessageHandler((t) => inbox.push(t))

    return {
        hostRoom: async () => {
            const id = await signalDb.createRoom()
            await s.joinRoom(id)
            await s.connect()
            return id
        },
        joinRoom: async (id: string) => {
            await signalDb.joinRoom(id)
            await s.joinRoom(id)
            await s.connect()
        },
        waitReady, //: (ms = 15000) => s.waitReady({ timeoutMs: ms }),
        sendFast: (m: string) => s.sendFast(m),
        sendReliable: (m: string) => s.sendReliable(m),
        reconnectSoft: () => s.reconnectSoft(),
        reconnectHard: () => s.reconnectHard(),
        takeMessages: () => {
            const out = inbox
            inbox = []
            return out
        },

        inspect: () => s.inspect(),
        endRoom: () => s.endRoom(),
    }
}
;(window as any).app = {
    makeCaller: () => make('caller'),
    makeCallee: () => make('callee'),
}
