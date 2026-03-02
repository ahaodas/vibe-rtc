import type { IcePhase } from './connection-strategy'

export type OfferSDP = {
    type: 'offer'
    sdp: string
    epoch?: number
    sessionId?: string
    pcGeneration?: number
    gen?: number
    icePhase?: IcePhase
}
export type AnswerSDP = {
    type: 'answer'
    sdp: string
    epoch?: number
    sessionId?: string
    pcGeneration?: number
    forPcGeneration?: number
    gen?: number
    forGen?: number
    icePhase?: IcePhase
}

export type RoomDoc = {
    creatorUid: string | null
    callerUid: string | null
    calleeUid: string | null
    offer: OfferSDP | null
    answer: AnswerSDP | null
    epoch?: number
    callerHeartbeatAt?: any
    calleeHeartbeatAt?: any
    createdAt: any
    updatedAt: any
    expiresAt: any
}

export type CandidateDoc = RTCIceCandidateInit & {
    epoch?: number
    sessionId?: string
    pcGeneration?: number
    gen?: number
    icePhase?: IcePhase
    createdAt?: unknown // serverTimestamp()
}

export interface SignalDB {
    /** Create a new room and return its id */
    createRoom(): Promise<string>

    /** Join an existing room (and initialize adapter internal refs/collections) */
    joinRoom(id: string, role?: 'caller' | 'callee'): void | Promise<void>

    /** Read the current room snapshot (used by provider for auto-attach) */
    getRoom(): Promise<RoomDoc | null>

    /** SDP */
    getOffer(): Promise<OfferSDP | null>
    setOffer(offer: OfferSDP): Promise<void>
    clearOffer(): Promise<void>

    setAnswer(answer: AnswerSDP): Promise<void>
    clearAnswer(): Promise<void>

    /** ICE */
    addCallerIceCandidate(ice: RTCIceCandidate | CandidateDoc): Promise<void>
    addCalleeIceCandidate(ice: RTCIceCandidate | CandidateDoc): Promise<void>
    subscribeOnCallerIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void
    subscribeOnCalleeIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void

    /** SDP subscriptions */
    subscribeOnOffer(cb: (offer: OfferSDP) => void | Promise<void>): () => void
    subscribeOnAnswer(cb: (answer: AnswerSDP) => void | Promise<void>): () => void

    /** Clear ICE collections */
    clearCallerCandidates(): Promise<void>
    clearCalleeCandidates(): Promise<void>

    /** Fully terminate a room: unsubscribe, delete candidates, and remove room document */
    endRoom(): Promise<void>

    /**
     * Soft-leave current room for a role (without deleting room).
     * Optional for adapters that can expose presence state to remote peer.
     */
    leaveRoom?(role: 'caller' | 'callee'): Promise<void>
}
