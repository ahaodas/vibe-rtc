// FBAdapter.ts

import type {
    AnswerSDP,
    CandidateDoc,
    IcePhase,
    OfferSDP,
    RoomDoc,
    SignalDB,
} from '@vibe-rtc/rtc-core'
import type { Auth } from 'firebase/auth'
import {
    type CollectionReference,
    collection,
    type DocumentReference,
    type DocumentSnapshot,
    deleteDoc,
    doc,
    type Firestore,
    getDoc,
    getDocFromServer,
    getDocs,
    onSnapshot,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
} from 'firebase/firestore'

const ROOMS = 'rooms'
const CALLER_CANDIDATES = 'callerCandidates'
const CALLEE_CANDIDATES = 'calleeCandidates'
const ROOM_TTL_MINUTES = 120

const sanitize = <T extends Record<string, any>>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

const createId = (prefix: string): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

type IceCandidateInput =
    | RTCIceCandidate
    | (RTCIceCandidateInit & {
          epoch?: number
          sessionId?: string
          pcGeneration?: number
          gen?: number
          icePhase?: IcePhase | 'TURN_ONLY'
      })

type RoomDocWithSlots = RoomDoc & {
    slots?: {
        caller?: {
            participantId: string
            sessionId: string
            joinedAt: number
            lastSeenAt: number
        } | null
        callee?: {
            participantId: string
            sessionId: string
            joinedAt: number
            lastSeenAt: number
        } | null
    }
}

const toIcePhase = (value: unknown): IcePhase | undefined => {
    if (value === 'LAN' || value === 'STUN' || value === 'STUN_ONLY' || value === 'TURN_ENABLED')
        return value
    // Backward compatibility for already-persisted signaling payloads.
    if (value === 'TURN_ONLY') return 'TURN_ENABLED'
    return undefined
}

const candidateDocId = (ice: RTCIceCandidateInit): string => {
    const raw = `${(ice as any).sessionId ?? ''}|${ice.candidate ?? ''}|${ice.sdpMid ?? ''}|${ice.sdpMLineIndex ?? -1}|${ice.usernameFragment ?? ''}`
    let h = 2166136261
    for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return `c_${(h >>> 0).toString(16)}`
}

const normalizeIceCandidate = (
    ice: IceCandidateInput,
): RTCIceCandidateInit & {
    epoch?: number
    sessionId?: string
    pcGeneration?: number
    gen?: number
    icePhase?: IcePhase
} => {
    const withMaybeToJson = ice as RTCIceCandidate & {
        epoch?: number
        sessionId?: string
        pcGeneration?: number
        gen?: number
        icePhase?: IcePhase | 'TURN_ONLY'
        toJSON?: () => RTCIceCandidateInit
    }
    const base = typeof withMaybeToJson.toJSON === 'function' ? withMaybeToJson.toJSON() : ice
    const normalized = base as RTCIceCandidateInit & {
        epoch?: number
        sessionId?: string
        pcGeneration?: number
        gen?: number
        icePhase?: IcePhase | 'TURN_ONLY'
    }
    const safe = { ...normalized, icePhase: toIcePhase(normalized.icePhase) }
    return sanitize(safe)
}

const candidateSignalKey = (
    ice: RTCIceCandidateInit & {
        epoch?: number
        sessionId?: string
        pcGeneration?: number
        gen?: number
        icePhase?: string
    },
) =>
    `${ice.epoch ?? -1}|${ice.sessionId ?? 'n/a'}|${ice.pcGeneration ?? -1}|${ice.gen ?? -1}|${ice.icePhase ?? 'n/a'}|${ice.candidate ?? ''}|${ice.sdpMid ?? ''}|${ice.sdpMLineIndex ?? -1}|${ice.usernameFragment ?? ''}`

export class FBAdapter implements SignalDB {
    private roomRef?: DocumentReference<RoomDoc>
    private callerCol?: CollectionReference<CandidateDoc>
    private calleeCol?: CollectionReference<CandidateDoc>
    private roomEpoch = 0
    private readonly participantId = createId('participant')
    private readonly roleSessionByRole: Record<'caller' | 'callee', string | null> = {
        caller: null,
        callee: null,
    }

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

    getParticipantId(): string {
        return this.participantId
    }

    getRoleSessionId(role: 'caller' | 'callee'): string | null {
        return this.roleSessionByRole[role] ?? null
    }

    // ---------------- Rooms ----------------
    async createRoom(): Promise<string> {
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        const sessionId = createId('session')
        const now = Date.now()

        // addDoc semantics: guarantees a new id and no conflict.
        const ref = doc(collection(this.db, ROOMS) as any)
        await setDoc(ref, {
            creatorUid: uid,
            callerUid: uid,
            calleeUid: null,
            slots: {
                caller: {
                    participantId: this.participantId,
                    sessionId,
                    joinedAt: now,
                    lastSeenAt: now,
                },
                callee: null,
            },
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
        this.roleSessionByRole.caller = sessionId
        this.roleSessionByRole.callee = null
        return ref.id
    }

    async joinRoom(id: string, role?: 'caller' | 'callee'): Promise<void> {
        const ref = doc(this.db, ROOMS, id) as DocumentReference<RoomDoc>
        this.roomRef = ref
        this.callerCol = collection(ref, CALLER_CANDIDATES) as CollectionReference<CandidateDoc>
        this.calleeCol = collection(ref, CALLEE_CANDIDATES) as CollectionReference<CandidateDoc>
        const uid = this.uid

        if (!role) {
            const snap = await getDoc(ref)
            if (!snap.exists()) {
                await setDoc(
                    ref,
                    {
                        creatorUid: null,
                        callerUid: null,
                        calleeUid: null,
                        slots: { caller: null, callee: null },
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
            const latest = (await getDoc(ref)).data() as RoomDocWithSlots | undefined
            this.roomEpoch = latest?.epoch ?? 0
            return
        }

        const nextSessionId = createId('session')
        const now = Date.now()
        await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(ref)
            const exists = snap.exists()
            const data = (snap.data() as RoomDocWithSlots | undefined) ?? undefined
            const slots = {
                caller: data?.slots?.caller ?? null,
                callee: data?.slots?.callee ?? null,
            }
            slots[role] = {
                participantId: this.participantId,
                sessionId: nextSessionId,
                joinedAt: now,
                lastSeenAt: now,
            }

            const baseDoc: Partial<RoomDoc> = exists
                ? {}
                : {
                      creatorUid: uid ?? null,
                      callerUid: null,
                      calleeUid: null,
                      offer: null,
                      answer: null,
                      epoch: 0,
                      createdAt: serverTimestamp(),
                      expiresAt: new Date(Date.now() + ROOM_TTL_MINUTES * 60_000),
                  }

            const rolePatch: Partial<RoomDoc> =
                role === 'caller' ? (uid ? { callerUid: uid } : {}) : uid ? { calleeUid: uid } : {}

            tx.set(
                ref,
                {
                    ...baseDoc,
                    ...rolePatch,
                    slots,
                    updatedAt: serverTimestamp(),
                } as Partial<RoomDoc>,
                { merge: true },
            )
        })

        const latest = (await getDoc(ref)).data() as RoomDocWithSlots | undefined
        this.roomEpoch = latest?.epoch ?? 0
        this.roleSessionByRole[role] = nextSessionId
    }

    async getRoom(): Promise<RoomDoc | null> {
        if (!this.roomRef) throw new Error('Room not selected')
        let snap: DocumentSnapshot<RoomDoc>
        try {
            snap = await getDocFromServer(this.roomRef)
        } catch {
            snap = await getDoc(this.roomRef)
        }
        const room = snap.exists() ? (snap.data() as RoomDocWithSlots) : null
        if (room) {
            this.roomEpoch = room.epoch ?? 0
            const callerSlot = room.slots?.caller
            const calleeSlot = room.slots?.callee
            if (callerSlot?.participantId === this.participantId) {
                this.roleSessionByRole.caller = callerSlot.sessionId
            }
            if (calleeSlot?.participantId === this.participantId) {
                this.roleSessionByRole.callee = calleeSlot.sessionId
            }
        }
        return room
    }

    async claimCallerIfFree(): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        return await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(this.roomRef!)
            const data = snap.data() as RoomDocWithSlots
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
            const data = snap.data() as RoomDocWithSlots
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
            [`slots.${role}.lastSeenAt`]: Date.now(),
            updatedAt: serverTimestamp(),
        } as any)
    }

    async tryTakeOver(role: 'caller' | 'callee', staleMs: number): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        let claimedSessionId: string | null = null

        const taken = await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(this.roomRef!)
            const data = snap.data() as RoomDocWithSlots

            const now = Date.now()
            const hb =
                role === 'caller'
                    ? (data as any).callerHeartbeatAt
                    : (data as any).calleeHeartbeatAt
            const owner = role === 'caller' ? data.callerUid : data.calleeUid
            const slot = role === 'caller' ? data.slots?.caller : data.slots?.callee
            const slotLastSeenAt =
                typeof slot?.lastSeenAt === 'number' && Number.isFinite(slot.lastSeenAt)
                    ? slot.lastSeenAt
                    : 0

            const hbMs = typeof hb?.toMillis === 'function' ? hb.toMillis() : 0
            const staleByHeartbeat = owner != null && hbMs > 0 && now - hbMs > staleMs
            const staleBySlot = slotLastSeenAt > 0 && now - slotLastSeenAt > staleMs
            const stale = staleByHeartbeat || staleBySlot
            const free = owner == null

            if (free || stale) {
                const nextSessionId = createId('session')
                const patch: Partial<RoomDoc> =
                    role === 'caller' ? { callerUid: uid } : { calleeUid: uid }
                const nextSlots = {
                    caller: data.slots?.caller ?? null,
                    callee: data.slots?.callee ?? null,
                }
                nextSlots[role] = {
                    participantId: this.participantId,
                    sessionId: nextSessionId,
                    joinedAt: now,
                    lastSeenAt: now,
                }

                tx.update(this.roomRef!, {
                    ...patch,
                    slots: nextSlots,
                    epoch: (data.epoch ?? 0) + 1,
                    offer: null,
                    answer: null,
                    updatedAt: serverTimestamp(),
                } as Partial<RoomDoc>)
                claimedSessionId = nextSessionId
                return true
            }
            return false
        })
        if (taken && claimedSessionId) this.roleSessionByRole[role] = claimedSessionId
        return taken
    }

    // ---------------- SDP ------------------

    async getOffer(): Promise<OfferSDP | null> {
        if (!this.roomRef) throw new Error('Room not selected')
        const snap = await getDoc(this.roomRef)
        return (snap.data()?.offer ?? null) as OfferSDP | null
    }

    async setOffer(offer: OfferSDP): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        // merge:true avoids create() and prevents "already exists" conflicts.
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
            const data = snap.data() as RoomDocWithSlots | undefined
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

    async addCallerIceCandidate(ice: RTCIceCandidate | CandidateDoc): Promise<void> {
        if (!this.callerCol) throw new Error('Room not selected')
        const json = normalizeIceCandidate(ice as IceCandidateInput)
        const ref = doc(this.callerCol, candidateDocId(json))
        await setDoc(
            ref,
            {
                ...json,
                epoch: json.epoch ?? this.roomEpoch,
                pcGeneration: json.pcGeneration,
                createdAt: serverTimestamp(),
            },
            { merge: true },
        )
    }

    async addCalleeIceCandidate(ice: RTCIceCandidate | CandidateDoc): Promise<void> {
        if (!this.calleeCol) throw new Error('Room not selected')
        const json = normalizeIceCandidate(ice as IceCandidateInput)
        const ref = doc(this.calleeCol, candidateDocId(json))
        await setDoc(
            ref,
            {
                ...json,
                epoch: json.epoch ?? this.roomEpoch,
                pcGeneration: json.pcGeneration,
                createdAt: serverTimestamp(),
            },
            { merge: true },
        )
    }

    subscribeOnCallerIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void {
        if (!this.callerCol) return () => {}
        const seenByDocId = new Map<string, string>()
        const unsub = onSnapshot(this.callerCol, (snap) => {
            snap.docChanges().forEach((ch) => {
                if (ch.type === 'removed') {
                    seenByDocId.delete(ch.doc.id)
                    return
                }
                if (ch.type !== 'added' && ch.type !== 'modified') return
                const data = ch.doc.data()
                const key = candidateSignalKey(data)
                if (seenByDocId.get(ch.doc.id) === key) return
                seenByDocId.set(ch.doc.id, key)
                cb(data)
            })
        })
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    subscribeOnCalleeIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void {
        if (!this.calleeCol) return () => {}
        const seenByDocId = new Map<string, string>()
        const unsub = onSnapshot(this.calleeCol, (snap) => {
            snap.docChanges().forEach((ch) => {
                if (ch.type === 'removed') {
                    seenByDocId.delete(ch.doc.id)
                    return
                }
                if (ch.type !== 'added' && ch.type !== 'modified') return
                const data = ch.doc.data()
                const key = candidateSignalKey(data)
                if (seenByDocId.get(ch.doc.id) === key) return
                seenByDocId.set(ch.doc.id, key)
                cb(data)
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

    private async clearRoleCandidatesForSession(
        role: 'caller' | 'callee',
        sessionId: string | null,
    ): Promise<void> {
        if (!sessionId) return
        const col = role === 'caller' ? this.callerCol : this.calleeCol
        if (!col) return
        const qs = await getDocs(query(col, where('sessionId', '==', sessionId)))
        await Promise.all(qs.docs.map((d) => deleteDoc(d.ref)))
    }

    async leaveRoom(role: 'caller' | 'callee'): Promise<void> {
        if (!this.roomRef) return
        const localSessionId = this.roleSessionByRole[role]
        const isOwner = await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(this.roomRef!)
            if (!snap.exists()) return false
            const data = snap.data() as RoomDocWithSlots
            const slot = role === 'caller' ? data.slots?.caller : data.slots?.callee
            if (!slot || slot.participantId !== this.participantId) return false

            if (role === 'caller') {
                tx.update(this.roomRef!, {
                    callerUid: null,
                    callerHeartbeatAt: null,
                    offer: null,
                    'slots.caller': null,
                    updatedAt: serverTimestamp(),
                } as Partial<RoomDoc>)
            } else {
                tx.update(this.roomRef!, {
                    calleeUid: null,
                    calleeHeartbeatAt: null,
                    answer: null,
                    'slots.callee': null,
                    updatedAt: serverTimestamp(),
                } as Partial<RoomDoc>)
            }
            return true
        })
        if (!isOwner) return

        await this.clearRoleCandidatesForSession(role, localSessionId).catch(() => {})
        this.roleSessionByRole[role] = null
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
        this.roleSessionByRole.caller = null
        this.roleSessionByRole.callee = null
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
