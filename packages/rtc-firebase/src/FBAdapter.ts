import {
    type Firestore,
    collection,
    doc,
    type DocumentReference,
    type CollectionReference,
    addDoc,
    setDoc,
    updateDoc,
    getDoc,
    onSnapshot,
    getDocs,
    deleteDoc,
    serverTimestamp,
} from 'firebase/firestore'

import {
    type SignalDB,
    type OfferSDP,
    type AnswerSDP,
    RoomDoc,
    CandidateDoc,
} from '@vibe-rtc/rtc-core'
import type { Auth } from 'firebase/auth'

const explain = (e: unknown) => console.error('[FBAdapter]', (e as any)?.code, (e as any)?.message)

const sanitize = <T extends Record<string, any>>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

const ROOMS = 'rooms'
const CALLER_CANDIDATES = 'callerCandidates'
const CALLEE_CANDIDATES = 'calleeCandidates'
const ROOM_TTL_MINUTES = 120

export class FBAdapter implements SignalDB {
    private roomRef?: DocumentReference<RoomDoc>
    private callerCol?: CollectionReference<CandidateDoc>
    private calleeCol?: CollectionReference<CandidateDoc>

    /** Регистрируем все активные отписки, чтобы закрыть их в endRoom() */
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

        const ref = await addDoc(collection(this.db, ROOMS) as any, {
            callerUid: uid,
            calleeUid: null,
            offer: null,
            answer: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + ROOM_TTL_MINUTES * 60_000),
        })

        this.roomRef = ref as DocumentReference<RoomDoc> // ⬅⬅⬅ ВАЖНО
        this.callerCol = collection(ref, CALLER_CANDIDATES) as CollectionReference<CandidateDoc>
        this.calleeCol = collection(ref, CALLEE_CANDIDATES) as CollectionReference<CandidateDoc>
        return ref.id
    }

    async joinRoom(id: string): Promise<void> {
        const ref = doc(this.db, ROOMS, id) as DocumentReference<RoomDoc>
        this.roomRef = ref // ⬅⬅⬅ ВАЖНО
        this.callerCol = collection(ref, CALLER_CANDIDATES) as CollectionReference<CandidateDoc>
        this.calleeCol = collection(ref, CALLEE_CANDIDATES) as CollectionReference<CandidateDoc>

        // первичное присоединение callee (если пуст)
        const uid = this.uid
        if (uid) {
            const snap = await getDoc(ref)
            const data = snap.data()
            if (data && data.calleeUid == null) {
                try {
                    await updateDoc(ref, { calleeUid: uid, updatedAt: serverTimestamp() })
                } catch (e) {
                    explain(e)
                    throw e
                }
            }
        }
    }

    // ---------------- SDP ------------------

    async getOffer(): Promise<OfferSDP | null> {
        if (!this.roomRef) throw new Error('Room or calleeUid not selected')
        const snap = await getDoc(this.roomRef)
        return (snap.data()?.offer ?? null) as OfferSDP | null
    }

    async setOffer(offer: OfferSDP): Promise<void> {
        if (!this.roomRef) throw new Error('Room or calleeUid not selected')
        try {
            await setDoc(this.roomRef, { offer, updatedAt: serverTimestamp() }, { merge: true })
        } catch (e) {
            explain(e)
        }
    }

    async clearOffer(): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        await updateDoc(this.roomRef!, { offer: null, updatedAt: serverTimestamp() })
    }

    async setAnswer(answer: AnswerSDP): Promise<void> {
        const calleeUid = this.uid
        if (!this.roomRef || !calleeUid) throw new Error('Room or calleeUid not selected')
        await setDoc(
            this.roomRef,
            { answer, calleeUid, updatedAt: serverTimestamp() },
            { merge: true },
        )
    }

    async clearAnswer(): Promise<void> {
        if (!this.roomRef) throw new Error('Room or calleeUid not selected')
        await updateDoc(this.roomRef, { answer: null, updatedAt: serverTimestamp() })
    }

    subscribeOnOffer(cb: (offer: OfferSDP) => void | Promise<void>): () => void {
        if (!this.roomRef) return () => {}
        const unsub = onSnapshot(
            this.roomRef,
            { includeMetadataChanges: true }, // <—
            async (snap) => {
                // пропускаем локальные pending-writes
                if (snap.metadata.hasPendingWrites) return
                const data = snap.data()
                if (data?.offer) await cb(data.offer)
            },
        )
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    subscribeOnAnswer(cb: (answer: AnswerSDP) => void | Promise<void>): () => void {
        if (!this.roomRef) return () => {}
        const unsub = onSnapshot(
            this.roomRef,
            { includeMetadataChanges: true }, // <—
            async (snap) => {
                if (snap.metadata.hasPendingWrites) return
                const data = snap.data()
                if (data?.answer) await cb(data.answer)
            },
        )
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    // ------------- ICE (split by role) -------------

    async addCallerIceCandidate(ice: RTCIceCandidate): Promise<void> {
        if (!this.callerCol) throw new Error('Room not selected')
        const json = sanitize(ice.toJSON())
        await addDoc(this.callerCol, { ...json, createdAt: serverTimestamp() })
    }

    async addCalleeIceCandidate(ice: RTCIceCandidate): Promise<void> {
        if (!this.calleeCol) throw new Error('Room not selected')
        const json = sanitize(ice.toJSON())
        await addDoc(this.calleeCol, { ...json, createdAt: serverTimestamp() })
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

    // ------------- End room (new) ------------------

    /**
     * Полностью завершает комнату:
     * 1) снимает все подписки,
     * 2) удаляет все кандидаты обеих ролей,
     * 3) удаляет документ комнаты.
     */
    async endRoom(): Promise<void> {
        if (!this.roomRef) return

        // 1) отписки
        this.flushUnsubs()

        // 2) чистка подколлекций
        if (this.callerCol) {
            const c = await getDocs(this.callerCol)
            await Promise.all(c.docs.map((d) => deleteDoc(d.ref)))
        }
        if (this.calleeCol) {
            const c = await getDocs(this.calleeCol)
            await Promise.all(c.docs.map((d) => deleteDoc(d.ref)))
        }

        // 3) удаление самой комнаты
        await deleteDoc(this.roomRef)

        // 4) локальная очистка ссылок
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
