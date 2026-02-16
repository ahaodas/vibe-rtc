// signal-rx.ts
// Тонкая RxJS-обёртка над вашим существующим SignalDB (без переписывания адаптера)

import { Observable, defer, shareReplay, finalize, map, filter, distinctUntilChanged } from 'rxjs'

// ——— Типы вашего адаптера (совместим с тем, что у вас уже есть) ———
export type Role = 'caller' | 'callee'

type IceAny = RTCIceCandidate | RTCIceCandidateInit

function toInit(ice: IceAny): RTCIceCandidateInit {
    if (!ice) return {}
    const any = ice as any
    if (typeof any.toJSON === 'function') return any.toJSON() // Chromium
    // Firefox/Safari уже приходят как init-структура
    const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = any
    return { candidate, sdpMid, sdpMLineIndex, usernameFragment }
}

// ПИШЕМ В БД ВСЕГДА init-объект
async function addCallerIceCandidate(ice: IceAny) {
    const init = toInit(ice)
    // ... write init в Firestore
}
async function addCalleeIceCandidate(ice: IceAny) {
    const init = toInit(ice)
    // ... write init в Firestore
}

export interface SignalDB {
    // управление комнатой
    createRoom(): Promise<string>
    joinRoom(id: string): Promise<void>
    endRoom(): Promise<void>

    // offer/answer
    setOffer(offer: RTCSessionDescriptionInit): Promise<void>
    setAnswer(answer: RTCSessionDescriptionInit): Promise<void>
    clearOffer(): Promise<void>
    clearAnswer(): Promise<void>
    subscribeOnOffer(cb: (offer: RTCSessionDescriptionInit) => void): () => void
    subscribeOnAnswer(cb: (answer: RTCSessionDescriptionInit) => void): () => void

    // ICE
    addCallerIceCandidate(c: RTCIceCandidateInit): Promise<void>
    addCalleeIceCandidate(c: RTCIceCandidateInit): Promise<void>
    clearCallerCandidates(): Promise<void>
    clearCalleeCandidates(): Promise<void>
    subscribeOnCallerIceCandidate(cb: (c: RTCIceCandidateInit) => void): () => void
    subscribeOnCalleeIceCandidate(cb: (c: RTCIceCandidateInit) => void): () => void
}

// ——— Утилиты для дедупа ———
const sdpHash = (s?: string | null) => {
    if (!s) return '∅'
    const line1 = s.split('\n')[0]?.trim() ?? ''
    let x = 0
    for (let i = 0; i < line1.length; i++) x = (x * 33) ^ line1.charCodeAt(i)
    return `${line1}#${(x >>> 0).toString(16)}`
}

const iceKey = (c: RTCIceCandidateInit) =>
    `${c.candidate ?? ''}|${c.sdpMid ?? ''}|${c.sdpMLineIndex ?? -1}`

// ——— Базовый конвертер subscribe → Observable ———
function fromSubscribe<T>(sub: (cb: (v: T) => void) => () => void): Observable<T> {
    return new Observable<T>((subscriber) => {
        const unsub = sub((v) => subscriber.next(v))
        return () => {
            try { unsub?.() } catch {}
            subscriber.complete()
        }
    })
}

// ——— Обёртка поверх SignalDB с Rx-потоками ———
export function createSignalStreams(db: SignalDB) {
    const offerRaw$ = fromSubscribe<RTCSessionDescriptionInit>(db.subscribeOnOffer.bind(db))
    const answerRaw$ = fromSubscribe<RTCSessionDescriptionInit>(db.subscribeOnAnswer.bind(db))

    // дедуп по SDP (иногда Firestore может прислать повтор)
    const offer$ = offerRaw$.pipe(
        map((d) => ({ ...d, __h: sdpHash(d.sdp ?? null) } as RTCSessionDescriptionInit & { __h: string })),
        distinctUntilChanged((a, b) => a.__h === b.__h),
        map(({ __h, ...rest }) => rest),
        shareReplay({ bufferSize: 1, refCount: true }),
    )

    const answer$ = answerRaw$.pipe(
        map((d) => ({ ...d, __h: sdpHash(d.sdp ?? null) } as RTCSessionDescriptionInit & { __h: string })),
        distinctUntilChanged((a, b) => a.__h === b.__h),
        map(({ __h, ...rest }) => rest),
        shareReplay({ bufferSize: 1, refCount: true }),
    )

    // поток ICE для КАЖДОЙ стороны выбирается по роли
    const callerIceRaw$ = fromSubscribe<RTCIceCandidateInit>(db.subscribeOnCallerIceCandidate.bind(db))
    const calleeIceRaw$ = fromSubscribe<RTCIceCandidateInit>(db.subscribeOnCalleeIceCandidate.bind(db))

    const callerIce$ = callerIceRaw$.pipe(
        map((c) => ({ ...c, __k: iceKey(c) }) as RTCIceCandidateInit & { __k: string }),
        distinctUntilChanged((a, b) => a.__k === b.__k),
        map(({ __k, ...rest }) => rest),
        shareReplay({ bufferSize: 1, refCount: true }),
    )

    const calleeIce$ = calleeIceRaw$.pipe(
        map((c) => ({ ...c, __k: iceKey(c) }) as RTCIceCandidateInit & { __k: string }),
        distinctUntilChanged((a, b) => a.__k === b.__k),
        map(({ __k, ...rest }) => rest),
        shareReplay({ bufferSize: 1, refCount: true }),
    )

    return {
        offer$,
        answer$,
        callerIce$,
        calleeIce$,

        // проброс команд как есть (для эффекторной части)
        setOffer: db.setOffer.bind(db),
        setAnswer: db.setAnswer.bind(db),
        addCallerIceCandidate: db.addCallerIceCandidate.bind(db),
        addCalleeIceCandidate: db.addCalleeIceCandidate.bind(db),
        clearOffer: db.clearOffer.bind(db),
        clearAnswer: db.clearAnswer.bind(db),
        clearCallerCandidates: db.clearCallerCandidates.bind(db),
        clearCalleeCandidates: db.clearCalleeCandidates.bind(db),
        createRoom: db.createRoom.bind(db),
        joinRoom: db.joinRoom.bind(db),
        endRoom: db.endRoom.bind(db),
    }
}

// ——— Удобный «стартер» для роли в уже выбранной комнате ———
// Он ничего не скрывает: просто подготавливает нужный remoteIce$ по роли.
export function withRoom(db: SignalDB, role: Role, roomId: string) {
    const s = createSignalStreams(db)

    // если вы хотите «лениво» подключаться — используйте defer + joinRoom внутри эффекта
    const join$ = defer(() => db.joinRoom(roomId))

    // какие ICE считаются *remote* для данной роли
    const remoteIce$ = role === 'caller' ? s.calleeIce$ : s.callerIce$

    return {
        // «подключение» к комнате (вызвать и подписаться, чтобы инициировать join)
        join$,

        // входящие потоки
        offer$: s.offer$,
        answer$: s.answer$,
        remoteIce$,

        // исходящие команды для этой роли
        publishOffer: s.setOffer,
        publishAnswer: s.setAnswer,
        addLocalIce: role === 'caller' ? s.addCallerIceCandidate : s.addCalleeIceCandidate,

        // чистки
        clearOffer: s.clearOffer,
        clearAnswer: s.clearAnswer,
        clearLocalIce: role === 'caller' ? s.clearCallerCandidates : s.clearCalleeCandidates,
        clearRemoteIce: role === 'caller' ? s.clearCalleeCandidates : s.clearCallerCandidates,

        // управление комнатой
        endRoom: s.endRoom,
    }
}
