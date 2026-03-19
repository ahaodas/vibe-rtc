import type { IcePhase } from '../../../connection-strategy'
import type { AnswerSDP, CandidateDoc, OfferSDP } from '../../../types'

export interface BuildOfferPayloadInput {
    offer: OfferSDP
    epoch: number
    generation: number
    signalSeq: number
    sessionId: string | null | undefined
    icePhase: IcePhase
}

export interface BuildAnswerPayloadInput {
    answer: AnswerSDP
    epoch: number
    generation: number
    signalSeq: number
    sessionId: string | null | undefined
    forSessionId: string | undefined
    icePhase: IcePhase
}

export interface BuildCandidatePayloadInput {
    candidate: RTCIceCandidateInit
    epoch: number
    generation: number
    sessionId: string | null | undefined
    icePhase: IcePhase
}

export const buildOfferPayload = (input: BuildOfferPayloadInput): OfferSDP => ({
    ...input.offer,
    epoch: input.epoch,
    pcGeneration: input.generation,
    gen: input.generation,
    forGen: input.signalSeq,
    sessionId: input.sessionId ?? undefined,
    forSessionId: input.sessionId ?? undefined,
    icePhase: input.icePhase,
})

export const buildAnswerPayload = (input: BuildAnswerPayloadInput): AnswerSDP => ({
    ...input.answer,
    epoch: input.epoch,
    pcGeneration: input.generation,
    gen: input.generation,
    forGen: input.signalSeq,
    sessionId: input.sessionId ?? undefined,
    forSessionId: input.forSessionId ?? undefined,
    icePhase: input.icePhase,
})

export const buildCandidatePayload = (input: BuildCandidatePayloadInput): CandidateDoc => ({
    ...input.candidate,
    epoch: input.epoch,
    pcGeneration: input.generation,
    gen: input.generation,
    sessionId: input.sessionId ?? undefined,
    icePhase: input.icePhase,
})
