import type { RoomRoleSlot } from './room-slots'

export interface SlotOwnershipMismatch {
    ownerMismatch: boolean
    sessionMismatch: boolean
    mismatchKey: string | null
}

export const detectSlotOwnershipMismatch = (
    slot: RoomRoleSlot | null | undefined,
    localParticipantId: string | null,
    localSessionId: string | null,
): SlotOwnershipMismatch => {
    const ownerMismatch =
        !!slot?.participantId && !!localParticipantId && slot.participantId !== localParticipantId
    const sessionMismatch =
        !!slot?.sessionId && !!localSessionId && slot.sessionId !== localSessionId
    return {
        ownerMismatch,
        sessionMismatch,
        mismatchKey: sessionMismatch
            ? `${slot?.sessionId ?? 'none'}|${localSessionId ?? 'none'}`
            : null,
    }
}
