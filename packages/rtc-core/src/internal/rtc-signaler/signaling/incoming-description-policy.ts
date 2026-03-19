import type { Role } from '../../../RTCSignaler'

export type OfferCollisionAction = 'proceed' | 'ignore' | 'rollback'
export type OfferAnswerGuardAction = 'proceed' | 'skip-state' | 'skip-answering'
export type IncomingAnswerAction = 'apply' | 'ignore-not-waiting' | 'trigger-hard-reconnect'

export const shouldIgnoreEchoOffer = (input: {
    role: Role
    offerSdp: string | null
    lastLocalOfferSdp: string | null
}): boolean =>
    input.role === 'caller' &&
    !!input.offerSdp &&
    !!input.lastLocalOfferSdp &&
    input.offerSdp === input.lastLocalOfferSdp

export const resolveOfferCollisionAction = (input: {
    makingOffer: boolean
    signalingState: RTCSignalingState | undefined
    polite: boolean
}): OfferCollisionAction => {
    const hasCollision = input.makingOffer || input.signalingState !== 'stable'
    if (!hasCollision) return 'proceed'
    return input.polite ? 'rollback' : 'ignore'
}

export const resolveOfferAnswerGuardAction = (input: {
    signalingState: RTCSignalingState | undefined
    answering: boolean
}): OfferAnswerGuardAction => {
    if (input.signalingState !== 'have-remote-offer') return 'skip-state'
    if (input.answering) return 'skip-answering'
    return 'proceed'
}

export const shouldIgnoreAnswerForTargetSession = (input: {
    role: Role
    answerForSessionId: string | undefined
    localRoleSessionId: string | null
}): boolean =>
    input.role === 'caller' &&
    !!input.answerForSessionId &&
    !!input.localRoleSessionId &&
    input.answerForSessionId !== input.localRoleSessionId

export const resolveIncomingAnswerAction = (input: {
    role: Role
    signalingState: RTCSignalingState | undefined
    remoteSessionChanged: boolean
}): IncomingAnswerAction => {
    if (input.signalingState === 'have-local-offer') return 'apply'

    if (
        input.role === 'caller' &&
        input.remoteSessionChanged &&
        input.signalingState === 'stable'
    ) {
        return 'trigger-hard-reconnect'
    }

    return 'ignore-not-waiting'
}
