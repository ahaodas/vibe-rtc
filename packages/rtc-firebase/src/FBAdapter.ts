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
const DEFAULT_TTL_MINUTES = 60
const DEFAULT_MAX_CANDIDATES_PER_SIDE = 81
const DEFAULT_HEARTBEAT_INTERVAL_MS = 3000

export type SecurityMode = 'off' | 'demo_hardened'

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
    maxCandidatesPerSide?: number
    heartbeatIntervalMs?: number
    importTokensFromHash?: boolean
}

const sanitize = <T extends Record<string, any>>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

const createId = (prefix: string): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

const toBase64Url = (bytes: Uint8Array): string => {
    const hasBtoa = typeof btoa === 'function'
    if (hasBtoa) {
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    }
    const withBuffer = globalThis as typeof globalThis & {
        Buffer?: {
            from(input: Uint8Array): { toString(encoding: string): string }
        }
    }
    const encoded = withBuffer.Buffer?.from(bytes).toString('base64') ?? ''
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const randomTokenRaw = (bytesCount = 32): string => {
    const bytes = new Uint8Array(bytesCount)
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes)
        return toBase64Url(bytes)
    }
    return `${createId('token')}-${Math.random().toString(36).slice(2)}`
}

const hashSha256Base64Url = async (value: string): Promise<string> => {
    const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
    if (!subtle) {
        throw new Error('crypto.subtle is required for demo_hardened security mode')
    }
    const encoded = new TextEncoder().encode(value)
    const digest = await subtle.digest('SHA-256', encoded)
    return toBase64Url(new Uint8Array(digest))
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

type RoomDocSecure = RoomDocWithSlots & {
    callerTokenHash?: string | null
    joinTokenHash?: string | null
    calleeTokenHash?: string | null
    activeCallerSessionId?: string | null
    callerTokenProof?: string | null
    offerMeta?: { tokenHash?: string; sessionId?: string } | null
    answerMeta?: { tokenHash?: string; sessionId?: string } | null
}

type CandidateDocSecure = CandidateDoc & { tokenHash?: string; ownerSessionId?: string }

type RoomTokenState = {
    callerRaw?: string
    joinRaw?: string
    callerHash?: string
    joinHash?: string
}

const toIcePhase = (value: unknown): IcePhase | undefined => {
    if (value === 'LAN' || value === 'STUN' || value === 'STUN_ONLY' || value === 'TURN_ENABLED')
        return value
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
    private readonly roleTokenHashByRole: Record<'caller' | 'callee', string | null> = {
        caller: null,
        callee: null,
    }
    private readonly candidateCounterByRole: Record<'caller' | 'callee', number> = {
        caller: 0,
        callee: 0,
    }

    private activeRole: 'caller' | 'callee' | null = null
    private takeoverDetected = false
    private callerHeartbeatTimer?: ReturnType<typeof setInterval>
    private securityRoomWatchUnsub?: () => void
    private readonly tokenStateByRoom = new Map<string, RoomTokenState>()
    private readonly unsubs = new Set<() => void>()

    private readonly securityMode: SecurityMode
    private readonly storage: FBAdapterStorage
    private readonly callbacks: FBAdapterCallbacks
    private readonly ttlMinutes: number
    private readonly maxCandidatesPerSide: number
    private readonly heartbeatIntervalMs: number
    private readonly importTokensFromHash: boolean

    constructor(
        private readonly db: Firestore,
        private readonly auth: Auth,
        options: FBAdapterOptions = {},
    ) {
        this.securityMode = options.securityMode ?? 'off'
        this.storage = options.storage ?? createDefaultStorage()
        this.callbacks = options.callbacks ?? {}
        this.ttlMinutes = Math.max(1, options.ttlMinutes ?? DEFAULT_TTL_MINUTES)
        this.maxCandidatesPerSide = Math.max(
            1,
            options.maxCandidatesPerSide ?? DEFAULT_MAX_CANDIDATES_PER_SIDE,
        )
        this.heartbeatIntervalMs = Math.max(
            1000,
            options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
        )
        this.importTokensFromHash = options.importTokensFromHash ?? false

        if (this.isHardened() && this.importTokensFromHash) {
            this.importTokensFromLocationHash()
        }
    }

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
        if (!this.isHardened()) return this.createRoomLegacy()

        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        const ref = doc(collection(this.db, ROOMS) as any)
        const roomId = ref.id
        const tokens = await this.ensureRoomTokens(roomId, true)
        const callerSessionId = createId('caller-session')

        await setDoc(ref, {
            creatorUid: uid,
            callerUid: uid,
            calleeUid: null,
            callerTokenHash: tokens.callerHash,
            joinTokenHash: tokens.joinHash,
            calleeTokenHash: null,
            activeCallerSessionId: callerSessionId,
            callerTokenProof: tokens.callerHash,
            slots: {
                caller: {
                    participantId: this.participantId,
                    sessionId: callerSessionId,
                    joinedAt: Date.now(),
                    lastSeenAt: Date.now(),
                },
                callee: null,
            },
            offer: null,
            offerMeta: null,
            answer: null,
            answerMeta: null,
            epoch: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
        } as any)

        this.roomRef = ref as DocumentReference<RoomDoc>
        this.callerCol = collection(ref, CALLER_CANDIDATES) as CollectionReference<CandidateDoc>
        this.calleeCol = collection(ref, CALLEE_CANDIDATES) as CollectionReference<CandidateDoc>
        this.roomEpoch = 0
        this.roleSessionByRole.caller = callerSessionId
        this.roleTokenHashByRole.caller = tokens.callerHash
        this.roleSessionByRole.callee = null
        this.roleTokenHashByRole.callee = null
        this.activeRole = 'caller'
        this.takeoverDetected = false
        this.resetCandidateCounters()
        this.setStoredCandidateCounter(roomId, 'caller', 0)
        this.setStoredCandidateCounter(roomId, 'callee', 0)
        this.startSecurityRoomWatch()
        this.startCallerHeartbeat()

        this.callbacks.onShareLink?.({
            roomId,
            url: this.buildShareUrl(roomId, tokens.callerRaw, tokens.joinRaw),
        })

        return roomId
    }

    async joinRoom(id: string, role?: 'caller' | 'callee'): Promise<void> {
        if (!this.isHardened()) {
            await this.joinRoomLegacy(id, role)
            return
        }

        const ref = doc(this.db, ROOMS, id) as DocumentReference<RoomDoc>
        this.roomRef = ref
        this.callerCol = collection(ref, CALLER_CANDIDATES) as CollectionReference<CandidateDoc>
        this.calleeCol = collection(ref, CALLEE_CANDIDATES) as CollectionReference<CandidateDoc>
        const uid = this.uid

        if (!role) {
            const latest = (await getDoc(ref)).data() as RoomDocSecure | undefined
            this.roomEpoch = latest?.epoch ?? 0
            await this.syncCandidateCountersFromServer()
            return
        }
        if (!uid) throw new Error('Auth required')

        if (role === 'caller') {
            const callerHash = await this.requireCallerHash(id)
            const nextSessionId = createId('caller-session')
            const now = Date.now()
            await updateDoc(ref, {
                activeCallerSessionId: nextSessionId,
                callerTokenProof: callerHash,
                callerUid: uid,
                'slots.caller.participantId': this.participantId,
                'slots.caller.sessionId': nextSessionId,
                'slots.caller.joinedAt': now,
                'slots.caller.lastSeenAt': now,
                updatedAt: serverTimestamp(),
            } as any)

            const latest = (await getDoc(ref)).data() as RoomDocSecure | undefined
            this.roomEpoch = latest?.epoch ?? 0
            this.roleSessionByRole.caller = nextSessionId
            this.roleTokenHashByRole.caller = callerHash
            this.activeRole = 'caller'
            this.takeoverDetected = false
            await this.syncCandidateCountersFromServer()
            this.startSecurityRoomWatch()
            this.startCallerHeartbeat()
            return
        }

        const joinHash = await this.requireJoinHash(id)
        let occupied = false
        const nextCalleeSessionId = createId('callee-session')
        const applyCalleeSlotPatch = async () => {
            const now = Date.now()
            await updateDoc(ref, {
                calleeUid: uid,
                'slots.callee.participantId': this.participantId,
                'slots.callee.sessionId': nextCalleeSessionId,
                'slots.callee.joinedAt': now,
                'slots.callee.lastSeenAt': now,
                updatedAt: serverTimestamp(),
            } as any)
        }

        const currentSnap = await getDoc(ref)
        if (!currentSnap.exists()) throw new Error('Room not found')
        const currentData = currentSnap.data() as RoomDocSecure
        if (!this.isRoomActive(currentData)) throw new Error('Room expired')
        const currentCalleeTokenHash =
            typeof currentData.calleeTokenHash === 'string' ? currentData.calleeTokenHash : null

        if (currentCalleeTokenHash === joinHash) {
            await applyCalleeSlotPatch()
        } else if (currentCalleeTokenHash == null) {
            await runTransaction(this.db, async (tx) => {
                const snap = await tx.get(ref)
                if (!snap.exists()) throw new Error('Room not found')
                const data = snap.data() as RoomDocSecure
                if (!this.isRoomActive(data)) throw new Error('Room expired')
                const liveCalleeTokenHash =
                    typeof data.calleeTokenHash === 'string' ? data.calleeTokenHash : null
                const now = Date.now()

                if (liveCalleeTokenHash == null) {
                    tx.update(ref, {
                        calleeTokenHash: joinHash,
                        calleeUid: uid,
                        'slots.callee.participantId': this.participantId,
                        'slots.callee.sessionId': nextCalleeSessionId,
                        'slots.callee.joinedAt': now,
                        'slots.callee.lastSeenAt': now,
                        updatedAt: serverTimestamp(),
                    } as any)
                    return
                }

                if (liveCalleeTokenHash === joinHash) {
                    tx.update(ref, {
                        calleeUid: uid,
                        'slots.callee.participantId': this.participantId,
                        'slots.callee.sessionId': nextCalleeSessionId,
                        'slots.callee.joinedAt': now,
                        'slots.callee.lastSeenAt': now,
                        updatedAt: serverTimestamp(),
                    } as any)
                    return
                }

                occupied = true
            })
        } else {
            occupied = true
        }

        if (occupied) {
            this.callbacks.onRoomOccupied?.({ roomId: id })
            throw new Error('Room occupied')
        }

        const latest = (await getDoc(ref)).data() as RoomDocSecure | undefined
        this.roomEpoch = latest?.epoch ?? 0
        this.roleSessionByRole.callee =
            this.getRoleSlotSessionId(latest, 'callee') ?? nextCalleeSessionId
        this.roleTokenHashByRole.callee = joinHash
        this.activeRole = 'callee'
        this.takeoverDetected = false
        await this.syncCandidateCountersFromServer()
        this.stopCallerHeartbeat()
        this.startSecurityRoomWatch()
    }

    async getRoom(): Promise<RoomDoc | null> {
        if (!this.roomRef) throw new Error('Room not selected')
        const snap: DocumentSnapshot<RoomDoc> = await getDoc(this.roomRef)
        const room = snap.exists() ? (snap.data() as RoomDocSecure) : null
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
            if (this.isHardened() && this.activeRole === 'caller') {
                const current = this.roleSessionByRole.caller
                const activeSession =
                    typeof room.activeCallerSessionId === 'string'
                        ? room.activeCallerSessionId
                        : null
                const callerSlotSession = this.getRoleSlotSessionId(room, 'caller')
                if (current && activeSession && activeSession !== current) {
                    this.handleTakenOver(activeSession)
                } else if (current && callerSlotSession && callerSlotSession !== current) {
                    this.handleTakenOver(callerSlotSession)
                }
            }
        }
        return room
    }

    async claimCallerIfFree(): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        if (!this.isHardened()) {
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

        const roomId = this.roomRef.id
        const callerHash = await this.requireCallerHash(roomId)
        const nextSessionId = createId('caller-session')
        const now = Date.now()
        let claimed = false
        try {
            await updateDoc(this.roomRef, {
                activeCallerSessionId: nextSessionId,
                callerTokenProof: callerHash,
                callerUid: uid,
                'slots.caller.participantId': this.participantId,
                'slots.caller.sessionId': nextSessionId,
                'slots.caller.joinedAt': now,
                'slots.caller.lastSeenAt': now,
                updatedAt: serverTimestamp(),
            } as any)
            claimed = true
        } catch (err) {
            if (this.isPermissionDeniedError(err)) claimed = false
            else throw err
        }

        if (claimed) {
            this.roleSessionByRole.caller = nextSessionId
            this.roleTokenHashByRole.caller = callerHash
            this.activeRole = 'caller'
            this.takeoverDetected = false
            await this.syncCandidateCountersFromServer()
            this.startSecurityRoomWatch()
            this.startCallerHeartbeat()
        }
        return claimed
    }

    async claimCalleeIfFree(): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        if (!this.isHardened()) {
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

        const roomId = this.roomRef.id
        const joinHash = await this.requireJoinHash(roomId)
        let claimed = false
        const nextSessionId = createId('callee-session')
        const applyCalleeSlotPatch = async () => {
            const now = Date.now()
            await updateDoc(this.roomRef!, {
                calleeUid: uid,
                'slots.callee.participantId': this.participantId,
                'slots.callee.sessionId': nextSessionId,
                'slots.callee.joinedAt': now,
                'slots.callee.lastSeenAt': now,
                updatedAt: serverTimestamp(),
            } as any)
        }

        const currentSnap = await getDoc(this.roomRef)
        if (currentSnap.exists()) {
            const currentData = currentSnap.data() as RoomDocSecure
            if (this.isRoomActive(currentData)) {
                const currentToken =
                    typeof currentData.calleeTokenHash === 'string'
                        ? currentData.calleeTokenHash
                        : null

                if (currentToken === joinHash) {
                    try {
                        await applyCalleeSlotPatch()
                        claimed = true
                    } catch (err) {
                        if (this.isPermissionDeniedError(err)) claimed = false
                        else throw err
                    }
                } else if (currentToken == null) {
                    await runTransaction(this.db, async (tx) => {
                        const snap = await tx.get(this.roomRef!)
                        if (!snap.exists()) return
                        const data = snap.data() as RoomDocSecure
                        if (!this.isRoomActive(data)) return
                        const liveToken =
                            typeof data.calleeTokenHash === 'string' ? data.calleeTokenHash : null
                        const now = Date.now()
                        if (liveToken == null) {
                            tx.update(this.roomRef!, {
                                calleeTokenHash: joinHash,
                                calleeUid: uid,
                                'slots.callee.participantId': this.participantId,
                                'slots.callee.sessionId': nextSessionId,
                                'slots.callee.joinedAt': now,
                                'slots.callee.lastSeenAt': now,
                                updatedAt: serverTimestamp(),
                            } as any)
                            claimed = true
                            return
                        }
                        if (liveToken === joinHash) {
                            tx.update(this.roomRef!, {
                                calleeUid: uid,
                                'slots.callee.participantId': this.participantId,
                                'slots.callee.sessionId': nextSessionId,
                                'slots.callee.joinedAt': now,
                                'slots.callee.lastSeenAt': now,
                                updatedAt: serverTimestamp(),
                            } as any)
                            claimed = true
                        }
                    })
                }
            }
        }

        if (claimed) {
            this.roleTokenHashByRole.callee = joinHash
            this.roleSessionByRole.callee = nextSessionId
            this.activeRole = 'callee'
            this.takeoverDetected = false
            await this.syncCandidateCountersFromServer()
            this.stopCallerHeartbeat()
            this.startSecurityRoomWatch()
            return true
        }

        this.callbacks.onRoomOccupied?.({ roomId })
        return false
    }

    async heartbeat(role: 'caller' | 'callee'): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')

        if (!this.isHardened()) {
            const field = role === 'caller' ? 'callerHeartbeatAt' : 'calleeHeartbeatAt'
            await updateDoc(this.roomRef, {
                [field]: serverTimestamp(),
                [`slots.${role}.lastSeenAt`]: Date.now(),
                updatedAt: serverTimestamp(),
            } as any)
            return
        }

        if (role === 'caller') {
            await this.callerHeartbeatOnce()
        }
    }

    async tryTakeOver(role: 'caller' | 'callee', staleMs: number): Promise<boolean> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        if (!this.isHardened()) {
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

        if (role === 'caller') {
            return await this.claimCallerIfFree()
        }
        return await this.claimCalleeIfFree()
    }

    // ---------------- SDP ------------------

    async getOffer(): Promise<OfferSDP | null> {
        if (!this.roomRef) throw new Error('Room not selected')
        const snap = await getDoc(this.roomRef)
        return (snap.data()?.offer ?? null) as OfferSDP | null
    }

    async setOffer(offer: OfferSDP): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')

        if (!this.isHardened()) {
            await setDoc(
                this.roomRef,
                {
                    offer: { ...offer, epoch: this.roomEpoch },
                    updatedAt: serverTimestamp(),
                },
                { merge: true },
            )
            return
        }

        this.ensureCallerWritable()
        const roomId = this.roomRef.id
        const callerHash = await this.requireCallerHash(roomId)
        const callerSessionId = this.roleSessionByRole.caller ?? createId('caller-session')
        this.roleSessionByRole.caller = callerSessionId

        await setDoc(
            this.roomRef,
            {
                offer: { ...offer, epoch: this.roomEpoch },
                offerMeta: { tokenHash: callerHash, sessionId: callerSessionId },
                callerTokenProof: callerHash,
                activeCallerSessionId: callerSessionId,
                updatedAt: serverTimestamp(),
            } as any,
            { merge: true },
        )
    }

    async clearOffer(): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        if (!this.isHardened()) {
            await updateDoc(this.roomRef, { offer: null, updatedAt: serverTimestamp() })
            return
        }

        this.ensureCallerWritable()
        const roomId = this.roomRef.id
        const callerHash = await this.requireCallerHash(roomId)
        const callerSessionId = this.roleSessionByRole.caller ?? createId('caller-session')
        this.roleSessionByRole.caller = callerSessionId

        await updateDoc(this.roomRef, {
            offer: null,
            offerMeta: { tokenHash: callerHash, sessionId: callerSessionId },
            callerTokenProof: callerHash,
            activeCallerSessionId: callerSessionId,
            updatedAt: serverTimestamp(),
        } as any)
    }

    async setAnswer(answer: AnswerSDP): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        const uid = this.uid
        if (!uid) throw new Error('Auth required')

        if (!this.isHardened()) {
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
            return
        }

        this.ensureCalleeWritable()
        const roomId = this.roomRef.id
        const calleeHash = await this.requireJoinHash(roomId)
        const calleeSessionId = this.roleSessionByRole.callee ?? createId('callee-session')
        this.roleSessionByRole.callee = calleeSessionId

        await setDoc(
            this.roomRef,
            {
                answer: { ...answer, epoch: this.roomEpoch },
                answerMeta: { tokenHash: calleeHash, sessionId: calleeSessionId },
                updatedAt: serverTimestamp(),
            } as any,
            { merge: true },
        )
    }

    async clearAnswer(): Promise<void> {
        if (!this.roomRef) throw new Error('Room not selected')
        if (!this.isHardened()) {
            await updateDoc(this.roomRef, { answer: null, updatedAt: serverTimestamp() })
            return
        }

        this.ensureCalleeWritable()
        const roomId = this.roomRef.id
        const calleeHash = await this.requireJoinHash(roomId)
        const calleeSessionId = this.roleSessionByRole.callee ?? createId('callee-session')
        this.roleSessionByRole.callee = calleeSessionId

        await updateDoc(this.roomRef, {
            answer: null,
            answerMeta: { tokenHash: calleeHash, sessionId: calleeSessionId },
            updatedAt: serverTimestamp(),
        } as any)
    }

    subscribeOnOffer(cb: (offer: OfferSDP) => void | Promise<void>): () => void {
        if (!this.roomRef) return () => {}
        const unsub = onSnapshot(
            this.roomRef,
            async (snap) => {
                if (snap.metadata.hasPendingWrites) return
                const data = snap.data()
                if (data?.epoch !== undefined) this.roomEpoch = data.epoch
                if (data?.offer) await cb(data.offer as OfferSDP)
            },
            (err) => this.reportSecurityError(err),
        )
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    subscribeOnAnswer(cb: (answer: AnswerSDP) => void | Promise<void>): () => void {
        if (!this.roomRef) return () => {}
        const unsub = onSnapshot(
            this.roomRef,
            async (snap) => {
                if (snap.metadata.hasPendingWrites) return
                const data = snap.data()
                if (data?.epoch !== undefined) this.roomEpoch = data.epoch
                if (data?.answer) await cb(data.answer as AnswerSDP)
            },
            (err) => this.reportSecurityError(err),
        )
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    // ------------- ICE -------------

    async addCallerIceCandidate(ice: RTCIceCandidate | CandidateDoc): Promise<void> {
        if (!this.callerCol) throw new Error('Room not selected')
        await this.addIceCandidateWithSecurity('caller', this.callerCol, ice)
    }

    async addCalleeIceCandidate(ice: RTCIceCandidate | CandidateDoc): Promise<void> {
        if (!this.calleeCol) throw new Error('Room not selected')
        await this.addIceCandidateWithSecurity('callee', this.calleeCol, ice)
    }

    subscribeOnCallerIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void {
        if (!this.callerCol) return () => {}
        const seenByDocId = new Map<string, string>()
        const seenSignalKeys = new Set<string>()
        const unsub = onSnapshot(
            this.callerCol,
            (snap) => {
                snap.docChanges().forEach((ch) => {
                    if (ch.type === 'removed') {
                        const prevKey = seenByDocId.get(ch.doc.id)
                        if (prevKey) seenSignalKeys.delete(prevKey)
                        seenByDocId.delete(ch.doc.id)
                        return
                    }
                    if (ch.type !== 'added' && ch.type !== 'modified') return
                    const data = ch.doc.data()
                    const key = candidateSignalKey(data)
                    if (seenByDocId.get(ch.doc.id) === key) return
                    seenByDocId.set(ch.doc.id, key)
                    if (seenSignalKeys.has(key)) return
                    seenSignalKeys.add(key)
                    cb(data)
                })
            },
            (err) => this.reportSecurityError(err),
        )
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    subscribeOnCalleeIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void {
        if (!this.calleeCol) return () => {}
        const seenByDocId = new Map<string, string>()
        const seenSignalKeys = new Set<string>()
        const unsub = onSnapshot(
            this.calleeCol,
            (snap) => {
                snap.docChanges().forEach((ch) => {
                    if (ch.type === 'removed') {
                        const prevKey = seenByDocId.get(ch.doc.id)
                        if (prevKey) seenSignalKeys.delete(prevKey)
                        seenByDocId.delete(ch.doc.id)
                        return
                    }
                    if (ch.type !== 'added' && ch.type !== 'modified') return
                    const data = ch.doc.data()
                    const key = candidateSignalKey(data)
                    if (seenByDocId.get(ch.doc.id) === key) return
                    seenByDocId.set(ch.doc.id, key)
                    if (seenSignalKeys.has(key)) return
                    seenSignalKeys.add(key)
                    cb(data)
                })
            },
            (err) => this.reportSecurityError(err),
        )
        this.trackUnsub(unsub)
        return this.wrapUnsub(unsub)
    }

    async clearCallerCandidates(): Promise<void> {
        if (!this.callerCol) throw new Error('Room not selected')
        if (this.isHardened()) {
            this.candidateCounterByRole.caller = 0
            if (this.roomRef) this.setStoredCandidateCounter(this.roomRef.id, 'caller', 0)
            return
        }
        const qs = await getDocs(this.callerCol)
        await Promise.all(qs.docs.map((d) => deleteDoc(d.ref)))
    }

    async clearCalleeCandidates(): Promise<void> {
        if (!this.calleeCol) throw new Error('Room not selected')
        if (this.isHardened()) {
            this.candidateCounterByRole.callee = 0
            if (this.roomRef) this.setStoredCandidateCounter(this.roomRef.id, 'callee', 0)
            return
        }
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
        if (this.isHardened()) {
            if (role === 'caller') this.stopCallerHeartbeat()
            this.roleSessionByRole[role] = null
            this.roleTokenHashByRole[role] = null
            if (this.activeRole === role) this.activeRole = null
            return
        }

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
        const roomId = this.roomRef.id
        this.flushUnsubs()
        this.stopCallerHeartbeat()
        this.stopSecurityRoomWatch()

        if (!this.isHardened()) {
            if (this.callerCol) {
                const c = await getDocs(this.callerCol)
                await Promise.all(c.docs.map((d) => deleteDoc(d.ref)))
            }
            if (this.calleeCol) {
                const c = await getDocs(this.calleeCol)
                await Promise.all(c.docs.map((d) => deleteDoc(d.ref)))
            }
            await deleteDoc(this.roomRef).catch(() => {})
        } else {
            const callerHash = await this.ensureCallerHash(roomId)
            if (callerHash) {
                await updateDoc(this.roomRef, {
                    callerTokenProof: callerHash,
                    updatedAt: serverTimestamp(),
                } as any).catch(() => {})
            }
            await deleteDoc(this.roomRef).catch(() => {})
        }

        this.roomRef = undefined
        this.callerCol = undefined
        this.calleeCol = undefined
        this.roomEpoch = 0
        this.activeRole = null
        this.takeoverDetected = false
        this.roleSessionByRole.caller = null
        this.roleSessionByRole.callee = null
        this.roleTokenHashByRole.caller = null
        this.roleTokenHashByRole.callee = null
        this.resetCandidateCounters()
        this.clearStoredCandidateCounters(roomId)
    }

    // ------------- utils ---------------------------

    private isHardened(): boolean {
        return this.securityMode === 'demo_hardened'
    }

    private getRoleSlotSessionId(
        room: RoomDocSecure | null | undefined,
        role: 'caller' | 'callee',
    ): string | null {
        const slot = role === 'caller' ? room?.slots?.caller : room?.slots?.callee
        if (!slot || typeof slot.sessionId !== 'string') return null
        const trimmed = slot.sessionId.trim()
        return trimmed.length > 0 ? trimmed : null
    }

    private ensureCallerWritable() {
        if (this.takeoverDetected) {
            throw new Error('Caller session was taken over by another tab/device')
        }
    }

    private ensureCalleeWritable() {
        if (this.takeoverDetected) {
            throw new Error('Callee session was taken over by another tab/device')
        }
    }

    private isPermissionDeniedError(err: unknown): boolean {
        if (!err || typeof err !== 'object') return false
        const maybeCode = (err as { code?: unknown }).code
        if (typeof maybeCode !== 'string') return false
        const code = maybeCode.toLowerCase()
        return code === 'permission-denied' || code === 'permission_denied'
    }

    private async addIceCandidateWithSecurity(
        role: 'caller' | 'callee',
        col: CollectionReference<CandidateDoc>,
        ice: RTCIceCandidate | CandidateDoc,
    ): Promise<void> {
        const json = normalizeIceCandidate(ice as IceCandidateInput)
        const candidateValue = typeof json.candidate === 'string' ? json.candidate.trim() : ''
        if (!candidateValue) return

        if (!this.isHardened()) {
            const ref = doc(col, candidateDocId(json))
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
            return
        }

        if (role === 'caller') this.ensureCallerWritable()
        if (role === 'callee') this.ensureCalleeWritable()
        const tokenHash = await this.requireRoleTokenHash(role)
        const ownerSessionId = this.roleSessionByRole[role] ?? createId(`${role}-session`)
        this.roleSessionByRole[role] = ownerSessionId
        const withProof: CandidateDocSecure = {
            ...json,
            epoch: json.epoch ?? this.roomEpoch,
            pcGeneration: json.pcGeneration,
            sessionId: json.sessionId ?? this.roleSessionByRole[role] ?? undefined,
            ownerSessionId,
            tokenHash,
            createdAt: serverTimestamp(),
        }
        let didResyncAfterDenied = false
        while (true) {
            const boundedId = this.nextBoundedCandidateId(role)
            if (!boundedId) return
            const ref = doc(col, boundedId)
            try {
                await setDoc(ref, withProof as any)
                return
            } catch (err) {
                if (this.isPermissionDeniedError(err)) {
                    if (!didResyncAfterDenied) {
                        didResyncAfterDenied = true
                        await this.syncCandidateCountersFromServer()
                    }
                    continue
                }
                throw err
            }
        }
    }

    private nextBoundedCandidateId(role: 'caller' | 'callee'): string | null {
        const current = this.candidateCounterByRole[role]
        if (current >= this.maxCandidatesPerSide) return null
        this.candidateCounterByRole[role] = current + 1
        const roomId = this.roomRef?.id
        if (roomId) this.setStoredCandidateCounter(roomId, role, this.candidateCounterByRole[role])
        return `${role}-${current}`
    }

    private resetCandidateCounters() {
        this.candidateCounterByRole.caller = 0
        this.candidateCounterByRole.callee = 0
    }

    private parseCandidateIndex(role: 'caller' | 'callee', id: string): number | null {
        const match = id.match(new RegExp(`^${role}-(\\d+)$`))
        if (!match?.[1]) return null
        const parsed = Number.parseInt(match[1], 10)
        if (!Number.isFinite(parsed) || parsed < 0) return null
        return parsed
    }

    private deriveNextCandidateIndex(role: 'caller' | 'callee', ids: string[]): number {
        let maxIndex = -1
        for (const id of ids) {
            const parsed = this.parseCandidateIndex(role, id)
            if (parsed == null) continue
            if (parsed > maxIndex) maxIndex = parsed
        }
        const nextIndex = maxIndex + 1
        if (nextIndex >= this.maxCandidatesPerSide) return this.maxCandidatesPerSide
        return nextIndex
    }

    private async syncCandidateCountersFromServer(): Promise<void> {
        if (!this.isHardened()) {
            this.resetCandidateCounters()
            return
        }
        if (!this.callerCol || !this.calleeCol) {
            this.resetCandidateCounters()
            return
        }
        try {
            const [callerSnap, calleeSnap] = await Promise.all([
                getDocs(this.callerCol),
                getDocs(this.calleeCol),
            ])
            this.candidateCounterByRole.caller = this.deriveNextCandidateIndex(
                'caller',
                callerSnap.docs.map((candidateDoc) => candidateDoc.id),
            )
            this.candidateCounterByRole.callee = this.deriveNextCandidateIndex(
                'callee',
                calleeSnap.docs.map((candidateDoc) => candidateDoc.id),
            )
            const roomId = this.roomRef?.id
            if (roomId) {
                this.setStoredCandidateCounter(roomId, 'caller', this.candidateCounterByRole.caller)
                this.setStoredCandidateCounter(roomId, 'callee', this.candidateCounterByRole.callee)
            }
        } catch (err) {
            this.reportSecurityError(err)
            this.resetCandidateCounters()
        }
    }

    private storageKey(roomId: string, kind: 'caller' | 'join'): string {
        return `vibe-rtc:security:${roomId}:${kind}:tokenRaw`
    }

    private candidateCounterStorageKey(roomId: string, role: 'caller' | 'callee'): string {
        return `vibe-rtc:security:${roomId}:${role}:candidateIndex`
    }

    private getStoredCandidateCounter(roomId: string, role: 'caller' | 'callee'): number {
        const raw = this.storage.get(this.candidateCounterStorageKey(roomId, role))
        if (!raw) return 0
        const parsed = Number.parseInt(raw, 10)
        if (!Number.isFinite(parsed) || parsed < 0) return 0
        if (parsed > this.maxCandidatesPerSide) return this.maxCandidatesPerSide
        return parsed
    }

    private setStoredCandidateCounter(roomId: string, role: 'caller' | 'callee', value: number) {
        const safe = Math.max(0, Math.min(this.maxCandidatesPerSide, value))
        try {
            this.storage.set(this.candidateCounterStorageKey(roomId, role), String(safe))
        } catch (err) {
            this.reportSecurityError(err)
        }
    }

    private hydrateCandidateCountersFromStorage(roomId: string) {
        this.candidateCounterByRole.caller = this.getStoredCandidateCounter(roomId, 'caller')
        this.candidateCounterByRole.callee = this.getStoredCandidateCounter(roomId, 'callee')
    }

    private clearStoredCandidateCounters(roomId: string) {
        try {
            this.storage.remove(this.candidateCounterStorageKey(roomId, 'caller'))
            this.storage.remove(this.candidateCounterStorageKey(roomId, 'callee'))
        } catch (err) {
            this.reportSecurityError(err)
        }
    }

    private getRoomTokenState(roomId: string): RoomTokenState {
        let state = this.tokenStateByRoom.get(roomId)
        if (!state) {
            state = {}
            this.tokenStateByRoom.set(roomId, state)
        }
        return state
    }

    private setRawToken(roomId: string, kind: 'caller' | 'join', raw: string) {
        const state = this.getRoomTokenState(roomId)
        if (kind === 'caller') {
            state.callerRaw = raw
            state.callerHash = undefined
        } else {
            state.joinRaw = raw
            state.joinHash = undefined
        }
        try {
            this.storage.set(this.storageKey(roomId, kind), raw)
        } catch (err) {
            this.reportSecurityError(err)
        }
    }

    private getRawToken(roomId: string, kind: 'caller' | 'join'): string | null {
        const state = this.getRoomTokenState(roomId)
        const cached = kind === 'caller' ? state.callerRaw : state.joinRaw
        if (cached) return cached
        const stored = this.storage.get(this.storageKey(roomId, kind))
        if (stored) {
            if (kind === 'caller') state.callerRaw = stored
            else state.joinRaw = stored
            return stored
        }
        return null
    }

    private async ensureRoomTokens(
        roomId: string,
        generateIfMissing: boolean,
    ): Promise<{ callerRaw: string; joinRaw: string; callerHash: string; joinHash: string }> {
        const state = this.getRoomTokenState(roomId)

        if (!state.callerRaw) state.callerRaw = this.getRawToken(roomId, 'caller') ?? undefined
        if (!state.joinRaw) state.joinRaw = this.getRawToken(roomId, 'join') ?? undefined

        if (generateIfMissing) {
            if (!state.callerRaw) this.setRawToken(roomId, 'caller', randomTokenRaw())
            if (!state.joinRaw) this.setRawToken(roomId, 'join', randomTokenRaw())
        }

        if (!state.callerRaw || !state.joinRaw) {
            throw new Error(`Missing room tokens for room ${roomId}`)
        }

        if (!state.callerHash) state.callerHash = await hashSha256Base64Url(state.callerRaw)
        if (!state.joinHash) state.joinHash = await hashSha256Base64Url(state.joinRaw)

        return {
            callerRaw: state.callerRaw,
            joinRaw: state.joinRaw,
            callerHash: state.callerHash,
            joinHash: state.joinHash,
        }
    }

    private async ensureCallerHash(roomId: string): Promise<string | null> {
        const state = this.getRoomTokenState(roomId)
        if (!state.callerRaw) state.callerRaw = this.getRawToken(roomId, 'caller') ?? undefined
        if (!state.callerRaw) return null
        if (!state.callerHash) state.callerHash = await hashSha256Base64Url(state.callerRaw)
        return state.callerHash
    }

    private async ensureJoinHash(roomId: string): Promise<string | null> {
        const state = this.getRoomTokenState(roomId)
        if (!state.joinRaw) state.joinRaw = this.getRawToken(roomId, 'join') ?? undefined
        if (!state.joinRaw) return null
        if (!state.joinHash) state.joinHash = await hashSha256Base64Url(state.joinRaw)
        return state.joinHash
    }

    private async requireCallerHash(roomId: string): Promise<string> {
        const hash = await this.ensureCallerHash(roomId)
        if (!hash) {
            const err = new Error(`Caller token missing for room ${roomId}`)
            this.reportSecurityError(err)
            throw err
        }
        return hash
    }

    private async requireJoinHash(roomId: string): Promise<string> {
        const hash = await this.ensureJoinHash(roomId)
        if (!hash) {
            const err = new Error(`Join token missing for room ${roomId}`)
            this.reportSecurityError(err)
            throw err
        }
        return hash
    }

    private async requireRoleTokenHash(role: 'caller' | 'callee'): Promise<string> {
        if (!this.roomRef) throw new Error('Room not selected')
        const roomId = this.roomRef.id
        if (role === 'caller') {
            const hash = await this.requireCallerHash(roomId)
            this.roleTokenHashByRole.caller = hash
            return hash
        }
        const hash = await this.requireJoinHash(roomId)
        this.roleTokenHashByRole.callee = hash
        return hash
    }

    private buildShareUrl(roomId: string, callerTokenRaw: string, joinTokenRaw: string): string {
        if (typeof window === 'undefined') {
            return `#room=${encodeURIComponent(roomId)}&caller=${encodeURIComponent(callerTokenRaw)}&join=${encodeURIComponent(joinTokenRaw)}`
        }
        const base = `${window.location.origin}${window.location.pathname}${window.location.search}`
        const hashPath = `/attach/callee/${encodeURIComponent(roomId)}`
        const query = `caller=${encodeURIComponent(callerTokenRaw)}&join=${encodeURIComponent(joinTokenRaw)}`
        return `${base}#${hashPath}?${query}`
    }

    private importTokensFromLocationHash() {
        if (typeof window === 'undefined') return
        const rawHash = window.location.hash.replace(/^#/, '')
        if (!rawHash) return

        const splitIndex = rawHash.indexOf('?')
        const hashPath = splitIndex >= 0 ? rawHash.slice(0, splitIndex) : rawHash
        const hashQuery = splitIndex >= 0 ? rawHash.slice(splitIndex + 1) : ''
        const queryLike = hashQuery || rawHash
        const params = new URLSearchParams(queryLike)

        const roomFromParam = params.get('room')
        const roomFromPath = (() => {
            const match = hashPath.match(/\/attach\/(?:caller|callee)\/([^/?]+)/)
            return match?.[1] ? decodeURIComponent(match[1]) : null
        })()
        const roomId = roomFromParam || roomFromPath
        if (!roomId) return

        const callerRaw = params.get('caller')
        const joinRaw = params.get('join')
        if (!callerRaw && !joinRaw) return

        if (callerRaw) this.setRawToken(roomId, 'caller', callerRaw)
        if (joinRaw) this.setRawToken(roomId, 'join', joinRaw)

        params.delete('caller')
        params.delete('join')
        params.delete('room')

        const cleanHashQuery = params.toString()
        const cleanHash = hashQuery
            ? `${hashPath}${cleanHashQuery ? `?${cleanHashQuery}` : ''}`
            : cleanHashQuery

        const nextUrl = `${window.location.pathname}${window.location.search}${cleanHash ? `#${cleanHash}` : ''}`
        history.replaceState(null, '', nextUrl)
    }

    private isRoomActive(room: RoomDocSecure | null | undefined): boolean {
        const expires = room?.expiresAt as any
        if (!expires) return true
        const expiresMs =
            typeof expires?.toMillis === 'function'
                ? expires.toMillis()
                : expires instanceof Date
                  ? expires.getTime()
                  : Number.NaN
        if (!Number.isFinite(expiresMs)) return true
        return expiresMs > Date.now()
    }

    private startCallerHeartbeat() {
        if (!this.isHardened()) return
        if (this.activeRole !== 'caller') return
        this.stopCallerHeartbeat()
        void this.callerHeartbeatOnce()
        this.callerHeartbeatTimer = setInterval(() => {
            void this.callerHeartbeatOnce()
        }, this.heartbeatIntervalMs)
    }

    private stopCallerHeartbeat() {
        if (this.callerHeartbeatTimer) {
            clearInterval(this.callerHeartbeatTimer)
            this.callerHeartbeatTimer = undefined
        }
    }

    private async callerHeartbeatOnce() {
        if (!this.isHardened()) return
        if (!this.roomRef || this.takeoverDetected) return
        const roomId = this.roomRef.id
        const callerHash = await this.ensureCallerHash(roomId)
        const callerSessionId = this.roleSessionByRole.caller
        if (!callerHash || !callerSessionId) return

        try {
            await updateDoc(this.roomRef, {
                activeCallerSessionId: callerSessionId,
                callerTokenProof: callerHash,
                'slots.caller.lastSeenAt': Date.now(),
                updatedAt: serverTimestamp(),
            } as any)
        } catch (err) {
            this.reportSecurityError(err)
        }
    }

    private startSecurityRoomWatch() {
        if (!this.isHardened()) return
        if (!this.roomRef) return
        this.stopSecurityRoomWatch()

        const unsub = onSnapshot(
            this.roomRef,
            (snap) => {
                if (!snap.exists()) return
                const room = snap.data() as RoomDocSecure
                if (!this.isRoomActive(room)) return
                if (this.activeRole === 'caller') {
                    const ownSessionId = this.roleSessionByRole.caller
                    const activeSessionId =
                        typeof room.activeCallerSessionId === 'string'
                            ? room.activeCallerSessionId
                            : this.getRoleSlotSessionId(room, 'caller')
                    if (!ownSessionId || !activeSessionId) return
                    if (ownSessionId !== activeSessionId) {
                        this.handleTakenOver(activeSessionId)
                    }
                }
            },
            (err) => this.reportSecurityError(err),
        )
        this.securityRoomWatchUnsub = unsub
    }

    private stopSecurityRoomWatch() {
        if (this.securityRoomWatchUnsub) {
            this.securityRoomWatchUnsub()
            this.securityRoomWatchUnsub = undefined
        }
    }

    private handleTakenOver(bySessionId?: string) {
        if (this.takeoverDetected) return
        this.takeoverDetected = true
        this.stopCallerHeartbeat()
        const roomId = this.roomRef?.id ?? ''
        this.callbacks.onTakenOver?.({ roomId, bySessionId })
        this.flushUnsubs()
        this.stopSecurityRoomWatch()
    }

    private reportSecurityError(err: unknown) {
        this.callbacks.onSecurityError?.(err)
    }

    private async createRoomLegacy(): Promise<string> {
        const uid = this.uid
        if (!uid) throw new Error('Auth required')
        const sessionId = createId('session')
        const now = Date.now()

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
            expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
        })

        this.roomRef = ref as DocumentReference<RoomDoc>
        this.callerCol = collection(ref, CALLER_CANDIDATES) as CollectionReference<CandidateDoc>
        this.calleeCol = collection(ref, CALLEE_CANDIDATES) as CollectionReference<CandidateDoc>
        this.roomEpoch = 0
        this.roleSessionByRole.caller = sessionId
        this.roleSessionByRole.callee = null
        this.resetCandidateCounters()
        return ref.id
    }

    private async joinRoomLegacy(id: string, role?: 'caller' | 'callee'): Promise<void> {
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
                        expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
                    } as Partial<RoomDoc>,
                    { merge: true },
                )
            }
            const latest = (await getDoc(ref)).data() as RoomDocWithSlots | undefined
            this.roomEpoch = latest?.epoch ?? 0
            this.resetCandidateCounters()
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
                      expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
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
        this.resetCandidateCounters()
    }

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
