export interface EpochAcceptanceInput {
    currentEpoch: number
    incomingEpochLike: unknown
}

export interface EpochAcceptanceResult {
    accepted: boolean
    nextEpoch: number
    advanced: boolean
}

export const evaluateEpochAcceptance = (input: EpochAcceptanceInput): EpochAcceptanceResult => {
    const incomingEpoch =
        typeof input.incomingEpochLike === 'number' && Number.isFinite(input.incomingEpochLike)
            ? input.incomingEpochLike
            : input.currentEpoch

    if (incomingEpoch < input.currentEpoch) {
        return {
            accepted: false,
            nextEpoch: input.currentEpoch,
            advanced: false,
        }
    }

    if (incomingEpoch > input.currentEpoch) {
        return {
            accepted: true,
            nextEpoch: incomingEpoch,
            advanced: true,
        }
    }

    return {
        accepted: true,
        nextEpoch: input.currentEpoch,
        advanced: false,
    }
}
