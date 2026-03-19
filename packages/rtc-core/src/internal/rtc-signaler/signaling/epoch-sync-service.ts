import { type RTCError, RTCErrorCode } from '../../../errors'
import { evaluateEpochAcceptance } from './epoch-state'

interface EpochSyncDeps {
    signalingEpoch: number
    lastHandledOfferSdp: string | null
    lastHandledAnswerSdp: string | null
    lastSeenOfferSdp: string | null
    lastSeenAnswerSdp: string | null
    lastLocalOfferSdp: string | null
    answering: boolean
    remoteDescSet: boolean
    pendingIce: RTCIceCandidateInit[]
    pc?: RTCPeerConnection
    signalDb: {
        getRoom: () => Promise<{ epoch?: number } | null>
    }
    cleanupPeerOnly: () => void
    initPeer: () => void
    emitDebug: (lastEvent?: string) => void
    acceptEpoch: (epochLike: unknown) => boolean
    raiseError: (
        err: unknown,
        fallbackCode: RTCErrorCode,
        phase: 'room',
        retriable: boolean,
        message?: string,
    ) => RTCError
}

// Encapsulates signaling epoch acceptance and resync with room snapshot.
// Deps stays intentionally loose-typed to avoid coupling to RTCSignaler private surface.
export class EpochSyncService {
    constructor(private readonly deps: EpochSyncDeps) {}

    acceptEpoch(epochLike: unknown): boolean {
        const acceptance = evaluateEpochAcceptance({
            currentEpoch: this.deps.signalingEpoch,
            incomingEpochLike: epochLike,
        })
        if (!acceptance.accepted) return false
        if (acceptance.advanced) {
            this.deps.signalingEpoch = acceptance.nextEpoch
            this.deps.lastHandledOfferSdp = null
            this.deps.lastHandledAnswerSdp = null
            this.deps.lastSeenOfferSdp = null
            this.deps.lastSeenAnswerSdp = null
            this.deps.lastLocalOfferSdp = null
            this.deps.answering = false
            this.deps.remoteDescSet = false
            this.deps.pendingIce.length = 0
            if (this.deps.pc) {
                this.deps.cleanupPeerOnly()
                this.deps.initPeer()
                this.deps.emitDebug('epoch-advance')
            }
        }
        return true
    }

    async refreshSignalingEpoch(): Promise<boolean> {
        const before = this.deps.signalingEpoch
        const room = await this.deps.signalDb.getRoom()
        if (!room) {
            throw this.deps.raiseError(
                new Error('Room not found'),
                RTCErrorCode.ROOM_NOT_FOUND,
                'room',
                false,
                'signaling room no longer exists',
            )
        }
        this.deps.acceptEpoch(room.epoch)
        return this.deps.signalingEpoch !== before
    }
}
