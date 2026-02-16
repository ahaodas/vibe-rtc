import { RTCSignaler } from '@vibe-rtc/rtc-core'
import { FBAdapter, ensureFirebase } from '@vibe-rtc/rtc-firebase'

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

type Who = 'caller' | 'callee'

function makeLogger(prefix: string) {
    return {
        msg: (t: string) => console.log(`[${prefix}] msg`, t),
        state: (s: RTCPeerConnectionState) => console.log(`[${prefix}] state`, s),
        err: (e: unknown) => console.error(`[${prefix}] error`, e),
    }
}

async function make(role: Who) {
    const { db, auth } = await ensureFirebase(firebaseConfig)
    const signalDb = new FBAdapter(db, auth)

    const log = makeLogger(role)
    const s = new RTCSignaler(role, signalDb, { rtcConfiguration: { iceServers: [] } })

    // базовые хэндлеры (чтобы в консоли было видно стейты)
    s.setMessageHandler((t) => log.msg(t))
    s.setConnectionStateHandler((st) => log.state(st))
    s.setErrorHandler((e) => log.err(e))

    // inbox для тестов
    let inbox: string[] = []
    s.setMessageHandler((t) => inbox.push(t))

    const isReady = () => {
        const st = s.inspect()
        return st.pcState === 'connected' &&
            st.fast?.state === 'open' &&
            st.reliable?.state === 'open'
    }

    async function waitReadyNoAssist(timeoutMs = 15000) {
        const startedAt = Date.now()
        while (Date.now() - startedAt < timeoutMs) {
            if (isReady()) return
            await new Promise((r) => setTimeout(r, 100))
        }
        throw new Error(`waitReadyNoAssist timeout: ${JSON.stringify(s.inspect())}`)
    }

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

        // тестовые хелперы
        waitReadyNoAssist,
        waitReady: (ms = 15000) => s.waitReady({ timeoutMs: ms }),
        sendFast: (m: string) => s.sendFast(m),
        sendReliable: (m: string) => s.sendReliable(m),
        reconnectSoft: () => s.reconnectSoft(),
        reconnectHard: (opts?: { awaitReadyMs?: number }) => s.reconnectHard(opts),
        takeMessages: () => { const out = inbox; inbox = []; return out },
        flush: () => { inbox = [] },
        getState: () => s.inspect(),

        endRoom: () => s.endRoom(),
    }
}

;(window as any).app = {
    makeCaller: () => make('caller'),
    makeCallee: () => make('callee'),
}
