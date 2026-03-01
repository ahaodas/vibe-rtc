export type OfferSDP = { type: 'offer'; sdp: string; epoch?: number; pcGeneration?: number }
export type AnswerSDP = {
    type: 'answer'
    sdp: string
    epoch?: number
    pcGeneration?: number
    forPcGeneration?: number
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
    pcGeneration?: number
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
    addCallerIceCandidate(ice: RTCIceCandidate): Promise<void>
    addCalleeIceCandidate(ice: RTCIceCandidate): Promise<void>
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
}
