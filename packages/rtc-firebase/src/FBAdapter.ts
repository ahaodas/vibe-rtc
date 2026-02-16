// FBAdapter.ts
import {
    type Firestore,
    collection,
    doc,
    type DocumentReference,
    type CollectionReference,
    setDoc,
    updateDoc,
    getDoc,
    getDocFromServer,
    increment,
    onSnapshot,
    getDocs,
    deleteDoc,
    serverTimestamp,
    runTransaction,
} from 'firebase/firestore'
import type { Auth } from 'firebase/auth'

import {
    type SignalDB,
    type OfferSDP,
    type AnswerSDP,
    type RoomDoc,
    type CandidateDoc,
} from '@vibe-rtc/rtc-core'

const ROOMS = 'rooms'
const CALLER_CANDIDATES = 'callerCandidates'
const CALLEE_CANDIDATES = 'calleeCandidates'
const ROOM_TTL_MINUTES = 120

const sanitize = <T extends Record<string, any>>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

const candidateDocId = (ice: RTCIceCandidateInit): string => {
    const raw = `${ice.candidate ?? ''}|${ice.sdpMid ?? ''}|${ice.sdpMLineIndex ?? -1}|${ice.usernameFragment ?? ''}`
    let h = 2166136261
    for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return `c_${(h >>> 0).toString(16)}`
}

export class FBAdapter implements SignalDB {
    private roomRef?: DocumentReference<RoomDoc>
    private callerCol?: CollectionReference<CandidateDoc>
    private calleeCol?: CollectionReference<CandidateDoc>
    private roomEpoch = 0

    private unsubs = new Set<() => void>()

    constructor(
        private readonly db: Firestore,
        private readonly auth: Auth,
    ) {}

    private get uid(): string | null {
        try {
            return this.auth?.currentUser?.uid ?? null
        } catch {
            return null
        }
    }

    // ---------------- Rooms ----------------
    async createRoom(): Promise<string> {
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        // addDoc гарантирует новый id и не конфликтует
        const ref = doc(collection(this.db, ROOMS) as any)
        await setDoc(ref, {
            creatorUid: uid,
            callerUid: uid,
            calleeUid: null,
            offer: null,
            answer: null,
            epoch: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + ROOM_TTL_MINUTES * 60_000),
        })

        this.roomRef = ref as DocumentReference<RoomDoc>
        this.callerCol = collection(ref, CALLER_CANDIDATES) as CollectionReference<CandidateDoc>
        this.calleeCol = collection(ref, CALLEE_CANDIDATES) as CollectionReference<CandidateDoc>
        this.roomEpoch = 0
        return ref.id
    }

    async joinRoom(id: string, role?: 'caller' | 'callee'): Promise<void> {
        const ref = doc(this.db, ROOMS, id) as DocumentReference<RoomDoc>
        this.roomRef = ref
        this.callerCol = collection(ref, CALLER_CANDIDATES) as CollectionReference<CandidateDoc>
        this.calleeCol = collection(ref, CALLEE_CANDIDATES) as CollectionReference<CandidateDoc>

        // если документа нет — «мягко» создадим, без create()
        const snap = await getDoc(ref)
        if (!snap.exists()) {
            await setDoc(
                ref,
                {
                    creatorUid: null,
                    callerUid: null,
                    calleeUid: null,
                    offer: null,
                    answer: null,
                    epoch: 0,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    expiresAt: new Date(Date.now() + ROOM_TTL_MINUTES * 60_000),
                } as Partial<RoomDoc>,
                { merge: true },
            )
        }

        // Первичное присоединение в выбранную роль.
        let joinedAsNewRole = false
        const uid = this.uid
        if (uid) {
            const fresh = await getDoc(ref)
            const data = fresh.data() as RoomDoc | undefined
            if (role === 'caller' && data && data.callerUid == null) {
                try {
                    await updateDoc(ref, { callerUid: uid, updatedAt: serverTimestamp() })
                    joinedAsNewRole = true
                } catch {
                    /* not critical */
                }
            }
            if (role === 'callee' && data && data.calleeUid == null) {
                try {
                    await updateDoc(ref, { calleeUid: uid, updatedAt: serverTimestamp() })
                    joinedAsNewRole = true
                } catch {
                    /* not critical */
                }
            }
        }

        let latest = (await getDoc(ref)).data() as RoomDoc | undefined
        this.roomEpoch = latest?.epoch ?? 0

        // Если это re-attach существующего участника (например, reload страницы),
        // поднимаем epoch и чистим SDP, чтобы обе стороны перешли в новое поколение сигналинга.
        if (
            uid &&
            latest &&
            role &&
            role === 'caller' &&
            !joinedAsNewRole &&
            (role === 'caller' ? latest.callerUid === uid : latest.calleeUid === uid)
        ) {
            const hasActivity =
                !!latest.offer ||
                !!latest.answer ||
                !!latest.callerHeartbeatAt ||
                !!latest.calleeHeartbeatAt ||
                (latest.epoch ?? 0) > 0
            if (!hasActivity) return
            try {
                await updateDoc(ref, {
                    epoch: increment(1),
                    offer: null,
                    answer: null,
                    updatedAt: serverTimestamp(),
                } as any)
            } catch {
                /* best effort */
            }
            latest = (await getDoc(ref)).data() as RoomDoc | undefined
            this.roomEpoch = latest?.epoch ?? this.roomEpoch
        }
    }

    async getRoom(): Promise<RoomDoc | null> {
        if (!this.roomRef) throw new Error('Room not selected')
        let snap
        try {
            snap = await getDocFromServer(this.roomRef)
        } catch {
            snap = await getDoc(this.roomRef)
        }
        const room = snap.exists() ? (snap.data() as RoomDoc) : null
        if (room) this.roomEpoch = room.epoch ?? 0
        return room
    }

    async claimCallerIfFree(): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        return await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(this.roomRef!)
            const data = snap.data() as RoomDoc
            if (data.callerUid == null) {
                tx.update(this.roomRef!, {
                    callerUid: uid,
                    updatedAt: serverTimestamp(),
                } as Partial<RoomDoc>)
                return true
            }
            return data.callerUid === uid
        })
    }

    async claimCalleeIfFree(): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        return await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(this.roomRef!)
            const data = snap.data() as RoomDoc
            if (data.calleeUid == null) {
                tx.update(this.roomRef!, {
                    calleeUid: uid,
                    updatedAt: serverTimestamp(),
                } as Partial<RoomDoc>)
                return true
            }
            return data.calleeUid === uid
        })
    }

    async heartbeat(role: 'caller' | 'callee'): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        const field = role === 'caller' ? 'callerHeartbeatAt' : 'calleeHeartbeatAt'
        await updateDoc(this.roomRef, {
            [field]: serverTimestamp(),
            updatedAt: serverTimestamp(),
        } as any)
    }

    async tryTakeOver(role: 'caller' | 'callee', staleMs: number): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        return await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(this.roomRef!)
            const data = snap.data() as RoomDoc

            const hb =
                role === 'caller'
                    ? (data as any).callerHeartbeatAt
                    : (data as any).calleeHeartbeatAt
            const owner = role === 'caller' ? data.callerUid : data.calleeUid

            const now = Date.now()
            const hbMs = typeof hb?.toMillis === 'function' ? hb.toMillis() : 0
            const stale = owner != null && hbMs > 0 && now - hbMs > staleMs
            const free = owner == null

            if (free || stale) {
                const patch: Partial<RoomDoc> =
                    role === 'caller' ? { callerUid: uid } : { calleeUid: uid }

                tx.update(this.roomRef!, {
                    ...patch,
                    epoch: (data.epoch ?? 0) + 1,
                    offer: null,
                    answer: null,
                    updatedAt: serverTimestamp(),
                } as Partial<RoomDoc>)
                return true
            }
            return false
        })
    }

    // ---------------- SDP ------------------

    async getOffer(): Promise<OfferSDP | null> {
        if (!this.roomRef) throw new Error('Room not selected')
        const snap = await getDoc(this.roomRef)
        return (snap.data()?.offer ?? null) as OfferSDP | null
    }

    async setOffer(offer: OfferSDP): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        // merge:true — никакого create(), избегаем "already exists"
        await setDoc(
            this.roomRef,
            {
                offer: { ...offer, epoch: this.roomEpoch },
                updatedAt: serverTimestamp(),
            },
            { merge: true },
        )
    }

    async clearOffer(): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        await updateDoc(this.roomRef, { offer: null, updatedAt: serverTimestamp() })
    }

    async setAnswer(answer: AnswerSDP): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        try {
            const snap = await getDoc(this.roomRef)
            const data = snap.data() as RoomDoc | undefined
            if (data && !data.calleeUid) {
                await updateDoc(this.roomRef, { calleeUid: uid } as Partial<RoomDoc>)
            }
        } catch {
            /* noop */
        }

        await setDoc(
            this.roomRef,
            {
                answer: { ...answer, epoch: this.roomEpoch },
                updatedAt: serverTimestamp(),
            } as Partial<RoomDoc>,
            { merge: true },
        )
    }

    async clearAnswer(): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        await updateDoc(this.roomRef, { answer: null, updatedAt: serverTimestamp() })
    }

    subscribeOnOffer(cb: (offer: OfferSDP) => void | Promise<void>): () => void {
        if (!this.roomRef) return () => {}
        const unsub = onSnapshot(this.roomRef, async (snap) => {
            if (snap.metadata.hasPendingWrites) return
            const data = snap.data()
            if (data?.epoch !== undefined) this.roomEpoch = data.epoch
            if (data?.offer) await cb(data.offer as OfferSDP)
        })
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    subscribeOnAnswer(cb: (answer: AnswerSDP) => void | Promise<void>): () => void {
        if (!this.roomRef) return () => {}
        const unsub = onSnapshot(this.roomRef, async (snap) => {
            if (snap.metadata.hasPendingWrites) return
            const data = snap.data()
            if (data?.epoch !== undefined) this.roomEpoch = data.epoch
            if (data?.answer) await cb(data.answer as AnswerSDP)
        })
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    // ------------- ICE -------------

    async addCallerIceCandidate(ice: RTCIceCandidate): Promise<void> {
        if (!this.callerCol) throw new Error('Room not selected')
        const json = sanitize(ice.toJSON())
        const ref = doc(this.callerCol, candidateDocId(json))
        await setDoc(ref, { ...json, epoch: this.roomEpoch, createdAt: serverTimestamp() }, { merge: true })
    }

    async addCalleeIceCandidate(ice: RTCIceCandidate): Promise<void> {
        if (!this.calleeCol) throw new Error('Room not selected')
        const json = sanitize(ice.toJSON())
        const ref = doc(this.calleeCol, candidateDocId(json))
        await setDoc(ref, { ...json, epoch: this.roomEpoch, createdAt: serverTimestamp() }, { merge: true })
    }


    subscribeOnCallerIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void {
        if (!this.callerCol) return () => {}
        const unsub = onSnapshot(this.callerCol, (snap) => {
            snap.docChanges().forEach((ch) => {
                if (ch.type === 'added') cb(ch.doc.data())
            })
        })
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    subscribeOnCalleeIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void {
        if (!this.calleeCol) return () => {}
        const unsub = onSnapshot(this.calleeCol, (snap) => {
            snap.docChanges().forEach((ch) => {
                if (ch.type === 'added') cb(ch.doc.data())
            })
        })
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    async clearCallerCandidates(): Promise<void> {
        if (!this.callerCol) throw new Error('Room not selected')
        const qs = await getDocs(this.callerCol)
        await Promise.all(qs.docs.map((d) => deleteDoc(d.ref)))
    }

    async clearCalleeCandidates(): Promise<void> {
        if (!this.calleeCol) throw new Error('Room not selected')
        const qs = await getDocs(this.calleeCol)
        await Promise.all(qs.docs.map((d) => deleteDoc(d.ref)))
    }

    // ------------- End room ------------------

    async endRoom(): Promise<void> {
        if (!this.roomRef) return
        this.flushUnsubs()

        if (this.callerCol) {
            const c = await getDocs(this.callerCol)
            await Promise.all(c.docs.map((d) => deleteDoc(d.ref)))
        }
        if (this.calleeCol) {
            const c = await getDocs(this.calleeCol)
            await Promise.all(c.docs.map((d) => deleteDoc(d.ref)))
        }

        await deleteDoc(this.roomRef).catch(() => {})
        this.roomRef = undefined
        this.callerCol = undefined
        this.calleeCol = undefined
    }

    // ------------- utils ---------------------------

    private trackUnsub(unsub: () => void) {
        this.unsubs.add(unsub)
    }

    private wrapUnsub(unsub: () => void): () => void {
        return () => {
            if (this.unsubs.has(unsub)) {
                this.unsubs.delete(unsub)
            }
            try {
                unsub()
            } catch {
                /* noop */
            }
        }
    }

    private flushUnsubs() {
        for (const unsub of Array.from(this.unsubs)) {
            try {
                unsub()
            } catch {
                /* noop */
            }
            this.unsubs.delete(unsub)
        }
    }
}
