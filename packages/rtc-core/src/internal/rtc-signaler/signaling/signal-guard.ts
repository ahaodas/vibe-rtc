export interface SignalGuardInput {
    epochLike: unknown
    source: string
    acceptEpoch: (epochLike: unknown) => boolean
    ensureOwnSlotActive?: (source: string) => Promise<boolean>
    requireOwnSlotActive?: boolean
}

export const canProcessIncomingSignal = async (input: SignalGuardInput): Promise<boolean> => {
    if (!input.acceptEpoch(input.epochLike)) return false
    if (!input.requireOwnSlotActive) return true
    if (!input.ensureOwnSlotActive) return true
    return input.ensureOwnSlotActive(input.source)
}
