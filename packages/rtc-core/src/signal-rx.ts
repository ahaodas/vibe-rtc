// signal-rx.ts
// Thin RxJS wrapper over the existing SignalDB (without rewriting the adapter)

import { distinctUntilChanged, map, Observable, shareReplay } from 'rxjs'

type SignalDescription = RTCSessionDescriptionInit & {
    epoch?: number
    pcGeneration?: number
    forPcGeneration?: number
}
type SignalIce = RTCIceCandidateInit & { epoch?: number; pcGeneration?: number }

export interface SignalDB {
    // room control
    createRoom(): Promise<string>
    joinRoom(id: string, role?: 'caller' | 'callee'): void | Promise<void>
    endRoom(): Promise<void>

    // offer/answer
    setOffer(offer: SignalDescription): Promise<void>
    setAnswer(answer: SignalDescription): Promise<void>
    clearOffer(): Promise<void>
    clearAnswer(): Promise<void>
    subscribeOnOffer(cb: (offer: SignalDescription) => void): () => void
    subscribeOnAnswer(cb: (answer: SignalDescription) => void): () => void

    // ICE
    addCallerIceCandidate(c: SignalIce): Promise<void>
    addCalleeIceCandidate(c: SignalIce): Promise<void>
    clearCallerCandidates(): Promise<void>
    clearCalleeCandidates(): Promise<void>
    subscribeOnCallerIceCandidate(cb: (c: SignalIce) => void): () => void
    subscribeOnCalleeIceCandidate(cb: (c: SignalIce) => void): () => void
}

// --- Dedupe utilities ---
const sdpHash = (s?: string | null) => {
    if (!s) return '∅'
    let x = 2166136261
    for (let i = 0; i < s.length; i++) {
        x ^= s.charCodeAt(i)
        x = Math.imul(x, 16777619)
    }
    return `len=${s.length}#${(x >>> 0).toString(16)}`
}

const iceKey = (c: SignalIce) =>
    `${c.epoch ?? -1}|${c.candidate ?? ''}|${c.sdpMid ?? ''}|${c.sdpMLineIndex ?? -1}`

// --- Base subscribe -> Observable converter ---
function fromSubscribe<T>(sub: (cb: (v: T) => void) => () => void): Observable<T> {
    return new Observable<T>((subscriber) => {
        const unsub = sub((v) => subscriber.next(v))
        return () => {
            try {
                unsub?.()
            } catch {}
            subscriber.complete()
        }
    })
}

// --- SignalDB wrapper with Rx streams ---
export function createSignalStreams(db: SignalDB) {
    const offerRaw$ = fromSubscribe<SignalDescription>(db.subscribeOnOffer.bind(db))
    const answerRaw$ = fromSubscribe<SignalDescription>(db.subscribeOnAnswer.bind(db))

    // SDP dedupe (Firestore may occasionally emit duplicates)
    const offer$ = offerRaw$.pipe(
        map(
            (d) =>
                ({
                    ...d,
                    __h: `${d.epoch ?? -1}:${sdpHash(d.sdp ?? null)}`,
                }) as SignalDescription & { __h: string },
        ),
        distinctUntilChanged((a, b) => a.__h === b.__h),
        map(({ __h, ...rest }) => rest),
        shareReplay({ bufferSize: 1, refCount: true }),
    )

    const answer$ = answerRaw$.pipe(
        map(
            (d) =>
                ({
                    ...d,
                    __h: `${d.epoch ?? -1}:${sdpHash(d.sdp ?? null)}`,
                }) as SignalDescription & { __h: string },
        ),
        distinctUntilChanged((a, b) => a.__h === b.__h),
        map(({ __h, ...rest }) => rest),
        shareReplay({ bufferSize: 1, refCount: true }),
    )

    // ICE stream for each side is selected by role
    const callerIceRaw$ = fromSubscribe<SignalIce>(db.subscribeOnCallerIceCandidate.bind(db))
    const calleeIceRaw$ = fromSubscribe<SignalIce>(db.subscribeOnCalleeIceCandidate.bind(db))

    const callerIce$ = callerIceRaw$.pipe(
        map((c) => ({ ...c, __k: iceKey(c) }) as SignalIce & { __k: string }),
        distinctUntilChanged((a, b) => a.__k === b.__k),
        map(({ __k, ...rest }) => rest),
        shareReplay({ bufferSize: 1, refCount: true }),
    )

    const calleeIce$ = calleeIceRaw$.pipe(
        map((c) => ({ ...c, __k: iceKey(c) }) as SignalIce & { __k: string }),
        distinctUntilChanged((a, b) => a.__k === b.__k),
        map(({ __k, ...rest }) => rest),
        shareReplay({ bufferSize: 1, refCount: true }),
    )

    return {
        offer$,
        answer$,
        callerIce$,
        calleeIce$,

        // pass through commands as-is (for the effectful part)
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
