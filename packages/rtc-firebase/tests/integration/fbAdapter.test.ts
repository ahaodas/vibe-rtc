import type { AnswerSDP, OfferSDP } from '@vibe-rtc/rtc-core'
import type { Auth } from 'firebase/auth'
import { doc, type Firestore, getDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureFirebase, FBAdapter } from '../../src'
import { loadFirebaseConfig } from '../../src/node'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class TestRTCIceCandidate implements RTCIceCandidate {
    candidate: string
    sdpMid: string | null
    sdpMLineIndex: number | null
    usernameFragment: string | null
    foundation: string | null = null
    port: number | null = null
    priority: number | null = null
    protocol: RTCIceProtocol | null = null
    address: string | null = null
    type: RTCIceCandidateType | null = null
    tcpType: RTCIceTcpCandidateType | null = null
    relatedAddress: string | null = null
    relatedPort: number | null = null
    component: RTCIceComponent | null = null

    constructor(init: RTCIceCandidateInit) {
        this.candidate = init.candidate ?? ''
        this.sdpMid = init.sdpMid ?? null
        this.sdpMLineIndex = init.sdpMLineIndex ?? null
        this.usernameFragment = init.usernameFragment ?? null
    }

    toJSON(): RTCIceCandidateInit {
        return {
            candidate: this.candidate,
            sdpMid: this.sdpMid ?? undefined,
            sdpMLineIndex: this.sdpMLineIndex ?? undefined,
            usernameFragment: this.usernameFragment ?? undefined,
        }
    }
}

;(globalThis as unknown as { RTCIceCandidate?: typeof TestRTCIceCandidate }).RTCIceCandidate =
    TestRTCIceCandidate

const offer = (sdp: string): OfferSDP => ({ type: 'offer', sdp })
const answer = (sdp: string): AnswerSDP => ({ type: 'answer', sdp })

const candidate = (id: string) =>
    new TestRTCIceCandidate({
        candidate: `candidate:${id} 1 udp 2122252543 0.0.0.0 9 typ host`,
        sdpMid: '0',
        sdpMLineIndex: 0,
    })

const integrationEnabled = process.env.FIREBASE_INTEGRATION === '1'
const describeIntegration = integrationEnabled ? describe.sequential : describe.sequential.skip

describeIntegration('FBAdapter — integration (path-based signaling)', () => {
    let db: Firestore
    let auth: Auth
    let caller: FBAdapter
    let callee: FBAdapter
    let roomId: string

    beforeAll(async () => {
        const config = loadFirebaseConfig({ requireAll: true })
        ;({ db, auth } = await ensureFirebase(config))
    })

    beforeEach(async () => {
        caller = new FBAdapter(db, auth, { securityMode: 'demo_hardened' })
        callee = new FBAdapter(db, auth, { securityMode: 'demo_hardened' })

        roomId = await caller.createRoom()
        await caller.joinRoom(roomId, 'caller')
        await callee.joinRoom(roomId, 'callee')
    })

    afterAll(async () => {
        try {
            await caller.endRoom()
        } catch {
            // noop
        }
    })

    it('offer/answer flow works through participant docs', async () => {
        const seenAnswers: AnswerSDP[] = []
        const unsubAnswer = caller.subscribeOnAnswer((value) => {
            seenAnswers.push(value)
        })

        const unsubOffer = callee.subscribeOnOffer(async (value) => {
            await callee.setAnswer(answer(`answer:${value.sdp.length}`))
        })

        await caller.setOffer(offer('v=0\no=- 1 1 IN IP4 127.0.0.1\ns=-\n'))

        const started = Date.now()
        while (seenAnswers.length === 0 && Date.now() - started < 5000) {
            await sleep(100)
        }

        expect(seenAnswers.length).toBeGreaterThan(0)
        expect(seenAnswers[seenAnswers.length - 1]?.type).toBe('answer')

        unsubOffer()
        unsubAnswer()
    })

    it('ICE candidates flow through role branches', async () => {
        let callerCandidateSeen = 0
        let calleeCandidateSeen = 0

        const unsubCaller = callee.subscribeOnCallerIceCandidate(() => {
            callerCandidateSeen += 1
        })
        const unsubCallee = caller.subscribeOnCalleeIceCandidate(() => {
            calleeCandidateSeen += 1
        })

        await caller.addCallerIceCandidate(candidate('caller-1'))
        await callee.addCalleeIceCandidate(candidate('callee-1'))

        const started = Date.now()
        while (
            (callerCandidateSeen === 0 || calleeCandidateSeen === 0) &&
            Date.now() - started < 5000
        ) {
            await sleep(100)
        }

        expect(callerCandidateSeen).toBeGreaterThan(0)
        expect(calleeCandidateSeen).toBeGreaterThan(0)

        unsubCaller()
        unsubCallee()
    })

    it('same-role takeover marks previous caller as taken over', async () => {
        let takenOver = false
        const callerWithCallback = new FBAdapter(db, auth, {
            securityMode: 'demo_hardened',
            callbacks: {
                onTakenOver() {
                    takenOver = true
                },
            },
        })

        await callerWithCallback.joinRoom(roomId, 'caller')
        await callerWithCallback.setOffer(offer('initial-offer'))

        const caller2 = new FBAdapter(db, auth, { securityMode: 'demo_hardened' })
        await caller2.joinRoom(roomId, 'caller')

        const started = Date.now()
        while (!takenOver && Date.now() - started < 5000) {
            await sleep(100)
        }

        expect(takenOver).toBe(true)
        await expect(callerWithCallback.setOffer(offer('must-fail'))).rejects.toThrow(/taken over/i)
    })

    it('endRoom removes root room doc', async () => {
        await caller.endRoom()
        const roomSnap = await getDoc(doc(db, 'rooms', roomId))
        expect(roomSnap.exists()).toBe(false)
    })
})
