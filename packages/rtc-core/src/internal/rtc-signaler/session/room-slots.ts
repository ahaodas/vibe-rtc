import type { RoomDoc } from '../../../types'

export type RoomSlotRole = 'caller' | 'callee'
export type RoomRoleSlot = NonNullable<NonNullable<RoomDoc['slots']>['caller']>

export const getRoleSlotFromRoom = (
    room: RoomDoc | null | undefined,
    role: RoomSlotRole,
): RoomRoleSlot | null | undefined =>
    role === 'caller' ? room?.slots?.caller : room?.slots?.callee

export const getRoleSlotSessionIdFromRoom = (
    room: RoomDoc | null | undefined,
    role: RoomSlotRole,
): string | null => {
    const slot = getRoleSlotFromRoom(room, role)
    if (!slot || typeof slot.sessionId !== 'string') return null
    const value = slot.sessionId.trim()
    return value.length > 0 ? value : null
}
