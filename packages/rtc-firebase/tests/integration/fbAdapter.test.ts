import type { AnswerSDP, OfferSDP } from '@vibe-rtc/rtc-core'
import type { Auth } from 'firebase/auth'
import { collection, doc, type Firestore, getDoc, getDocs } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureFirebase, FBAdapter } from '../../src'
import { loadFirebaseConfig } from '../../src/node'

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
class TestRTCIceCandidate implements RTCIceCandidate {
    candidate: string
    sdpMid: string | null
    sdpMLineIndex: number | null
    usernameFragment: string | null
    foundation: string | null
    port: number | null
    priority: number | null
    protocol: RTCIceProtocol | null
    address: string | null
    type: RTCIceCandidateType | null
    tcpType: RTCIceTcpCandidateType | null
    relatedAddress: string | null
    relatedPort: number | null
    component: RTCIceComponent | null

    constructor(init: RTCIceCandidateInit) {
        this.candidate = init.candidate!
        this.sdpMid = init.sdpMid ?? null
        this.sdpMLineIndex = init.sdpMLineIndex ?? null
        this.usernameFragment = init.usernameFragment ?? null
        this.foundation = null
        this.port = null
        this.priority = null
        this.protocol = null
        this.address = null
        this.type = null
        this.tcpType = null
        this.relatedAddress = null
        this.relatedPort = null
        this.component = null
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

;(globalThis as any).RTCIceCandidate = TestRTCIceCandidate

const o = (sdp: string): OfferSDP => ({ type: 'offer', sdp })
const a = (sdp: string): AnswerSDP => ({ type: 'answer', sdp })

const candidate = (id: string) =>
    new TestRTCIceCandidate({
        candidate: `candidate:${id} 1 udp 2122252543 0.0.0.0 9 typ host`,
        sdpMid: '0',
        sdpMLineIndex: 0,
    })

const ROOMS = 'rooms'
const CALLER = 'callerCandidates'
const CALLEE = 'calleeCandidates'

const integrationEnabled = process.env.FIREBASE_INTEGRATION === '1'
const describeIntegration = integrationEnabled ? describe.sequential : describe.sequential.skip

describeIntegration('FBAdapter — full integration suite (real Firestore)', () => {
    let db: Firestore
    let auth: Auth
    let uid: string
    let caller: FBAdapter
    let callee: FBAdapter
    let roomId: string

    beforeAll(async () => {
        const config = loadFirebaseConfig({ requireAll: true })
        console.log('firebaseConfig:', config)
        ;({ db, auth, uid } = await ensureFirebase(config))
        expect(uid).toBeTruthy()
        caller = new FBAdapter(db, auth)
        callee = new FBAdapter(db, auth)
    })

    beforeEach(async () => {
        roomId = await caller.createRoom()
        await caller.joinRoom(roomId)
        callee.joinRoom(roomId)
        await callee.joinRoom(roomId)
    })

    afterAll(async () => {
        try {
            await caller.endRoom()
        } catch {}
    })

    it('create/join; multi-subscribers; offer/answer; merge safety', async () => {
        // Two offer subscribers on callee.
        const seen1: OfferSDP[] = []
        const seen2: OfferSDP[] = []
        const u1 = callee.subscribeOnOffer((offer) => {
            seen1.push(offer)
        })
        const u2 = callee.subscribeOnOffer((offer) => {
            seen2.push(offer)
        })

        // Publish offer (merge:true does not overwrite answer).
        await caller.setOffer(o('v=0\no=- 1 1 IN IP4 127.0.0.1\ns=-\n'))

        await sleep(600)
        expect(seen1.length).toBe(1)
        expect(seen2.length).toBe(1)

        // Now set answer from callee side.
        const seenAnswer: AnswerSDP[] = []
        const unsubAns = caller.subscribeOnAnswer((ans) => {
            seenAnswer.push(ans)
        })

        await callee.setAnswer(a('v=0\no=- 2 2 IN IP4 127.0.0.1\ns=-\n'))
        await sleep(600)
        expect(seenAnswer.length).toBe(1)

        // Verify both fields are present (merge preserved them).
        const snap = await getDoc(doc(db, ROOMS, roomId))
        const data = snap.data() || {}
        expect(data.offer?.type).toBe('offer')
        expect(data.answer?.type).toBe('answer')

        // Unsubscribe.
        u1()
        u2()
        unsubAns()
    })

    it('clearOffer / clearAnswer set fields to null (not delete)', async () => {
        await caller.setOffer(o('X'))
        await callee.setAnswer(a('Y'))
        await caller.clearOffer()
        await caller.clearAnswer()

        const snap = await getDoc(doc(db, ROOMS, roomId))
        const data = snap.data() || {}
        expect(data.offer).toBeNull()
        expect(data.answer).toBeNull()
    })

    it('ICE split by roles; clear subcollections; resubscribe still works after clear', async () => {
        // Subscriptions.
        let callerSaw = 0
        let calleeSaw = 0
        const uCallee = callee.subscribeOnCallerIceCandidate(() => {
            calleeSaw++
        })
        const uCaller = caller.subscribeOnCalleeIceCandidate(() => {
            callerSaw++
        })

        await caller.addCallerIceCandidate(candidate('c1'))
        await callee.addCalleeIceCandidate(candidate('c2'))
        await sleep(600)
        expect(calleeSaw).toBeGreaterThan(0)
        expect(callerSaw).toBeGreaterThan(0)

        // Cleanup.
        await caller.clearCallerCandidates()
        await caller.clearCalleeCandidates()
        const [callerCol, calleeCol] = await Promise.all([
            getDocs(collection(db, ROOMS, roomId, CALLER)),
            getDocs(collection(db, ROOMS, roomId, CALLEE)),
        ])
        expect(callerCol.size).toBe(0)
        expect(calleeCol.size).toBe(0)

        // After cleanup, new candidates should still flow.
        await caller.addCallerIceCandidate(candidate('c3'))
        await callee.addCalleeIceCandidate(candidate('c4'))
        await sleep(600)
        expect(calleeSaw).toBeGreaterThan(0)
        expect(callerSaw).toBeGreaterThan(0)

        uCallee()
        uCaller()
    })

    it('joinRoom is idempotent; subscriptions still function', async () => {
        await callee.joinRoom(roomId)
        await callee.joinRoom(roomId)

        let seen = 0
        const u = callee.subscribeOnOffer(() => {
            seen++
        })
        await caller.setOffer(o('AA'))
        await sleep(500)
        expect(seen).toBeGreaterThan(0)
        u()
    })

    it('unsubscribe stops further notifications; endRoom auto-unsub tracks', async () => {
        let count = 0
        const unsub = callee.subscribeOnOffer(() => {
            count++
        })
        await caller.setOffer(o('A'))
        await sleep(400)
        expect(count).toBeGreaterThan(0)
        const prev = count

        // Manual unsubscribe.
        unsub()
        await caller.setOffer(o('B'))
        await sleep(500)
        expect(count).toBe(prev)

        await caller.clearOffer() // Add this line.
        await sleep(200) // Wait briefly so write propagation completes.

        // Add a new subscription and verify endRoom auto-unsub behavior.
        let after = 0
        callee.subscribeOnOffer(() => {
            after++
        })
        await caller.endRoom() // Should remove subscriptions and delete the room.
        await sleep(300)
        // Re-create for tearDown of following tests.
        roomId = await caller.createRoom()
        await caller.joinRoom(roomId)
        callee.joinRoom(roomId)
        await callee.joinRoom(roomId)
        expect(after).toBe(0) // Subscription removed in endRoom.
    })

    it('subscribe methods before joinRoom return no-op unsubscribe and do not throw', async () => {
        const fresh = new FBAdapter(db, auth) // Without joinRoom.
        const u1 = fresh.subscribeOnOffer(() => {})
        const u2 = fresh.subscribeOnAnswer(() => {})
        const u3 = fresh.subscribeOnCallerIceCandidate(() => {})
        const u4 = fresh.subscribeOnCalleeIceCandidate(() => {})
        // no-ops
        u1()
        u2()
        u3()
        u4()
    })

    it('methods that require room throw if no room selected', async () => {
        const fresh = new FBAdapter(db, auth)
        await expect(fresh.setOffer(o('x'))).rejects.toThrow()
        await expect(fresh.clearOffer()).rejects.toThrow()
        await expect(fresh.setAnswer(a('y'))).rejects.toThrow()
        await expect(fresh.clearAnswer()).rejects.toThrow()
        await expect(fresh.addCallerIceCandidate(candidate('z'))).rejects.toThrow()
        await expect(fresh.addCalleeIceCandidate(candidate('z'))).rejects.toThrow()
        await expect(fresh.clearCallerCandidates()).rejects.toThrow()
        await expect(fresh.clearCalleeCandidates()).rejects.toThrow()
        // endRoom without room selected is a no-op.
        await expect(fresh.endRoom()).resolves.toBeUndefined()
    })

    it('reconnect: caller reloads (new adapter), posts new offer, callee answers automatically', async () => {
        // baseline
        await caller.clearOffer().catch(() => {})
        await caller.clearAnswer().catch(() => {})

        // callee auto-answers the new offer.
        let lastAnswered = ''
        const u = callee.subscribeOnOffer(async (offer) => {
            lastAnswered = `ans:${offer.sdp.length}`
            await callee.setAnswer(a(lastAnswered))
        })

        // caller "reloaded".
        const caller2 = new FBAdapter(db, auth)
        await caller2.joinRoom(roomId)

        const gotAnswer = new Promise<AnswerSDP>((resolve) => {
            caller2.subscribeOnAnswer((ans) => resolve(ans))
        })

        await caller2.setOffer(o('v=0\no=- reconnect 1 IN IP4 127.0.0.1\ns=-\n'))
        const ans = await gotAnswer
        expect(ans.type).toBe('answer')
        expect(ans.sdp).toBe(lastAnswered)

        const snap = await getDoc(doc(db, ROOMS, roomId))
        expect(snap.data()?.answer?.sdp).toBe(lastAnswered)

        u()
    })

    it('endRoom removes room doc and subcollections (final)', async () => {
        // Add some data.
        await caller.setOffer(o('END'))
        await callee.setAnswer(a('END'))
        await caller.addCallerIceCandidate(candidate('E1'))
        await callee.addCalleeIceCandidate(candidate('E2'))
        await sleep(400)

        await caller.endRoom()
        const roomSnap = await getDoc(doc(db, ROOMS, roomId))
        expect(roomSnap.exists()).toBe(false)

        // Collections must be empty/removed.
        const [c1, c2] = await Promise.all([
            getDocs(collection(db, ROOMS, roomId, CALLER)),
            getDocs(collection(db, ROOMS, roomId, CALLEE)),
        ])
        expect(c1.size + c2.size).toBe(0)
    })
})
