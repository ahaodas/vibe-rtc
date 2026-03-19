import type { Subscription } from 'rxjs'
import type { CandidateType, ConnectionStrategy, IcePhase } from '../../../connection-strategy'
import { getCandidateType, shouldAcceptCandidate } from '../../../connection-strategy'
import { type RTCError, RTCErrorCode } from '../../../errors'
import type { AnswerSDP, OfferSDP } from '../../../types'
import { sdpHash } from '../debug/debug-utils'
import { hasIcePhase, normalizeSignalIcePhase } from '../ice/ice-phase-policy'
import {
    resolveIncomingAnswerAction,
    resolveOfferAnswerGuardAction,
    resolveOfferCollisionAction,
    shouldIgnoreAnswerForTargetSession,
    shouldIgnoreEchoOffer,
} from './incoming-description-policy'
import { resolveRemoteSessionSyncDecision } from './remote-session-sync'
import { getSignalSessionId, getSignalTargetSessionId } from './session-utils'
import { canProcessIncomingSignal } from './signal-guard'
import { createDescriptionSignalKey } from './signal-keys'
import { buildAnswerPayload } from './signal-payloads'

type IncomingCandidateSignal = RTCIceCandidateInit & {
    epoch?: number
    icePhase?: IcePhase
}

type SignalerDebugger = {
    p: (message: string, extra?: unknown) => void
    pe: (message: string, error: unknown) => void
}

type SignalSubscribable<T> = {
    subscribe: (next: (value: T) => unknown) => Subscription
}

interface IncomingSignalDeps {
    role: 'caller' | 'callee'
    streams: {
        callerIce$: SignalSubscribable<IncomingCandidateSignal>
        calleeIce$: SignalSubscribable<IncomingCandidateSignal>
        offer$: SignalSubscribable<OfferSDP>
        answer$: SignalSubscribable<AnswerSDP>
        setAnswer: (payload: unknown) => Promise<void>
    }
    rxSubs: Subscription[]
    connectionStrategy: ConnectionStrategy
    sessionId: string | null
    signalingEpoch: number
    icePhase: IcePhase
    phase: string
    makingOffer: boolean
    polite: boolean
    remoteDescSet: boolean
    answering: boolean
    pcGeneration: number
    lastLocalOfferSdp: string | null
    lastSeenOfferSdp: string | null
    lastHandledOfferSdp: string | null
    lastSeenAnswerSdp: string | null
    lastHandledAnswerSdp: string | null
    seenRemoteOfferSessions: Set<string>
    controlledPeerRebuild: boolean
    pendingIce: IncomingCandidateSignal[]
    pc?: RTCPeerConnection
    candidateStats: {
        remoteSeen: Record<CandidateType, number>
        remoteAccepted: Record<CandidateType, number>
        remoteDropped: Record<CandidateType, number>
    }
    dbg: SignalerDebugger
    emitDebug: (lastEvent?: string) => void
    onError: (error: RTCError) => void
    acceptEpoch: (epochLike: unknown) => boolean
    isCurrentRemoteRoleSession: (remoteSessionId: string) => Promise<boolean>
    logStaleSessionOnce: (
        source: 'offer' | 'answer' | 'candidate',
        remoteSessionId: string | undefined,
    ) => void
    transitionToNextIcePhase: (reason: string) => boolean
    bumpCandidateCounter: (counter: Record<CandidateType, number>, type: CandidateType) => void
    markRemoteProgress: () => void
    raiseError: (
        err: unknown,
        fallbackCode: RTCErrorCode,
        phase: 'signaling' | 'negotiation',
        retriable: boolean,
        message?: string,
        rethrow?: boolean,
    ) => RTCError
    drainPendingIceCandidates: () => Promise<void>
    isCurrentGeneration: (generation: number) => boolean
    startStunOnlyTimer: (generation: number) => void
    refreshSignalingEpoch: () => Promise<boolean>
    ensureOwnSlotActive: (source: string) => Promise<boolean>
    getLocalRoleSessionId: () => string | null
    nextSignalSequence: () => number
    handleTakeoverWriteError: (source: string, error: unknown) => Promise<boolean>
    tryHardNow: () => Promise<void>
    getIcePhasePolicyContext: () => {
        baseRtcConfig: RTCConfiguration
        nativeIceServers: RTCIceServer[]
        stunOnlyIceServers: RTCIceServer[]
        turnOnlyIceServers: RTCIceServer[]
    }
    resetNegotiationStateForPeerRebuild: () => void
    clearLanFirstTimer: () => void
    clearStunOnlyTimer: () => void
    clearConnectingWatchdogTimer: () => void
    cleanupPeerOnly: () => void
    initPeer: () => void
}

// Orchestrates incoming signaling events and mutates the owning RTCSignaler state.
// Deps is intentionally untyped here to keep this service decoupled from private surface changes.
export class IncomingSignalService {
    constructor(private readonly deps: IncomingSignalDeps) {}

    attachSignalingSubscriptions() {
        const remoteIce$ =
            this.deps.role === 'caller'
                ? this.deps.streams.calleeIce$
                : this.deps.streams.callerIce$
        this.deps.rxSubs.push(
            remoteIce$.subscribe(async (candidate: IncomingCandidateSignal) => {
                await this.handleIncomingCandidate(candidate)
            }),
        )

        this.deps.rxSubs.push(
            this.deps.streams.offer$.subscribe(async (offer: OfferSDP) => {
                await this.handleIncomingOffer(offer)
            }),
        )

        this.deps.rxSubs.push(
            this.deps.streams.answer$.subscribe(async (answer: AnswerSDP) => {
                await this.handleIncomingAnswer(answer)
            }),
        )
    }

    async handleIncomingCandidate(candidateSignal: IncomingCandidateSignal) {
        if (
            !(await canProcessIncomingSignal({
                epochLike: candidateSignal.epoch,
                source: 'recv-candidate',
                acceptEpoch: (epochLike) => this.deps.acceptEpoch(epochLike),
            }))
        ) {
            return
        }
        const remoteSessionId = getSignalSessionId(candidateSignal)
        this.deps.dbg.p('signaling-recv:candidate', {
            sessionId: remoteSessionId ?? null,
            currentSessionId: this.deps.sessionId ?? null,
            phase: this.deps.icePhase,
        })
        if (await this.shouldIgnoreIncomingCandidateSession(remoteSessionId)) return

        const syncedSession = this.syncIncomingRemoteSessionOrLog(
            'candidate',
            remoteSessionId,
            candidateSignal.icePhase,
        )
        if (syncedSession == null) return
        const candidateText = candidateSignal.candidate || ''
        const candidateType = getCandidateType(candidateText)
        this.deps.bumpCandidateCounter(this.deps.candidateStats.remoteSeen, candidateType)
        if (
            this.deps.connectionStrategy === 'LAN_FIRST' &&
            this.deps.role === 'callee' &&
            this.deps.icePhase === 'LAN' &&
            candidateType !== 'host'
        ) {
            this.deps.dbg.p(
                `LAN received non-host ICE (${candidateType}) -> fallback to public ICE`,
            )
            this.deps.transitionToNextIcePhase('remote-candidate')
        }
        if (!shouldAcceptCandidate(this.deps.icePhase, candidateText)) {
            this.deps.bumpCandidateCounter(this.deps.candidateStats.remoteDropped, candidateType)
            this.deps.dbg.p(`remote ICE dropped type=${candidateType} phase=${this.deps.icePhase}`)
            this.deps.emitDebug(`ice-remote-drop:${candidateType}`)
            return
        }
        this.deps.bumpCandidateCounter(this.deps.candidateStats.remoteAccepted, candidateType)
        this.deps.markRemoteProgress()
        this.deps.dbg.p(`remote ICE from ${this.deps.role === 'caller' ? 'callee' : 'caller'}`, {
            buffered: !this.deps.remoteDescSet,
            phase: this.deps.icePhase,
            type: candidateType,
            cand: candidateText.slice(0, 42),
        })
        try {
            if (!this.deps.remoteDescSet) {
                this.deps.pendingIce.push(candidateSignal)
                return
            }
            if (!this.deps.pc) return
            await this.deps.pc.addIceCandidate(candidateSignal)
        } catch (e) {
            this.deps.onError(
                this.deps.raiseError(
                    e,
                    RTCErrorCode.SIGNALING_FAILED,
                    'signaling',
                    true,
                    undefined,
                    false,
                ),
            )
        }
    }

    async handleIncomingOffer(offerSignal: OfferSDP) {
        if (
            !(await canProcessIncomingSignal({
                epochLike: offerSignal.epoch,
                source: 'recv-offer',
                acceptEpoch: (epochLike) => this.deps.acceptEpoch(epochLike),
            }))
        ) {
            return
        }
        const remoteSessionId = getSignalSessionId(offerSignal)
        this.deps.dbg.p('signaling-recv:offer', {
            sessionId: remoteSessionId ?? null,
            currentSessionId: this.deps.sessionId ?? null,
            phase: this.deps.icePhase,
        })
        if (await this.shouldIgnoreIncomingOfferSession(remoteSessionId)) return

        const localSessionId = this.syncIncomingRemoteSessionOrLog(
            'offer',
            remoteSessionId,
            offerSignal.icePhase,
        )
        if (localSessionId == null) return
        if (remoteSessionId) this.deps.seenRemoteOfferSessions.add(remoteSessionId)
        const localGeneration = this.deps.pcGeneration
        const desc = new RTCSessionDescription(offerSignal)
        const sdp = desc.sdp ?? null
        const offerSignalKey = createDescriptionSignalKey({
            sessionId: remoteSessionId,
            forGen: offerSignal.forGen,
            gen: offerSignal.gen,
            pcGeneration: offerSignal.pcGeneration,
            forPcGeneration: offerSignal.forPcGeneration,
            sdp,
        })
        this.deps.dbg.p('onOffer()', {
            type: desc.type,
            sdp: sdpHash(sdp),
            makingOffer: this.deps.makingOffer,
            sig: this.deps.pc?.signalingState,
            polite: this.deps.polite,
        })
        this.deps.emitDebug('onOffer')

        if (offerSignalKey === this.deps.lastSeenOfferSdp) {
            this.deps.dbg.p('skip offer: already seen')
            return
        }
        this.deps.lastSeenOfferSdp = offerSignalKey

        try {
            if (desc.type !== 'offer') return

            if (
                shouldIgnoreEchoOffer({
                    role: this.deps.role,
                    offerSdp: sdp,
                    lastLocalOfferSdp: this.deps.lastLocalOfferSdp,
                })
            ) {
                this.deps.dbg.p('skip offer: echo of own local offer')
                return
            }

            if (offerSignalKey === this.deps.lastHandledOfferSdp) {
                this.deps.dbg.p('skip offer (same sdp handled)')
                return
            }

            const collisionAction = resolveOfferCollisionAction({
                makingOffer: this.deps.makingOffer,
                signalingState: this.deps.pc?.signalingState,
                polite: this.deps.polite,
            })
            if (collisionAction === 'ignore') {
                this.deps.dbg.p('glare → ignore (impolite)')
                return
            }
            if (collisionAction === 'rollback') {
                this.deps.dbg.p('glare → rollback')
                try {
                    await this.deps.pc?.setLocalDescription({
                        type: 'rollback',
                    } as RTCSessionDescriptionInit)
                } catch (e) {
                    this.deps.dbg.pe('rollback fail', e)
                }
            }

            this.deps.phase = 'negotiating'
            this.deps.emitDebug('SRD(offer) start')

            if (!this.deps.isCurrentGeneration(localGeneration) || !this.deps.pc) return
            try {
                await this.deps.pc.setRemoteDescription(desc)
            } catch (e) {
                this.deps.dbg.pe(`SRD FAIL type=offer sdp=${sdpHash(sdp)}`, e)
                throw e
            }
            if (!this.deps.isCurrentGeneration(localGeneration) || !this.deps.pc) return
            this.deps.remoteDescSet = true
            this.deps.lastHandledOfferSdp = offerSignalKey
            this.deps.dbg.p('SRD(offer) done, drain ICE', { pending: this.deps.pendingIce.length })
            this.deps.emitDebug('SRD(offer) done')

            await this.deps.drainPendingIceCandidates()

            const answerGuard = resolveOfferAnswerGuardAction({
                signalingState: this.deps.pc?.signalingState,
                answering: this.deps.answering,
            })
            if (answerGuard === 'skip-state') {
                this.deps.dbg.p(`skip answer: state!=${this.deps.pc?.signalingState}`)
                return
            }
            if (answerGuard === 'skip-answering') {
                this.deps.dbg.p('skip answer: already answering')
                return
            }
            this.deps.answering = true

            if (!this.deps.isCurrentGeneration(localGeneration) || !this.deps.pc) return
            const answer = await this.deps.pc.createAnswer()
            this.deps.dbg.p('created answer', { sdp: sdpHash(answer.sdp) })
            this.deps.dbg.p('SLD(answer) start')
            if (!this.deps.isCurrentGeneration(localGeneration) || !this.deps.pc) return
            await this.deps.pc.setLocalDescription(answer)
            if (this.deps.icePhase === 'STUN_ONLY') this.deps.startStunOnlyTimer(localGeneration)
            this.deps.dbg.p('SLD(answer) done, publish')
            const epochChanged = await this.deps.refreshSignalingEpoch()
            if (epochChanged) {
                this.deps.dbg.p('skip answer publish after epoch sync')
                return
            }
            if (!(await this.deps.ensureOwnSlotActive('send-answer:offer-handler:publish'))) {
                this.deps.dbg.p('skip answer publish: role slot is not active')
                return
            }
            if (!this.deps.isCurrentGeneration(localGeneration) || !this.deps.pc) return
            const localRoleSessionId = this.deps.getLocalRoleSessionId() ?? this.deps.sessionId
            const answerForSessionId = offerSignal.forSessionId ?? remoteSessionId
            const signalSeq = this.deps.nextSignalSequence()
            this.deps.dbg.p('signaling-send:answer', {
                sessionId: localRoleSessionId ?? null,
                forSessionId: answerForSessionId ?? null,
                generation: localGeneration,
                signalSeq,
                phase: this.deps.icePhase,
            })
            await this.deps.streams.setAnswer(
                buildAnswerPayload({
                    answer: answer as AnswerSDP,
                    epoch: this.deps.signalingEpoch,
                    generation: localGeneration,
                    signalSeq,
                    sessionId: localRoleSessionId,
                    forSessionId: answerForSessionId,
                    icePhase: this.deps.icePhase,
                }),
            )
            this.deps.dbg.p('answer published')
        } catch (e) {
            if (await this.deps.handleTakeoverWriteError('send-answer:offer-handler', e)) return
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
            this.deps.answering = false
        }
    }

    async handleIncomingAnswer(answerSignal: AnswerSDP) {
        if (
            !(await canProcessIncomingSignal({
                epochLike: answerSignal.epoch,
                source: 'recv-answer',
                acceptEpoch: (epochLike) => this.deps.acceptEpoch(epochLike),
            }))
        ) {
            return
        }
        const remoteSessionId = getSignalSessionId(answerSignal)
        const answerForSessionId = getSignalTargetSessionId(answerSignal)
        this.deps.dbg.p('signaling-recv:answer', {
            sessionId: remoteSessionId ?? null,
            forSessionId: answerForSessionId ?? null,
            currentSessionId: this.deps.sessionId ?? null,
            phase: this.deps.icePhase,
        })
        const desc = new RTCSessionDescription(answerSignal)
        const sdp = desc.sdp ?? null
        const answerSignalKey = createDescriptionSignalKey({
            sessionId: remoteSessionId,
            forSessionId: answerForSessionId,
            forGen: answerSignal.forGen,
            gen: answerSignal.gen,
            pcGeneration: answerSignal.pcGeneration,
            forPcGeneration: answerSignal.forPcGeneration,
            sdp,
        })
        this.deps.dbg.p('onAnswer()', {
            type: desc.type,
            sdp: sdpHash(sdp),
            sig: this.deps?.pc?.signalingState,
        })
        this.deps.emitDebug('onAnswer')

        if (answerSignalKey === this.deps.lastSeenAnswerSdp) {
            this.deps.dbg.p('skip answer: already seen')
            return
        }
        this.deps.lastSeenAnswerSdp = answerSignalKey

        try {
            if (desc.type !== 'answer') return
            const localRoleSessionId = this.deps.getLocalRoleSessionId()
            if (
                shouldIgnoreAnswerForTargetSession({
                    role: this.deps.role,
                    answerForSessionId,
                    localRoleSessionId,
                })
            ) {
                this.deps.logStaleSessionOnce('answer', remoteSessionId ?? answerForSessionId)
                this.deps.dbg.p('signaling-recv:answer ignored due to target session mismatch', {
                    answerForSessionId,
                    localRoleSessionId,
                    remoteSessionId: remoteSessionId ?? null,
                })
                return
            }
            const prevSessionId = this.deps.sessionId
            const localSessionId = this.syncIncomingRemoteSessionOrLog(
                'answer',
                remoteSessionId,
                answerSignal.icePhase,
            )
            if (localSessionId == null) return
            const remoteSessionChanged =
                !!remoteSessionId && !!prevSessionId && remoteSessionId !== prevSessionId
            if (answerSignalKey === this.deps.lastHandledAnswerSdp) {
                this.deps.dbg.p('skip answer (same sdp handled)')
                return
            }
            const incomingAnswerAction = resolveIncomingAnswerAction({
                role: this.deps.role,
                signalingState: this.deps.pc?.signalingState,
                remoteSessionChanged,
            })
            if (incomingAnswerAction === 'trigger-hard-reconnect') {
                this.deps.dbg.p('answer indicates remote session change -> reconnectHard', {
                    remoteSessionId,
                    prevSessionId,
                })
                void this.deps.tryHardNow()
                return
            }
            if (incomingAnswerAction === 'ignore-not-waiting') {
                this.deps.dbg.p(
                    'skip answer: not waiting (state=' +
                        (this.deps.pc?.signalingState ?? 'no-pc') +
                        ')',
                )
                return
            }
            const localGeneration = this.deps.pcGeneration

            this.deps.dbg.p('SRD(answer) start')
            if (!this.deps.isCurrentGeneration(localGeneration) || !this.deps.pc) return
            try {
                await this.deps.pc.setRemoteDescription(desc)
            } catch (e) {
                this.deps.dbg.pe(`SRD FAIL type=answer sdp=${sdpHash(sdp)}`, e)
                throw e
            }
            if (!this.deps.isCurrentGeneration(localGeneration) || !this.deps.pc) return
            this.deps.lastHandledAnswerSdp = answerSignalKey
            this.deps.remoteDescSet = true
            this.deps.markRemoteProgress()
            this.deps.dbg.p('SRD(answer) done, drain ICE', { pending: this.deps.pendingIce.length })
            this.deps.emitDebug('SRD(answer) done')

            await this.deps.drainPendingIceCandidates()
        } catch (e) {
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
        }
    }

    private async shouldIgnoreIncomingOfferSession(
        remoteSessionId: string | undefined,
    ): Promise<boolean> {
        if (!remoteSessionId || remoteSessionId === this.deps.sessionId) return false

        if (this.deps.seenRemoteOfferSessions.has(remoteSessionId)) {
            this.deps.logStaleSessionOnce('offer', remoteSessionId)
            return true
        }

        const isCurrentRemoteSession = await this.deps.isCurrentRemoteRoleSession(remoteSessionId)
        if (isCurrentRemoteSession) return false

        this.deps.logStaleSessionOnce('offer', remoteSessionId)
        this.deps.dbg.p('signaling-recv:offer ignored due to session mismatch', {
            sessionId: remoteSessionId,
            currentSessionId: this.deps.sessionId ?? null,
        })
        return true
    }

    private async shouldIgnoreIncomingCandidateSession(
        remoteSessionId: string | undefined,
    ): Promise<boolean> {
        if (
            !remoteSessionId ||
            remoteSessionId === this.deps.sessionId ||
            this.deps.remoteDescSet
        ) {
            return false
        }

        const isCurrentRemoteSession = await this.deps.isCurrentRemoteRoleSession(remoteSessionId)
        if (isCurrentRemoteSession) return false

        this.deps.logStaleSessionOnce('candidate', remoteSessionId)
        this.deps.dbg.p('signaling-recv:candidate ignored due to remote lease session mismatch', {
            sessionId: remoteSessionId,
            currentSessionId: this.deps.sessionId ?? null,
        })
        return true
    }

    private syncIncomingRemoteSessionOrLog(
        source: 'offer' | 'answer' | 'candidate',
        remoteSessionId: string | undefined,
        remotePhaseRaw: unknown,
    ): string | undefined {
        const localSessionId = this.syncPeerToRemoteSession(remoteSessionId, remotePhaseRaw, source)
        if (localSessionId != null) return localSessionId

        this.deps.dbg.p(`signaling-recv:${source} ignored due to session mismatch`, {
            sessionId: remoteSessionId ?? null,
            currentSessionId: this.deps.sessionId ?? null,
        })
        return undefined
    }

    private syncPeerToRemoteSession(
        remoteSessionId: string | undefined,
        remotePhaseRaw: unknown,
        source: 'offer' | 'answer' | 'candidate',
    ): string | undefined {
        const decision = resolveRemoteSessionSyncDecision({
            source,
            role: this.deps.role,
            remoteSessionId,
            currentSessionId: this.deps.sessionId,
            remoteDescSet: this.deps.remoteDescSet,
        })

        if (decision.action === 'keep-current') {
            return decision.nextSessionId
        }

        if (decision.action === 'adopt-session') {
            this.deps.dbg.p(`sync-remote-session:${source}`, {
                remoteSessionId: decision.nextSessionId,
                currentSessionId: this.deps.sessionId ?? null,
                remotePhase: normalizeSignalIcePhase(remotePhaseRaw) ?? 'n/a',
                targetPhase: this.deps.icePhase,
            })
            this.deps.sessionId = decision.nextSessionId
            this.deps.emitDebug(`sync-remote:${source}`)
            return this.deps.sessionId ?? undefined
        }

        if (decision.action === 'reject-stale') {
            this.deps.logStaleSessionOnce(source, decision.staleSessionId)
            return undefined
        }

        const remotePhase = normalizeSignalIcePhase(remotePhaseRaw)
        const targetPhase =
            remotePhase && hasIcePhase(remotePhase, this.deps.getIcePhasePolicyContext())
                ? remotePhase
                : this.deps.icePhase
        this.deps.dbg.p(`sync-remote-session:${source}`, {
            remoteSessionId: decision.nextSessionId,
            currentSessionId: this.deps.sessionId ?? null,
            remotePhase: remotePhase ?? 'n/a',
            targetPhase,
        })
        this.deps.sessionId = decision.nextSessionId
        this.deps.controlledPeerRebuild = true
        try {
            this.deps.makingOffer = false
            this.deps.answering = false
            this.deps.resetNegotiationStateForPeerRebuild()
            this.deps.clearLanFirstTimer()
            this.deps.clearStunOnlyTimer()
            this.deps.clearConnectingWatchdogTimer()
            this.deps.cleanupPeerOnly()
            this.deps.icePhase = targetPhase
            this.deps.initPeer()
        } finally {
            this.deps.controlledPeerRebuild = false
        }
        this.deps.emitDebug(`sync-remote:${source}`)
        return this.deps.sessionId ?? undefined
    }
}
