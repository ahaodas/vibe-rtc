export type OfferSDP = { type: 'offer'; sdp: string }
export type AnswerSDP = { type: 'answer'; sdp: string }

export interface SignalDB {
    createRoom(): Promise<string>

    joinRoom(id: string): void

    getOffer(): Promise<OfferSDP | null>

    setOffer(offer: OfferSDP): Promise<void>

    clearOffer(): Promise<void>

    setAnswer(answer: AnswerSDP): Promise<void>

    clearAnswer(): Promise<void>

    addCallerIceCandidate(ice: RTCIceCandidate): Promise<void>

    addCalleeIceCandidate(ice: RTCIceCandidate): Promise<void>

    subscribeOnCallerIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void

    subscribeOnCalleeIceCandidate(cb: (ice: RTCIceCandidateInit) => void): () => void

    subscribeOnOffer(cb: (offer: OfferSDP) => void | Promise<void>): () => void

    subscribeOnAnswer(cb: (answer: AnswerSDP) => void | Promise<void>): () => void

    clearCallerCandidates(): Promise<void>

    clearCalleeCandidates(): Promise<void>

    /** Полное завершение комнаты: отписки, удаление кандидатов и удаление документа комнаты */
    endRoom(): Promise<void>
}

export type RoomDoc = {
    calleeUid?: string
    callerUid?: string
    offer?: OfferSDP | null
    answer?: AnswerSDP | null
    createdAt?: unknown // serverTimestamp()
    updatedAt?: unknown // serverTimestamp()
}

export type CandidateDoc = RTCIceCandidateInit & {
    createdAt?: unknown // serverTimestamp()
}
