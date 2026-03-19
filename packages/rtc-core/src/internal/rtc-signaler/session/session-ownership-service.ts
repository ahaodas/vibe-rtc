import { type RTCError, RTCErrorCode } from '../../../errors'
import type { RoomDoc, SignalDB } from '../../../types'
import { isTakeoverWriteError } from '../signaling/session-utils'
import { createStaleSessionLogKey } from '../signaling/signal-keys'
import { getRoleSlotFromRoom, getRoleSlotSessionIdFromRoom } from './room-slots'
import { resolveConfirmedSlotOwnershipMismatch } from './slot-activity'

type Role = 'caller' | 'callee'

type RoleSlot =
    | {
          participantId: string
          sessionId: string
          joinedAt: number
          lastSeenAt: number
      }
    | null
    | undefined

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
}

export interface SessionOwnershipServiceDeps {
    signalDb: SignalDB & {
        getParticipantId?: () => string | null
        getRoleSessionId?: (role: Role) => string | null
    }
    role: Role
    getParticipantId: () => string | null
    setParticipantId: (participantId: string) => void
    getSessionId: () => string | null
    setSessionId: (sessionId: string) => void
    getPhase: () => 'idle' | 'closing' | string
    getRoomId: () => string | null
    dbg: SignalerDebugger
    emitDebug: (lastEvent?: string) => void
    onError: (error: RTCError) => void
    raiseError: (
        err: unknown,
        fallbackCode: RTCErrorCode,
        phase: 'lifecycle',
        retriable: boolean,
        message?: string,
        rethrow?: boolean,
    ) => RTCError
    hangup: () => Promise<void>
}

// Encapsulates role-slot/session ownership checks and takeover handling.
export class SessionOwnershipService {
    private readonly loggedStaleSessionKeys = new Set<string>()
    private takeoverStopping = false
    private takeoverBySessionId: string | null = null
    private ownSlotActive = true
    private ownSlotCheckAt = 0
    private ownSlotCheckInFlight?: Promise<boolean>
    private ownSlotSessionMismatchKey: string | null = null

    constructor(private readonly deps: SessionOwnershipServiceDeps) {}

    isTakeoverStopping(): boolean {
        return this.takeoverStopping
    }

    getTakeoverBySessionId(): string | null {
        return this.takeoverBySessionId
    }

    resetForConnect() {
        this.loggedStaleSessionKeys.clear()
        this.takeoverStopping = false
        this.takeoverBySessionId = null
        this.ownSlotActive = true
        this.ownSlotCheckAt = 0
        this.ownSlotCheckInFlight = undefined
        this.ownSlotSessionMismatchKey = null
    }

    clearTakeoverBySessionId() {
        this.takeoverBySessionId = null
    }

    getRoleSlotSessionIdFromRoom(room: RoomDoc | null | undefined, role: Role): string | null {
        return getRoleSlotSessionIdFromRoom(room, role)
    }

    syncIdentityFromRoom(room: RoomDoc | null | undefined) {
        const db = this.deps.signalDb as SignalDB & {
            getParticipantId?: () => string | null
            getRoleSessionId?: (role: Role) => string | null
        }
        const participantId = db.getParticipantId?.()
        if (participantId) this.deps.setParticipantId(participantId)
        const sessionFromAdapter = db.getRoleSessionId?.(this.deps.role) ?? null
        const sessionFromRoom = this.getRoleSlotSessionIdFromRoom(room, this.deps.role)
        const nextSessionId = sessionFromAdapter || sessionFromRoom
        if (nextSessionId) this.deps.setSessionId(nextSessionId)
    }

    async isCurrentRemoteRoleSession(remoteSessionId: string): Promise<boolean> {
        try {
            const room = await this.deps.signalDb.getRoom()
            if (!room) return true
            const remoteRole: Role = this.deps.role === 'caller' ? 'callee' : 'caller'
            const activeRemoteSessionId = this.getRoleSlotSessionIdFromRoom(room, remoteRole)
            if (!activeRemoteSessionId) return true
            return activeRemoteSessionId === remoteSessionId
        } catch {
            return true
        }
    }

    logStaleSessionOnce(
        source: 'offer' | 'answer' | 'candidate',
        remoteSessionId: string | undefined,
    ) {
        const key = createStaleSessionLogKey(source, remoteSessionId, this.deps.getSessionId())
        if (this.loggedStaleSessionKeys.has(key)) return
        this.loggedStaleSessionKeys.add(key)
        this.deps.dbg.p(`ignore-stale-session:${source}`, {
            currentSessionId: this.deps.getSessionId() ?? null,
            remoteSessionId: remoteSessionId ?? null,
        })
        this.deps.emitDebug('ignore-stale-session')
    }

    async handleTakeoverWriteError(source: string, error: unknown): Promise<boolean> {
        if (!isTakeoverWriteError(error)) return false
        let slot: RoleSlot
        try {
            const room = await this.deps.signalDb.getRoom()
            slot = this.getRoleSlotFromRoom(room, this.deps.role)
        } catch {}
        await this.handleTakeoverDetected(source, slot)
        return true
    }

    getLocalRoleSessionId(): string | null {
        const signalDbWithRoleSession = this.deps.signalDb as SignalDB & {
            getRoleSessionId?: (role: Role) => string | null
        }
        return (
            signalDbWithRoleSession.getRoleSessionId?.(this.deps.role) ?? this.deps.getSessionId()
        )
    }

    getRoleSlotFromRoom(room: RoomDoc | null | undefined, role: Role): RoleSlot {
        return getRoleSlotFromRoom(room, role)
    }

    async handleTakeoverDetected(source: string, slot: RoleSlot) {
        if (this.takeoverStopping) return
        this.takeoverStopping = true
        this.deps.dbg.p('takeover-detected', {
            role: this.deps.role,
            source,
            myParticipantId: this.deps.getParticipantId(),
            mySessionId: this.getLocalRoleSessionId(),
            ownerParticipantId: slot?.participantId ?? null,
            ownerSessionId: slot?.sessionId ?? null,
        })
        this.takeoverBySessionId = slot?.sessionId ?? null
        this.deps.emitDebug('takeover-detected')
        this.deps.onError(
            this.deps.raiseError(
                new Error('Room slot was taken over by another tab'),
                RTCErrorCode.INVALID_STATE,
                'lifecycle',
                false,
                'takeover detected',
                false,
            ),
        )
        try {
            await this.deps.hangup()
        } catch {}
    }

    async ensureOwnSlotActive(source: string): Promise<boolean> {
        if (this.takeoverStopping) return false
        if (this.deps.getPhase() === 'closing' || this.deps.getPhase() === 'idle') return false
        if (!this.deps.getRoomId() || !this.deps.getParticipantId()) return true
        const nowMs = Date.now()
        if (this.ownSlotCheckInFlight) return this.ownSlotActive
        if (nowMs - this.ownSlotCheckAt < 400) return this.ownSlotActive

        this.ownSlotCheckInFlight = (async () => {
            let active = true
            try {
                const localSessionId = this.getLocalRoleSessionId()
                const localParticipantId = this.deps.getParticipantId()
                const { slot, ownerMismatch, sessionMismatch, mismatchKey } =
                    await resolveConfirmedSlotOwnershipMismatch({
                        readSlot: async () => {
                            const room = await this.deps.signalDb.getRoom()
                            return this.getRoleSlotFromRoom(room, this.deps.role)
                        },
                        localParticipantId,
                        localSessionId,
                    })
                if (ownerMismatch) {
                    active = false
                    await this.handleTakeoverDetected(source, slot)
                } else if (sessionMismatch) {
                    if (this.ownSlotSessionMismatchKey !== mismatchKey) {
                        this.ownSlotSessionMismatchKey = mismatchKey
                        this.deps.dbg.p('own-slot session mismatch -> takeover', {
                            source,
                            roomSessionId: slot?.sessionId ?? null,
                            localSessionId: localSessionId ?? null,
                        })
                    }
                    active = false
                    await this.handleTakeoverDetected(source, slot)
                } else {
                    this.ownSlotSessionMismatchKey = null
                }
            } catch {
                active = true
            } finally {
                this.ownSlotActive = active
                this.ownSlotCheckAt = Date.now()
                this.ownSlotCheckInFlight = undefined
            }
            return this.ownSlotActive
        })()

        return this.ownSlotActive
    }
}
