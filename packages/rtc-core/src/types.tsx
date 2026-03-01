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
    /** Создать новую комнату, вернуть её id */
    createRoom(): Promise<string>

    /** Подключиться к существующей комнате (и инициализировать внутренние ref/коллекции адаптера) */
    joinRoom(id: string, role?: 'caller' | 'callee'): void | Promise<void>

    /** Считать актуальный снапшот комнаты (нужен провайдеру для auto-attach) */
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

    /** Подписки на SDP */
    subscribeOnOffer(cb: (offer: OfferSDP) => void | Promise<void>): () => void
    subscribeOnAnswer(cb: (answer: AnswerSDP) => void | Promise<void>): () => void

    /** Очистка ICE-коллекций */
    clearCallerCandidates(): Promise<void>
    clearCalleeCandidates(): Promise<void>

    /** Полное завершение комнаты: отписки, удаление кандидатов и удаление документа комнаты */
    endRoom(): Promise<void>
}
