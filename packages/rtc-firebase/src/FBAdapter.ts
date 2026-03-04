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
    deleteDoc,
    doc,
    type Firestore,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    writeBatch,
} from 'firebase/firestore'

const ROOMS = 'rooms'
const LEASES = 'leases'
const EVENTS = 'events'
const CALLERS = 'callers'
const CALLEES = 'callees'
const CANDIDATES = 'candidates'
const DEFAULT_TTL_MINUTES = 60
const DEFAULT_HEARTBEAT_INTERVAL_MS = 3000
const ICE_BATCH_FLUSH_MS = 100

export type SecurityMode = 'off' | 'demo_hardened'

type Role = 'caller' | 'callee'

type RoleCollection = 'callers' | 'callees'

type LeaseDoc = {
    role: Role
    ownerUid: string
    ownerSessionId: string
    leaseVersion: number
    createdAt: unknown
    updatedAt: unknown
}

type TakeoverEventDoc = {
    type: 'role_taken_over'
    role: Role
    targetUid: string
    targetSessionId: string
    byUid: string
    bySessionId: string
    createdAt: unknown
}

type ParticipantDoc = {
    uid: string
    role: Role
    sessionId: string
    active: boolean
    offer?: OfferSDP | null
    answer?: AnswerSDP | null
    createdAt: unknown
    updatedAt: unknown
}

type RoomRootDoc = {
    creatorUid: string | null
    callerUid: string | null
    calleeUid: string | null
    offer: null
    answer: null
    epoch: number
    createdAt: unknown
    updatedAt: unknown
    expiresAt: unknown
}

type CandidateStoredDoc = RTCIceCandidateInit & {
    epoch?: number
    sessionId?: string
    pcGeneration?: number
    gen?: number
    icePhase?: IcePhase
    createdAt?: unknown
}

type CandidateQueueItem = {
    payload: CandidateStoredDoc
    resolve: () => void
    reject: (error: unknown) => void
}

type CandidateBufferState = {
    queue: CandidateQueueItem[]
    timer: ReturnType<typeof setTimeout> | undefined
    flushing: boolean
}

export interface FBAdapterStorage {
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
}

export interface FBAdapterCallbacks {
    onShareLink?(payload: { roomId: string; url: string }): void
    onRoomOccupied?(payload: { roomId: string }): void
    onTakenOver?(payload: { roomId: string; bySessionId?: string }): void
    onSecurityError?(err: unknown): void
}

export interface FBAdapterOptions {
    securityMode?: SecurityMode
    storage?: FBAdapterStorage
    callbacks?: FBAdapterCallbacks
    ttlMinutes?: number
    heartbeatIntervalMs?: number
    importTokensFromHash?: boolean
}

const sanitize = <T extends Record<string, unknown>>(value: T): T =>
    Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T

const createId = (prefix: string): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

const toIcePhase = (value: unknown): IcePhase | undefined => {
    if (value === 'LAN' || value === 'STUN' || value === 'STUN_ONLY' || value === 'TURN_ENABLED') {
        return value
    }
    if (value === 'TURN_ONLY') return 'TURN_ENABLED'
    return undefined
}

const normalizeIceCandidate = (
    ice: RTCIceCandidate | CandidateDoc,
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
        candidate?: string
        sdpMid?: string | null
        sdpMLineIndex?: number | null
        usernameFragment?: string | null
        epoch?: number
        sessionId?: string
        pcGeneration?: number
        gen?: number
        icePhase?: IcePhase | 'TURN_ONLY'
    }
    return sanitize({
        candidate: normalized.candidate,
        sdpMid: normalized.sdpMid,
        sdpMLineIndex: normalized.sdpMLineIndex,
        usernameFragment: normalized.usernameFragment,
        sessionId: normalized.sessionId,
        epoch: normalized.epoch,
        pcGeneration: normalized.pcGeneration,
        gen: normalized.gen,
        icePhase: toIcePhase(normalized.icePhase),
    })
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

const roleCollection = (role: Role): RoleCollection => (role === 'caller' ? CALLERS : CALLEES)

const toMillis = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value instanceof Date) return value.getTime()
    if (value && typeof value === 'object') {
        const maybeTimestamp = value as { toMillis?: () => number }
        if (typeof maybeTimestamp.toMillis === 'function') {
            const millis = maybeTimestamp.toMillis()
            if (Number.isFinite(millis)) return millis
        }
    }
    return 0
}

const createMemoryStorage = (): FBAdapterStorage => {
    const map = new Map<string, string>()
    return {
        get(key: string) {
            return map.get(key) ?? null
        },
        set(key: string, value: string) {
            map.set(key, value)
        },
        remove(key: string) {
            map.delete(key)
        },
    }
}

const createDefaultStorage = (): FBAdapterStorage => {
    if (typeof window !== 'undefined') {
        try {
            const storage = window.localStorage
            const probeKey = '__vibe_rtc_probe__'
            storage.setItem(probeKey, '1')
            storage.removeItem(probeKey)
            return {
                get: (key) => storage.getItem(key),
                set: (key, value) => storage.setItem(key, value),
                remove: (key) => storage.removeItem(key),
            }
        } catch {
            // Ignore and fallback to memory.
        }
    }
    return createMemoryStorage()
}

export class FBAdapter implements SignalDB {
    private roomRef?: DocumentReference<RoomRootDoc>
    private roomEpoch = 0
    private readonly roleSessionByRole: Record<Role, string | null> = {
        caller: null,
        callee: null,
    }
    private readonly takeoverDetectedByRole: Record<Role, boolean> = {
        caller: false,
        callee: false,
    }
    private readonly leaseCache: Record<Role, LeaseDoc | null | undefined> = {
        caller: undefined,
        callee: undefined,
    }
    private readonly candidateBuffers: Record<Role, CandidateBufferState> = {
        caller: {
            queue: [],
            timer: undefined,
            flushing: false,
        },
        callee: {
            queue: [],
            timer: undefined,
            flushing: false,
        },
    }

    private activeRole: Role | null = null
    private roomCacheUnsubs: Array<() => void> = []
    private takeoverWatchUnsubs: Array<() => void> = []
    private readonly subUnsubs = new Set<() => void>()
    private readonly internalUnsubs = new Set<() => void>()
    private readonly seenTakeoverEventIds = new Set<string>()
    private readonly fallbackParticipantId = createId('participant')

    private readonly securityMode: SecurityMode
    private readonly storage: FBAdapterStorage
    private readonly callbacks: FBAdapterCallbacks
    private readonly ttlMinutes: number
    private readonly heartbeatIntervalMs: number

    constructor(
        private readonly db: Firestore,
        private readonly auth: Auth,
        options: FBAdapterOptions = {},
    ) {
        this.securityMode = options.securityMode ?? 'off'
        this.storage = options.storage ?? createDefaultStorage()
        this.callbacks = options.callbacks ?? {}
        this.ttlMinutes = Math.max(1, options.ttlMinutes ?? DEFAULT_TTL_MINUTES)
        this.heartbeatIntervalMs = Math.max(
            1000,
            options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
        )
        void this.storage // Kept for backward compatibility with adapter options.
        void this.heartbeatIntervalMs
    }

    private get uid(): string | null {
        try {
            return this.auth?.currentUser?.uid ?? null
        } catch {
            return null
        }
    }

    getParticipantId(): string {
        return this.uid ?? this.fallbackParticipantId
    }

    getRoleSessionId(role: Role): string | null {
        return this.roleSessionByRole[role] ?? null
    }

    private leaseRef(role: Role): DocumentReference<LeaseDoc> {
        if (!this.roomRef) throw new Error('Room not selected')
        return doc(this.roomRef, LEASES, role) as DocumentReference<LeaseDoc>
    }

    private participantsCol(role: Role): CollectionReference<ParticipantDoc> {
        if (!this.roomRef) throw new Error('Room not selected')
        return collection(this.roomRef, roleCollection(role)) as CollectionReference<ParticipantDoc>
    }

    private participantRef(role: Role, uid: string): DocumentReference<ParticipantDoc> {
        return doc(this.participantsCol(role), uid)
    }

    private candidateCol(role: Role, uid: string): CollectionReference<CandidateStoredDoc> {
        return collection(
            this.participantRef(role, uid),
            CANDIDATES,
        ) as CollectionReference<CandidateStoredDoc>
    }

    private eventsCol(): CollectionReference<TakeoverEventDoc> {
        if (!this.roomRef) throw new Error('Room not selected')
        return collection(this.roomRef, EVENTS) as CollectionReference<TakeoverEventDoc>
    }

    private ensureActiveSession(role: Role): string {
        const existing = this.roleSessionByRole[role]
        if (existing) return existing
        const next = createId(`${role}-session`)
        this.roleSessionByRole[role] = next
        return next
    }

    private activeRoleCollection(role: Role): RoleCollection {
        return role === 'caller' ? CALLERS : CALLEES
    }

    private buildShareUrl(roomId: string): string {
        if (typeof window === 'undefined') {
            return `#${encodeURIComponent(`/attach/callee/${roomId}`)}`
        }
        const base = `${window.location.origin}${window.location.pathname}${window.location.search}`
        return `${base}#/attach/callee/${encodeURIComponent(roomId)}`
    }

    private reportSecurityError(err: unknown) {
        this.callbacks.onSecurityError?.(err)
    }

    private trackInternalUnsub(unsub: () => void) {
        this.internalUnsubs.add(unsub)
    }

    private trackSubUnsub(unsub: () => void) {
        this.subUnsubs.add(unsub)
    }

    private wrapSubUnsub(unsub: () => void): () => void {
        return () => {
            this.subUnsubs.delete(unsub)
            try {
                unsub()
            } catch {
                // noop
            }
        }
    }

    private flushInternalUnsubs() {
        for (const unsub of Array.from(this.internalUnsubs)) {
            this.internalUnsubs.delete(unsub)
            try {
                unsub()
            } catch {
                // noop
            }
        }
    }

    private flushSubUnsubs() {
        for (const unsub of Array.from(this.subUnsubs)) {
            this.subUnsubs.delete(unsub)
            try {
                unsub()
            } catch {
                // noop
            }
        }
    }

    private clearRoomCaches() {
        this.leaseCache.caller = undefined
        this.leaseCache.callee = undefined
        this.seenTakeoverEventIds.clear()
    }

    private activateRole(role: Role, sessionId: string) {
        this.activeRole = role
        this.roleSessionByRole[role] = sessionId
        this.takeoverDetectedByRole[role] = false
        this.startTakeoverWatch(role)
    }

    private detectTakeover(role: Role, bySessionId?: string) {
        if (this.takeoverDetectedByRole[role]) return
        this.takeoverDetectedByRole[role] = true
        this.rejectCandidateBuffer(role, `${role} session was taken over`)
        const roomId = this.roomRef?.id
        if (!roomId) return
        this.callbacks.onTakenOver?.({ roomId, bySessionId })
    }

    private assertWritable(role: Role) {
        if (this.takeoverDetectedByRole[role]) {
            throw new Error(`${role} session was taken over by another tab/device`)
        }
    }

    private startLeaseCacheWatch() {
        this.stopLeaseCacheWatch()
        if (!this.roomRef) return

        for (const role of ['caller', 'callee'] as const) {
            const unsub = onSnapshot(
                this.leaseRef(role),
                (snapshot) => {
                    this.leaseCache[role] = snapshot.exists() ? (snapshot.data() as LeaseDoc) : null
                },
                (error) => this.reportSecurityError(error),
            )
            this.roomCacheUnsubs.push(unsub)
            this.trackInternalUnsub(unsub)
        }
    }

    private stopLeaseCacheWatch() {
        for (const unsub of this.roomCacheUnsubs.splice(0)) {
            this.internalUnsubs.delete(unsub)
            try {
                unsub()
            } catch {
                // noop
            }
        }
    }

    private startTakeoverWatch(role: Role) {
        this.stopTakeoverWatch()
        if (!this.roomRef) return

        const localUid = this.uid
        const localSessionId = this.roleSessionByRole[role]
        if (!localUid || !localSessionId) return

        const leaseUnsub = onSnapshot(
            this.leaseRef(role),
            (snapshot) => {
                if (!snapshot.exists()) {
                    this.detectTakeover(role)
                    return
                }
                const lease = snapshot.data() as LeaseDoc
                if (lease.ownerUid !== localUid || lease.ownerSessionId !== localSessionId) {
                    this.detectTakeover(role, lease.ownerSessionId)
                }
            },
            (error) => this.reportSecurityError(error),
        )

        const eventsUnsub = onSnapshot(
            query(this.eventsCol(), orderBy('createdAt', 'desc'), limit(10)),
            (snapshot) => {
                for (const change of snapshot.docChanges()) {
                    if (change.type !== 'added') continue
                    const eventId = change.doc.id
                    if (this.seenTakeoverEventIds.has(eventId)) continue
                    this.seenTakeoverEventIds.add(eventId)
                    const payload = change.doc.data() as TakeoverEventDoc
                    if (
                        payload.type !== 'role_taken_over' ||
                        payload.role !== role ||
                        payload.targetUid !== localUid ||
                        payload.targetSessionId !== localSessionId
                    ) {
                        continue
                    }
                    this.detectTakeover(role, payload.bySessionId)
                }
            },
            (error) => this.reportSecurityError(error),
        )

        this.takeoverWatchUnsubs.push(leaseUnsub, eventsUnsub)
        this.trackInternalUnsub(leaseUnsub)
        this.trackInternalUnsub(eventsUnsub)
    }

    private stopTakeoverWatch() {
        for (const unsub of this.takeoverWatchUnsubs.splice(0)) {
            this.internalUnsubs.delete(unsub)
            try {
                unsub()
            } catch {
                // noop
            }
        }
    }

    private async getLease(role: Role): Promise<LeaseDoc | null> {
        const cached = this.leaseCache[role]
        if (cached !== undefined) return cached
        const snapshot = await getDoc(this.leaseRef(role))
        const lease = snapshot.exists() ? (snapshot.data() as LeaseDoc) : null
        this.leaseCache[role] = lease
        return lease
    }

    private async getRoleSlots(): Promise<RoomDoc['slots']> {
        const [callerLease, calleeLease] = await Promise.all([
            this.getLease('caller'),
            this.getLease('callee'),
        ])

        return {
            caller: callerLease
                ? {
                      participantId: callerLease.ownerUid,
                      sessionId: callerLease.ownerSessionId,
                      joinedAt: toMillis(callerLease.createdAt),
                      lastSeenAt: toMillis(callerLease.updatedAt),
                  }
                : null,
            callee: calleeLease
                ? {
                      participantId: calleeLease.ownerUid,
                      sessionId: calleeLease.ownerSessionId,
                      joinedAt: toMillis(calleeLease.createdAt),
                      lastSeenAt: toMillis(calleeLease.updatedAt),
                  }
                : null,
        }
    }

    private async claimRole(role: Role, mode: 'takeover' | 'if_free'): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        const roomRef = this.roomRef
        const leaseRef = this.leaseRef(role)
        const participantRef = this.participantRef(role, uid)
        const sessionId = this.ensureActiveSession(role)
        const roleKey: RoleCollection = this.activeRoleCollection(role)

        let claimed = false

        await runTransaction(this.db, async (transaction) => {
            const roomSnap = await transaction.get(roomRef)
            if (!roomSnap.exists()) throw new Error('Room not found')

            const leaseSnap = await transaction.get(leaseRef)
            const previousLease = leaseSnap.exists() ? (leaseSnap.data() as LeaseDoc) : null
            const participantSnap = await transaction.get(participantRef)
            const existingParticipant = participantSnap.exists()
                ? (participantSnap.data() as ParticipantDoc)
                : null

            if (mode === 'if_free' && previousLease && previousLease.ownerUid !== uid) {
                claimed = false
                return
            }

            const nextLeaseVersion = (previousLease?.leaseVersion ?? 0) + 1
            if (previousLease) {
                transaction.update(leaseRef, {
                    role,
                    ownerUid: uid,
                    ownerSessionId: sessionId,
                    leaseVersion: nextLeaseVersion,
                    updatedAt: serverTimestamp(),
                })
            } else {
                transaction.set(leaseRef, {
                    role,
                    ownerUid: uid,
                    ownerSessionId: sessionId,
                    leaseVersion: 1,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                })
            }

            if (existingParticipant) {
                transaction.update(participantRef, {
                    uid,
                    role,
                    sessionId,
                    active: true,
                    updatedAt: serverTimestamp(),
                } as Partial<ParticipantDoc>)
            } else {
                transaction.set(participantRef, {
                    uid,
                    role,
                    sessionId,
                    active: true,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                } as ParticipantDoc)
            }

            if (
                previousLease &&
                (previousLease.ownerUid !== uid || previousLease.ownerSessionId !== sessionId)
            ) {
                const takeoverEventRef = doc(
                    this.eventsCol(),
                ) as DocumentReference<TakeoverEventDoc>
                transaction.set(takeoverEventRef, {
                    type: 'role_taken_over',
                    role,
                    targetUid: previousLease.ownerUid,
                    targetSessionId: previousLease.ownerSessionId,
                    byUid: uid,
                    bySessionId: sessionId,
                    createdAt: serverTimestamp(),
                })
            }

            const roomPatch: Partial<RoomRootDoc> = { updatedAt: serverTimestamp() }
            if (roleKey === CALLERS) {
                roomPatch.callerUid = uid
            } else {
                roomPatch.calleeUid = uid
            }
            transaction.update(roomRef, roomPatch)

            claimed = true
        })

        if (claimed) {
            this.activateRole(role, sessionId)
            return true
        }

        return false
    }

    private async resolveRemoteOwner(
        role: Role,
    ): Promise<{ uid: string; sessionId: string } | null> {
        const lease = await this.getLease(role)
        if (!lease) return null
        return {
            uid: lease.ownerUid,
            sessionId: lease.ownerSessionId,
        }
    }

    private subscribeToRemoteParticipant(
        role: Role,
        onParticipant: (
            participant: ParticipantDoc,
            owner: { uid: string; sessionId: string },
        ) => void,
    ): () => void {
        if (!this.roomRef) return () => {}

        let remoteUnsub: (() => void) | undefined
        let currentOwner: { uid: string; sessionId: string } | null = null

        const stopRemote = () => {
            if (!remoteUnsub) return
            try {
                remoteUnsub()
            } catch {
                // noop
            }
            remoteUnsub = undefined
            currentOwner = null
        }

        const leaseUnsub = onSnapshot(
            this.leaseRef(role),
            (leaseSnapshot) => {
                const lease = leaseSnapshot.exists() ? (leaseSnapshot.data() as LeaseDoc) : null
                this.leaseCache[role] = lease
                const nextOwnerUid = lease?.ownerUid ?? null
                if (!nextOwnerUid || !lease) {
                    stopRemote()
                    return
                }
                const nextOwner = {
                    uid: nextOwnerUid,
                    sessionId: lease.ownerSessionId,
                }
                if (
                    currentOwner?.uid === nextOwner.uid &&
                    currentOwner.sessionId === nextOwner.sessionId &&
                    remoteUnsub
                ) {
                    return
                }
                stopRemote()
                currentOwner = nextOwner

                remoteUnsub = onSnapshot(
                    this.participantRef(role, nextOwner.uid),
                    (participantSnapshot) => {
                        if (!participantSnapshot.exists()) return
                        const participant = participantSnapshot.data() as ParticipantDoc
                        const owner = currentOwner
                        if (!owner) return
                        onParticipant(participant, {
                            uid: owner.uid,
                            sessionId: owner.sessionId,
                        })
                    },
                    (error) => this.reportSecurityError(error),
                )
            },
            (error) => this.reportSecurityError(error),
        )

        const unsubscribe = () => {
            stopRemote()
            leaseUnsub()
        }

        this.trackSubUnsub(unsubscribe)
        return this.wrapSubUnsub(unsubscribe)
    }

    private subscribeToRemoteCandidates(
        role: Role,
        cb: (ice: RTCIceCandidateInit) => void,
    ): () => void {
        if (!this.roomRef) return () => {}

        let candidatesUnsub: (() => void) | undefined
        let currentOwnerUid: string | null = null
        let currentOwnerSessionId: string | null = null
        const seenByDocId = new Map<string, string>()
        const seenSignalKeys = new Set<string>()

        const stopCandidates = () => {
            if (candidatesUnsub) {
                try {
                    candidatesUnsub()
                } catch {
                    // noop
                }
                candidatesUnsub = undefined
            }
            currentOwnerUid = null
            currentOwnerSessionId = null
            seenByDocId.clear()
            seenSignalKeys.clear()
        }

        const leaseUnsub = onSnapshot(
            this.leaseRef(role),
            (leaseSnapshot) => {
                const lease = leaseSnapshot.exists() ? (leaseSnapshot.data() as LeaseDoc) : null
                this.leaseCache[role] = lease
                const nextOwnerUid = lease?.ownerUid ?? null
                const nextOwnerSessionId = lease?.ownerSessionId ?? null
                if (!nextOwnerUid) {
                    stopCandidates()
                    return
                }
                if (
                    currentOwnerUid === nextOwnerUid &&
                    currentOwnerSessionId === nextOwnerSessionId &&
                    candidatesUnsub
                ) {
                    return
                }
                stopCandidates()
                currentOwnerUid = nextOwnerUid
                currentOwnerSessionId = nextOwnerSessionId

                candidatesUnsub = onSnapshot(
                    this.candidateCol(role, nextOwnerUid),
                    (snapshot) => {
                        for (const change of snapshot.docChanges()) {
                            if (change.type === 'removed') {
                                const prevKey = seenByDocId.get(change.doc.id)
                                if (prevKey) seenSignalKeys.delete(prevKey)
                                seenByDocId.delete(change.doc.id)
                                continue
                            }
                            if (change.type !== 'added' && change.type !== 'modified') continue
                            const data = change.doc.data() as CandidateStoredDoc
                            const key = candidateSignalKey(data)
                            if (seenByDocId.get(change.doc.id) === key) continue
                            seenByDocId.set(change.doc.id, key)
                            if (seenSignalKeys.has(key)) continue
                            seenSignalKeys.add(key)
                            cb(data)
                        }
                    },
                    (error) => this.reportSecurityError(error),
                )
            },
            (error) => this.reportSecurityError(error),
        )

        const unsubscribe = () => {
            stopCandidates()
            leaseUnsub()
        }
        this.trackSubUnsub(unsubscribe)
        return this.wrapSubUnsub(unsubscribe)
    }

    private enqueueCandidate(role: Role, payload: CandidateStoredDoc): Promise<void> {
        this.assertWritable(role)
        return new Promise((resolve, reject) => {
            const buffer = this.candidateBuffers[role]
            buffer.queue.push({ payload, resolve, reject })
            if (buffer.timer) return
            buffer.timer = setTimeout(() => {
                void this.flushCandidateBuffer(role)
            }, ICE_BATCH_FLUSH_MS)
        })
    }

    private async flushCandidateBuffer(role: Role): Promise<void> {
        const buffer = this.candidateBuffers[role]
        if (buffer.flushing) return
        const uid = this.uid
        if (!uid || !this.roomRef) {
            while (buffer.queue.length > 0) {
                const item = buffer.queue.shift()
                item?.reject(new Error('Auth required'))
            }
            if (buffer.timer) {
                clearTimeout(buffer.timer)
                buffer.timer = undefined
            }
            return
        }

        buffer.flushing = true
        if (buffer.timer) {
            clearTimeout(buffer.timer)
            buffer.timer = undefined
        }

        const chunk = buffer.queue.splice(0, buffer.queue.length)
        if (chunk.length === 0) {
            buffer.flushing = false
            return
        }

        try {
            const batch = writeBatch(this.db)
            const candidatesCollection = this.candidateCol(role, uid)
            for (const item of chunk) {
                const candidateId = createId('candidate')
                const candidateRef = doc(candidatesCollection, candidateId)
                batch.set(candidateRef, {
                    ...item.payload,
                    createdAt: serverTimestamp(),
                })
            }
            await batch.commit()
            for (const item of chunk) item.resolve()
        } catch (error) {
            const rawMessage =
                error && typeof error === 'object' && 'message' in error
                    ? String((error as { message?: unknown }).message)
                    : String(error)
            const payloadPreview = JSON.stringify(chunk[0]?.payload ?? {})
            const enriched = new Error(
                `candidate batch commit failed role=${role} uid=${uid} payload=${payloadPreview}; cause=${rawMessage}`,
            )
            for (const item of chunk) item.reject(enriched)
        } finally {
            buffer.flushing = false
            if (buffer.queue.length > 0) {
                buffer.timer = setTimeout(() => {
                    void this.flushCandidateBuffer(role)
                }, ICE_BATCH_FLUSH_MS)
            }
        }
    }

    private rejectCandidateBuffer(role: Role, reason: string) {
        const buffer = this.candidateBuffers[role]
        if (buffer.timer) {
            clearTimeout(buffer.timer)
            buffer.timer = undefined
        }
        const error = new Error(reason)
        while (buffer.queue.length > 0) {
            const item = buffer.queue.shift()
            item?.reject(error)
        }
    }

    // ---------------- Rooms ----------------

    async createRoom(): Promise<string> {
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        const roomRef = doc(collection(this.db, ROOMS) as CollectionReference<RoomRootDoc>)
        const roomId = roomRef.id
        const sessionId = this.ensureActiveSession('caller')

        await runTransaction(this.db, async (transaction) => {
            const roomSnapshot = await transaction.get(roomRef)
            if (roomSnapshot.exists()) {
                throw new Error('Room already exists')
            }

            transaction.set(roomRef, {
                creatorUid: uid,
                callerUid: uid,
                calleeUid: null,
                offer: null,
                answer: null,
                epoch: 0,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
            })

            transaction.set(this.leaseRefFromRoom(roomRef, 'caller'), {
                role: 'caller',
                ownerUid: uid,
                ownerSessionId: sessionId,
                leaseVersion: 1,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            } as LeaseDoc)

            transaction.set(this.participantRefFromRoom(roomRef, 'caller', uid), {
                uid,
                role: 'caller',
                sessionId,
                active: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            } as ParticipantDoc)
        })

        this.roomRef = roomRef
        this.roomEpoch = 0
        this.activateRole('caller', sessionId)
        this.startLeaseCacheWatch()

        this.callbacks.onShareLink?.({ roomId, url: this.buildShareUrl(roomId) })
        return roomId
    }

    private leaseRefFromRoom(roomRef: DocumentReference<RoomRootDoc>, role: Role) {
        return doc(roomRef, LEASES, role) as DocumentReference<LeaseDoc>
    }

    private participantRefFromRoom(
        roomRef: DocumentReference<RoomRootDoc>,
        role: Role,
        uid: string,
    ) {
        return doc(
            collection(roomRef, roleCollection(role)) as CollectionReference<ParticipantDoc>,
            uid,
        ) as DocumentReference<ParticipantDoc>
    }

    async joinRoom(id: string, role?: Role): Promise<void> {
        this.roomRef = doc(this.db, ROOMS, id) as DocumentReference<RoomRootDoc>
        this.startLeaseCacheWatch()

        if (!role) {
            const room = await this.getRoom()
            if (!room) throw new Error('Room not found')
            return
        }

        const claimed = await this.claimRole(role, 'takeover')
        if (!claimed) {
            this.callbacks.onRoomOccupied?.({ roomId: id })
            throw new Error('Room occupied')
        }
    }

    async getRoom(): Promise<RoomDoc | null> {
        if (!this.roomRef) throw new Error('Room not selected')
        const roomSnap = await getDoc(this.roomRef)
        if (!roomSnap.exists()) return null

        const data = roomSnap.data() as Partial<RoomRootDoc>
        this.roomEpoch = typeof data.epoch === 'number' ? data.epoch : 0
        const slots = await this.getRoleSlots()

        const room: RoomDoc = {
            creatorUid: typeof data.creatorUid === 'string' ? data.creatorUid : null,
            callerUid: slots?.caller?.participantId ?? null,
            calleeUid: slots?.callee?.participantId ?? null,
            slots,
            offer: null,
            answer: null,
            epoch: this.roomEpoch,
            createdAt: data.createdAt ?? null,
            updatedAt: data.updatedAt ?? null,
            expiresAt: data.expiresAt ?? null,
        }

        const role = this.activeRole
        const uid = this.uid
        if (role && uid) {
            const slot = role === 'caller' ? slots?.caller : slots?.callee
            if (!this.roleSessionByRole[role] && slot && slot.participantId === uid) {
                this.roleSessionByRole[role] = slot.sessionId
            }
        }

        return room
    }

    async claimCallerIfFree(): Promise<boolean> {
        return await this.claimRole('caller', 'if_free')
    }

    async claimCalleeIfFree(): Promise<boolean> {
        return await this.claimRole('callee', 'if_free')
    }

    async heartbeat(role: Role): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        const sessionId = this.roleSessionByRole[role]
        if (!sessionId) return

        await setDoc(
            this.participantRef(role, uid),
            {
                uid,
                role,
                sessionId,
                active: true,
                updatedAt: serverTimestamp(),
            } as Partial<ParticipantDoc>,
            { merge: true },
        )
    }

    async tryTakeOver(role: Role, _staleMs: number): Promise<boolean> {
        return await this.claimRole(role, 'takeover')
    }

    async leaveRoom(role: Role): Promise<void> {
        if (!this.roomRef) return
        const uid = this.uid
        if (!uid) return

        const sessionId = this.roleSessionByRole[role]
        if (!sessionId) return

        try {
            const leaseRef = this.leaseRef(role)
            const leaseSnap = await getDoc(leaseRef)
            const lease = leaseSnap.exists() ? (leaseSnap.data() as LeaseDoc) : null
            const stillOwnsLease =
                lease && lease.ownerUid === uid && lease.ownerSessionId === sessionId
            if (stillOwnsLease) {
                await setDoc(
                    this.participantRef(role, uid),
                    {
                        uid,
                        role,
                        sessionId,
                        active: false,
                        updatedAt: serverTimestamp(),
                    } as Partial<ParticipantDoc>,
                    { merge: true },
                )
                await deleteDoc(leaseRef)
            }
        } catch (error) {
            this.reportSecurityError(error)
        }

        this.roleSessionByRole[role] = null
        this.takeoverDetectedByRole[role] = false
        if (this.activeRole === role) {
            this.activeRole = null
            this.stopTakeoverWatch()
        }
    }

    // ---------------- SDP ----------------

    async getOffer(): Promise<OfferSDP | null> {
        const owner = await this.resolveRemoteOwner('caller')
        if (!owner) return null
        const snap = await getDoc(this.participantRef('caller', owner.uid))
        if (!snap.exists()) return null
        const data = snap.data() as ParticipantDoc
        return (data.offer ?? null) as OfferSDP | null
    }

    async setOffer(offer: OfferSDP): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        this.assertWritable('caller')

        const sessionId = this.ensureActiveSession('caller')
        await setDoc(
            this.participantRef('caller', uid),
            {
                uid,
                role: 'caller',
                sessionId,
                active: true,
                offer: {
                    ...offer,
                    epoch: offer.epoch ?? this.roomEpoch,
                    sessionId: offer.sessionId ?? sessionId,
                },
                updatedAt: serverTimestamp(),
            } as Partial<ParticipantDoc>,
            { merge: true },
        )
    }

    async clearOffer(): Promise<void> {
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        this.assertWritable('caller')

        const sessionId = this.ensureActiveSession('caller')
        await setDoc(
            this.participantRef('caller', uid),
            {
                uid,
                role: 'caller',
                sessionId,
                active: true,
                offer: null,
                updatedAt: serverTimestamp(),
            } as Partial<ParticipantDoc>,
            { merge: true },
        )
    }

    async setAnswer(answer: AnswerSDP): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        this.assertWritable('callee')

        const sessionId = this.ensureActiveSession('callee')
        await setDoc(
            this.participantRef('callee', uid),
            {
                uid,
                role: 'callee',
                sessionId,
                active: true,
                answer: {
                    ...answer,
                    epoch: answer.epoch ?? this.roomEpoch,
                    sessionId: answer.sessionId ?? sessionId,
                },
                updatedAt: serverTimestamp(),
            } as Partial<ParticipantDoc>,
            { merge: true },
        )
    }

    async clearAnswer(): Promise<void> {
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        this.assertWritable('callee')

        const sessionId = this.ensureActiveSession('callee')
        await setDoc(
            this.participantRef('callee', uid),
            {
                uid,
                role: 'callee',
                sessionId,
                active: true,
                answer: null,
                updatedAt: serverTimestamp(),
            } as Partial<ParticipantDoc>,
            { merge: true },
        )
    }

    subscribeOnOffer(cb: (offer: OfferSDP) => void | Promise<void>): () => void {
        let lastKey: string | null = null
        return this.subscribeToRemoteParticipant('caller', (participant, owner) => {
            const offer = participant.offer as OfferSDP | null | undefined
            if (!offer) return
            const key = `${owner.sessionId}|${offer.sdp}|${offer.epoch ?? -1}|${offer.sessionId ?? 'n/a'}|${offer.forSessionId ?? 'n/a'}|${offer.pcGeneration ?? -1}|${offer.forPcGeneration ?? -1}|${offer.gen ?? -1}|${offer.forGen ?? -1}|${offer.icePhase ?? 'n/a'}`
            if (key === lastKey) return
            lastKey = key
            void cb(offer)
        })
    }

    subscribeOnAnswer(cb: (answer: AnswerSDP) => void | Promise<void>): () => void {
        let lastKey: string | null = null
        return this.subscribeToRemoteParticipant('callee', (participant, owner) => {
            const answer = participant.answer as AnswerSDP | null | undefined
            if (!answer) return
            const key = `${owner.sessionId}|${answer.sdp}|${answer.epoch ?? -1}|${answer.sessionId ?? 'n/a'}|${answer.forSessionId ?? 'n/a'}|${answer.pcGeneration ?? -1}|${answer.forPcGeneration ?? -1}|${answer.gen ?? -1}|${answer.forGen ?? -1}|${answer.icePhase ?? 'n/a'}`
            if (key === lastKey) return
            lastKey = key
            void cb(answer)
        })
    }

    // ---------------- ICE ----------------

    async addCallerIceCandidate(ice: RTCIceCandidate | CandidateDoc): Promise<void> {
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        if (!this.roomRef) throw new Error('Room not selected')
        this.assertWritable('caller')

        const normalized = normalizeIceCandidate(ice)
        const candidateValue =
            typeof normalized.candidate === 'string' ? normalized.candidate.trim() : ''
        if (!candidateValue) return

        const sessionId = this.ensureActiveSession('caller')
        await this.enqueueCandidate('caller', {
            ...normalized,
            sessionId: normalized.sessionId ?? sessionId,
            epoch: normalized.epoch ?? this.roomEpoch,
            pcGeneration: normalized.pcGeneration,
            gen: normalized.gen,
            icePhase: normalized.icePhase,
        })
    }

    async addCalleeIceCandidate(ice: RTCIceCandidate | CandidateDoc): Promise<void> {
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        if (!this.roomRef) throw new Error('Room not selected')
        this.assertWritable('callee')

        const normalized = normalizeIceCandidate(ice)
        const candidateValue =
            typeof normalized.candidate === 'string' ? normalized.candidate.trim() : ''
        if (!candidateValue) return

        const sessionId = this.ensureActiveSession('callee')
        await this.enqueueCandidate('callee', {
            ...normalized,
            sessionId: normalized.sessionId ?? sessionId,
            epoch: normalized.epoch ?? this.roomEpoch,
            pcGeneration: normalized.pcGeneration,
            gen: normalized.gen,
            icePhase: normalized.icePhase,
        })
    }

    subscribeOnCallerIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void {
        return this.subscribeToRemoteCandidates('caller', cb)
    }

    subscribeOnCalleeIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void {
        return this.subscribeToRemoteCandidates('callee', cb)
    }

    private async clearOwnCandidates(role: Role): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        const candidatesSnapshot = await getDocs(this.candidateCol(role, uid))
        await Promise.all(
            candidatesSnapshot.docs.map((candidateDoc) => deleteDoc(candidateDoc.ref)),
        )
    }

    async clearCallerCandidates(): Promise<void> {
        await this.clearOwnCandidates('caller')
    }

    async clearCalleeCandidates(): Promise<void> {
        await this.clearOwnCandidates('callee')
    }

    // ---------------- End room ----------------

    private async deleteRoleBranch(role: Role): Promise<void> {
        if (!this.roomRef) return
        const participants = await getDocs(this.participantsCol(role))
        for (const participantDoc of participants.docs) {
            const candidateSnapshot = await getDocs(this.candidateCol(role, participantDoc.id))
            await Promise.all(
                candidateSnapshot.docs.map((candidateDoc) => deleteDoc(candidateDoc.ref)),
            )
            await deleteDoc(participantDoc.ref).catch(() => {})
        }
    }

    async endRoom(): Promise<void> {
        if (!this.roomRef) return
        const roomRef = this.roomRef

        this.rejectCandidateBuffer('caller', 'Room closed')
        this.rejectCandidateBuffer('callee', 'Room closed')
        this.stopTakeoverWatch()
        this.stopLeaseCacheWatch()
        this.flushSubUnsubs()
        this.flushInternalUnsubs()

        await Promise.all([
            this.deleteRoleBranch('caller').catch(() => {}),
            this.deleteRoleBranch('callee').catch(() => {}),
        ])

        const leaseSnapshot = await getDocs(collection(roomRef, LEASES)).catch(() => null)
        if (leaseSnapshot) {
            await Promise.all(
                leaseSnapshot.docs.map((leaseDoc) => deleteDoc(leaseDoc.ref).catch(() => {})),
            )
        }

        await deleteDoc(roomRef).catch(() => {})

        this.roomRef = undefined
        this.roomEpoch = 0
        this.activeRole = null
        this.roleSessionByRole.caller = null
        this.roleSessionByRole.callee = null
        this.takeoverDetectedByRole.caller = false
        this.takeoverDetectedByRole.callee = false
        this.clearRoomCaches()
    }
}
