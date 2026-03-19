import type { CandidateType, IcePhase } from '../../../connection-strategy'
import { getCandidateType, shouldSendCandidate } from '../../../connection-strategy'
import { type RTCError, RTCErrorCode } from '../../../errors'
import type { OfferSDP } from '../../../types'
import { sdpHash } from '../debug/debug-utils'
import { buildCandidatePayload, buildOfferPayload } from '../signaling/signal-payloads'

type OfferPublishSource = 'onnegotiationneeded' | 'bootstrap'

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
    pe: (message: string, error: unknown) => void
}

interface PeerNegotiationDeps {
    pc?: RTCPeerConnection
    role: 'caller' | 'callee'
    phase: 'idle' | 'closing' | 'negotiating' | string
    roomId: string | null
    isTakeoverStopping: () => boolean
    makingOffer: boolean
    remoteDescSet: boolean
    lastLocalOfferSdp: string | null
    icePhase: IcePhase
    signalingEpoch: number
    sessionId: string | null
    candidateStats: {
        localSeen: Record<CandidateType, number>
        localSent: Record<CandidateType, number>
        localDropped: Record<CandidateType, number>
    }
    streams: {
        setOffer: (payload: unknown) => Promise<void>
        addCallerIceCandidate: (payload: unknown) => Promise<void>
        addCalleeIceCandidate: (payload: unknown) => Promise<void>
    }
    dbg: SignalerDebugger
    emitDebug: (lastEvent?: string) => void
    onError: (error: RTCError) => void
    isCurrentGeneration: (generation: number) => boolean
    ensureOwnSlotActive: (source: string) => Promise<boolean>
    startStunOnlyTimer: (generation: number) => void
    refreshSignalingEpoch: () => Promise<boolean>
    getLocalRoleSessionId: () => string | null
    nextSignalSequence: () => number
    handleTakeoverWriteError: (source: string, error: unknown) => Promise<boolean>
    bumpCandidateCounter: (counter: Record<CandidateType, number>, type: CandidateType) => void
    raiseError: (
        err: unknown,
        fallbackCode: RTCErrorCode,
        phase: 'negotiation' | 'signaling',
        retriable: boolean,
        message?: string,
        rethrow?: boolean,
    ) => RTCError
}

// Handles local negotiation hooks and outbound ICE candidate signaling.
// Deps stays intentionally loose-typed to avoid coupling to RTCSignaler private surface.
export class PeerNegotiationService {
    constructor(private readonly deps: PeerNegotiationDeps) {}

    bindPeerNegotiationHandlers(generation: number) {
        const pc = this.deps.pc
        if (!pc) return

        pc.onicecandidate = (ev: RTCPeerConnectionIceEvent) => {
            void this.handleLocalIceCandidate(ev, generation)
        }

        pc.onnegotiationneeded = () => {
            if (!this.deps.isCurrentGeneration(generation)) return
            if (this.deps.isTakeoverStopping()) return
            if (!this.deps.roomId || this.deps.phase === 'closing' || this.deps.phase === 'idle') {
                return
            }
            void this.publishOfferIfStable(generation, 'onnegotiationneeded')
        }

        if (this.deps.role === 'caller') {
            // Fail-safe for very fast reload races where negotiationneeded can be missed.
            void this.publishOfferIfStable(generation, 'bootstrap')
        }
    }

    async publishOfferIfStable(generation: number, source: OfferPublishSource) {
        if (!(await this.deps.ensureOwnSlotActive(`send-offer:${source}`))) return
        if (!this.deps.isCurrentGeneration(generation)) return
        if (!this.deps.pc) return
        if (this.deps.makingOffer || this.deps.pc.signalingState !== 'stable') {
            this.deps.dbg.p(`${source} skipped (makingOffer or !stable)`)
            return
        }
        this.deps.phase = 'negotiating'
        this.deps.emitDebug(source === 'bootstrap' ? 'negotiation-bootstrap' : 'negotiationneeded')

        try {
            this.deps.makingOffer = true
            this.deps.remoteDescSet = false
            const offer = await this.deps.pc.createOffer()
            if (!this.deps.isCurrentGeneration(generation) || !this.deps.pc) return
            this.deps.lastLocalOfferSdp = offer.sdp ?? null
            this.deps.dbg.p('created offer', { sdp: sdpHash(offer.sdp) })
            this.deps.dbg.p('SLD(offer) start')
            await this.deps.pc.setLocalDescription(offer)
            if (this.deps.icePhase === 'STUN_ONLY') this.deps.startStunOnlyTimer(generation)
            if (!this.deps.isCurrentGeneration(generation) || !this.deps.pc) return
            const epochChanged = await this.deps.refreshSignalingEpoch()
            if (epochChanged) {
                this.deps.dbg.p('skip offer publish after epoch sync')
                return
            }
            if (!(await this.deps.ensureOwnSlotActive(`send-offer:${source}:publish`))) return
            if (!this.deps.isCurrentGeneration(generation) || !this.deps.pc) return
            const localRoleSessionId = this.deps.getLocalRoleSessionId() ?? this.deps.sessionId
            const signalSeq = this.deps.nextSignalSequence()
            this.deps.dbg.p('signaling-send:offer', {
                sessionId: localRoleSessionId ?? null,
                generation,
                signalSeq,
                phase: this.deps.icePhase,
                source,
            })
            await this.deps.streams.setOffer(
                buildOfferPayload({
                    offer: offer as OfferSDP,
                    epoch: this.deps.signalingEpoch,
                    generation,
                    signalSeq,
                    sessionId: localRoleSessionId,
                    icePhase: this.deps.icePhase,
                }),
            )
            this.deps.dbg.p(
                source === 'bootstrap' ? 'offer published (bootstrap)' : 'offer published',
            )
        } catch (e) {
            if (await this.deps.handleTakeoverWriteError(`send-offer:${source}`, e)) return
            this.deps.dbg.pe('negotiation error', e)
            this.deps.onError(
                this.deps.raiseError(
                    e,
                    RTCErrorCode.SIGNALING_FAILED,
                    'negotiation',
                    true,
                    undefined,
                    false,
                ),
            )
        } finally {
            this.deps.makingOffer = false
            this.deps.emitDebug('negotiation-done')
        }
    }

    async handleLocalIceCandidate(ev: RTCPeerConnectionIceEvent, generation: number) {
        if (!this.deps.isCurrentGeneration(generation)) return
        if (this.deps.isTakeoverStopping()) return
        if (!this.deps.roomId || this.deps.phase === 'closing' || this.deps.phase === 'idle') return
        if (!this.deps.pc || this.deps.pc.signalingState === 'closed') return
        if (!ev.candidate) return

        const candidateText = ev.candidate.candidate || ''
        const candidateType = getCandidateType(candidateText)
        this.deps.bumpCandidateCounter(this.deps.candidateStats.localSeen, candidateType)
        if (!shouldSendCandidate(this.deps.icePhase, candidateText)) {
            this.deps.bumpCandidateCounter(this.deps.candidateStats.localDropped, candidateType)
            this.deps.dbg.p(`local ICE dropped type=${candidateType} phase=${this.deps.icePhase}`)
            this.deps.emitDebug(`ice-local-drop:${candidateType}`)
            return
        }
        this.deps.bumpCandidateCounter(this.deps.candidateStats.localSent, candidateType)

        try {
            const localRoleSessionId = this.deps.getLocalRoleSessionId() ?? this.deps.sessionId
            // Include session marker so remote side can ignore stale ICE
            // after reload/reconnect. Generation is kept only for debug.
            const candidatePayload = buildCandidatePayload({
                candidate: ev.candidate.toJSON(),
                epoch: this.deps.signalingEpoch,
                generation,
                sessionId: localRoleSessionId,
                icePhase: this.deps.icePhase,
            })
            if (!(await this.deps.ensureOwnSlotActive('send-candidate'))) return
            this.deps.dbg.p('signaling-send:candidate', {
                sessionId: localRoleSessionId ?? null,
                generation,
                type: candidateType,
                phase: this.deps.icePhase,
            })
            if (this.deps.role === 'caller') {
                await this.deps.streams.addCallerIceCandidate(candidatePayload)
            } else {
                await this.deps.streams.addCalleeIceCandidate(candidatePayload)
            }
        } catch (e) {
            if (await this.deps.handleTakeoverWriteError('send-candidate', e)) return
            this.deps.onError(
                this.deps.raiseError(
                    e,
                    RTCErrorCode.DB_UNAVAILABLE,
                    'signaling',
                    true,
                    undefined,
                    false,
                ),
            )
        }
    }
}
