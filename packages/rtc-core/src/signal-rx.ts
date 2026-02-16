// signal-rx.ts
// Тонкая RxJS-обёртка над вашим существующим SignalDB (без переписывания адаптера)

import { Observable, shareReplay, map, distinctUntilChanged } from 'rxjs'

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
