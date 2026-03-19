import type { RoomRoleSlot } from './room-slots'
import { detectSlotOwnershipMismatch } from './slot-ownership'

export interface ConfirmedSlotOwnershipMismatch {
    slot: RoomRoleSlot | null | undefined
    ownerMismatch: boolean
    sessionMismatch: boolean
    mismatchKey: string | null
    checks: 1 | 2
}

export const resolveConfirmedSlotOwnershipMismatch = async (input: {
    readSlot: () => Promise<RoomRoleSlot | null | undefined>
    localParticipantId: string | null
    localSessionId: string | null
}): Promise<ConfirmedSlotOwnershipMismatch> => {
    const readMismatch = async () => {
        const slot = await input.readSlot()
        const mismatch = detectSlotOwnershipMismatch(
            slot,
            input.localParticipantId,
            input.localSessionId,
        )
        return {
            slot,
            ...mismatch,
        }
    }

    const first = await readMismatch()
    if (!first.ownerMismatch && !first.sessionMismatch) {
        return {
            ...first,
            checks: 1,
        }
    }

    const confirmed = await readMismatch()
    return {
        ...confirmed,
        checks: 2,
    }
}
