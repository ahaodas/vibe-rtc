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

function makeWaitReady(signaler: RTCSignaler) {
    let fast = false, rel = false
    let resolve!: () => void, reject!: (e: unknown) => void
    const p = new Promise<void>((res, rej) => { resolve = res; reject = rej })

    const done = () => { if (fast && rel) resolve() }
    signaler.setFastOpenHandler(() => { fast = true; done() })
    signaler.setReliableOpenHandler(() => { rel = true; done() })
    signaler.setErrorHandler((e) => reject(e))

    // возвращаем фабрику, чтобы пересоздавать «ожидатель» после recreate
    return () => p
}

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

    // «локальный» ожидатель открытия каналов
    let waitReadyFactory = makeWaitReady(s)

    // эвристика «залипа»
    function looksHalfStuck() {
        const st = s.inspect()
        const ice = st.iceState
        const pc = st.pcState
        const fc = st.fast?.state
        const rc = st.reliable?.state
        const half =
            (ice === 'checking' || pc === 'connecting') &&
            (fc === 'connecting' || rc === 'connecting')
        return half
    }

    async function ensureReady(totalMs = 20000) {
        const stNow = s.inspect()
        const bothOpen =
            stNow.fast?.state === 'open' &&
            stNow.reliable?.state === 'open' &&
            stNow.pcState === 'connected'

        if (bothOpen) return

        const looksHalfStuck = () => {
            const st = s.inspect()
            const ice = st.iceState
            const pc = st.pcState
            const fc = st.fast?.state
            const rc = st.reliable?.state
            return (ice === 'checking' || pc === 'connecting') &&
                (fc === 'connecting' || rc === 'connecting')
        }

        const t0 = Date.now()
        const left = () => Math.max(1000, totalMs - (Date.now() - t0))

        const tryWait = async (ms: number) => {
            // быстрый выход, если уже всё ок
            const ok = () => {
                const st = s.inspect()
                return st.pcState === 'connected' &&
                    st.fast?.state === 'open' &&
                    st.reliable?.state === 'open'
            }
            if (ok()) return true
            try {
                await s.waitReady({ timeoutMs: ms })
                return true
            } catch {
                return ok()
            }
        }

        // 1) просто подождать немного
        if (await tryWait(Math.min(4000, left()))) return

        // 2) если «полузалип» — мягко рестартуем ICE
        if (looksHalfStuck()) {
            try { await s.reconnectSoft() } catch {}
            if (await tryWait(Math.min(6000, left()))) return
        }

        // 3) ещё один soft для симметрии/анти-glare
        try { await s.reconnectSoft() } catch {}
        if (await tryWait(Math.min(6000, left()))) return

        // 4) хард до упора
        await s.reconnectHard({ awaitReadyMs: left() })
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
        ensureReady,
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
