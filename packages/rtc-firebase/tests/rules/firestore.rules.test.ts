import {
    assertFails,
    assertSucceeds,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    setDoc,
    Timestamp,
    updateDoc,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
    ALT_TOKEN_HASH,
    buildAnswer,
    buildCandidate,
    buildOffer,
    buildRoom,
    CALLEE_UID,
    CALLER_TOKEN_HASH,
    CALLER_UID,
    clearRulesData,
    createActors,
    createRulesEnv,
    futureTs,
    JOIN_TOKEN_HASH,
    makeRoomId,
    pastTs,
    type RulesActors,
    seedCandidate,
    seedRoom,
} from './helpers'

describe.sequential('Firestore rules hardening', () => {
    let env: RulesTestEnvironment
    let actors: RulesActors

    beforeAll(async () => {
        env = await createRulesEnv()
        actors = createActors(env)
    })

    beforeEach(async () => {
        await clearRulesData(env)
    })

    afterAll(async () => {
        await env.cleanup()
    })

    describe('A) happy-path', () => {
        it('caller can create a room with valid shape and TTL <= 4h', async () => {
            const roomId = makeRoomId('happy_create_room_001')
            const roomRef = doc(actors.callerDb, 'rooms', roomId)

            await assertSucceeds(
                setDoc(roomRef, {
                    ...buildRoom(),
                    createdAt: Timestamp.fromMillis(Date.now()),
                    updatedAt: Timestamp.fromMillis(Date.now()),
                    expiresAt: futureTs(120),
                }),
            )

            await assertSucceeds(getDoc(roomRef))
        })

        it('callee can claim only once', async () => {
            const roomId = makeRoomId('happy_claim_once_001')
            await seedRoom(env, roomId, buildRoom())
            const roomRefCallee = doc(actors.calleeDb, 'rooms', roomId)

            await assertSucceeds(
                updateDoc(roomRefCallee, {
                    calleeTokenHash: JOIN_TOKEN_HASH,
                    calleeUid: CALLEE_UID,
                    slots: {
                        caller: buildRoom().slots.caller,
                        callee: {
                            participantId: 'participant-callee-0001',
                            sessionId: 'callee-session-0001',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                    },
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )

            await assertFails(
                updateDoc(roomRefCallee, {
                    calleeTokenHash: ALT_TOKEN_HASH,
                    calleeUid: CALLEE_UID,
                    slots: {
                        caller: buildRoom().slots.caller,
                        callee: {
                            participantId: 'participant-callee-0002',
                            sessionId: 'callee-session-0002',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                    },
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('caller can write offer with valid token proof', async () => {
            const roomId = makeRoomId('happy_offer_001')
            await seedRoom(env, roomId, buildRoom())
            const roomRef = doc(actors.callerDb, 'rooms', roomId)

            await assertSucceeds(
                updateDoc(roomRef, {
                    offer: buildOffer(),
                    offerMeta: { tokenHash: CALLER_TOKEN_HASH, sessionId: 'caller-session-0001' },
                    activeCallerSessionId: 'caller-session-0001',
                    callerTokenProof: CALLER_TOKEN_HASH,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('callee can write answer after claim', async () => {
            const roomId = makeRoomId('happy_answer_001')
            await seedRoom(
                env,
                roomId,
                buildRoom({
                    calleeTokenHash: JOIN_TOKEN_HASH,
                    calleeUid: CALLEE_UID,
                    slots: {
                        caller: buildRoom().slots.caller,
                        callee: {
                            participantId: 'participant-callee-0001',
                            sessionId: 'callee-session-0001',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                    },
                }),
            )
            const roomRef = doc(actors.calleeDb, 'rooms', roomId)

            await assertSucceeds(
                updateDoc(roomRef, {
                    answer: buildAnswer(),
                    answerMeta: { tokenHash: JOIN_TOKEN_HASH, sessionId: 'callee-session-0001' },
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('caller can create callerCandidates caller-0..80', async () => {
            const roomId = makeRoomId('happy_callercand_001')
            await seedRoom(env, roomId, buildRoom())
            const candRef = doc(actors.callerDb, 'rooms', roomId, 'callerCandidates', 'caller-0')
            await assertSucceeds(setDoc(candRef, buildCandidate(CALLER_TOKEN_HASH)))
        })

        it('callee can create calleeCandidates callee-0..80', async () => {
            const roomId = makeRoomId('happy_calleecand_001')
            await seedRoom(
                env,
                roomId,
                buildRoom({
                    calleeTokenHash: JOIN_TOKEN_HASH,
                    calleeUid: CALLEE_UID,
                    slots: {
                        caller: buildRoom().slots.caller,
                        callee: {
                            participantId: 'participant-callee-0001',
                            sessionId: 'callee-session-0001',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                    },
                }),
            )
            const candRef = doc(actors.calleeDb, 'rooms', roomId, 'calleeCandidates', 'callee-0')
            await assertSucceeds(
                setDoc(
                    candRef,
                    buildCandidate(JOIN_TOKEN_HASH, { ownerSessionId: 'callee-session-0001' }),
                ),
            )
        })

        it('candidate update/delete are forbidden for all roles', async () => {
            const roomId = makeRoomId('happy_candidate_immut_001')
            await seedRoom(env, roomId, buildRoom())
            await seedCandidate(
                env,
                roomId,
                'callerCandidates',
                'caller-0',
                buildCandidate(CALLER_TOKEN_HASH),
            )

            const candRef = doc(actors.callerDb, 'rooms', roomId, 'callerCandidates', 'caller-0')
            await assertFails(
                updateDoc(candRef, {
                    candidate: 'candidate:tampered',
                }),
            )
            await assertFails(deleteDoc(candRef))
        })
    })

    describe('B) edge cases', () => {
        it('create denied when expiresAt is in the past', async () => {
            const roomId = makeRoomId('edge_expired_create_001')
            const roomRef = doc(actors.callerDb, 'rooms', roomId)
            await assertFails(
                setDoc(roomRef, {
                    ...buildRoom(),
                    createdAt: Timestamp.fromMillis(Date.now()),
                    updatedAt: Timestamp.fromMillis(Date.now()),
                    expiresAt: pastTs(1),
                }),
            )
        })

        it('update denied when trying to extend expiresAt', async () => {
            const roomId = makeRoomId('edge_extend_ttl_001')
            await seedRoom(env, roomId, buildRoom({ expiresAt: futureTs(20) }))
            const roomRef = doc(actors.callerDb, 'rooms', roomId)
            await assertFails(
                updateDoc(roomRef, {
                    activeCallerSessionId: 'caller-session-ttl-extend',
                    callerTokenProof: CALLER_TOKEN_HASH,
                    callerUid: CALLER_UID,
                    slots: {
                        caller: {
                            participantId: 'participant-caller-0001',
                            sessionId: 'caller-session-ttl-extend',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                        callee: null,
                    },
                    updatedAt: Timestamp.fromMillis(Date.now()),
                    expiresAt: futureTs(180),
                }),
            )
        })

        it('oversized SDP is denied (>20000)', async () => {
            const roomId = makeRoomId('edge_oversized_sdp_001')
            await seedRoom(env, roomId, buildRoom())
            const roomRef = doc(actors.callerDb, 'rooms', roomId)
            await assertFails(
                updateDoc(roomRef, {
                    offer: buildOffer('x'.repeat(20_001)),
                    offerMeta: { tokenHash: CALLER_TOKEN_HASH, sessionId: 'caller-session-0001' },
                    activeCallerSessionId: 'caller-session-0001',
                    callerTokenProof: CALLER_TOKEN_HASH,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('candidateId outside bounds is denied', async () => {
            const roomId = makeRoomId('edge_candidate_bounds_001')
            await seedRoom(env, roomId, buildRoom())
            const badIds = ['caller-81', 'caller-999', 'caller-random']

            for (const candidateId of badIds) {
                await assertFails(
                    setDoc(
                        doc(actors.callerDb, 'rooms', roomId, 'callerCandidates', candidateId),
                        buildCandidate(CALLER_TOKEN_HASH),
                    ),
                )
            }
        })

        it('immutable fields cannot be changed', async () => {
            const roomId = makeRoomId('edge_immutable_room_001')
            await seedRoom(env, roomId, buildRoom())
            const roomRef = doc(actors.callerDb, 'rooms', roomId)

            await assertFails(
                updateDoc(roomRef, {
                    callerTokenHash: ALT_TOKEN_HASH,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
            await assertFails(
                updateDoc(roomRef, {
                    joinTokenHash: ALT_TOKEN_HASH,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
            await assertFails(
                updateDoc(roomRef, {
                    createdAt: Timestamp.fromMillis(Date.now() + 1000),
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('write operations are denied after expiresAt', async () => {
            const roomId = makeRoomId('edge_write_after_expire_001')
            await seedRoom(env, roomId, buildRoom({ expiresAt: pastTs(1) }))
            const roomRef = doc(actors.callerDb, 'rooms', roomId)
            await assertFails(
                updateDoc(roomRef, {
                    activeCallerSessionId: 'caller-session-expired',
                    callerTokenProof: CALLER_TOKEN_HASH,
                    callerUid: CALLER_UID,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })
    })

    describe('C) attacking scenarios', () => {
        it('list rooms is denied', async () => {
            const roomId = makeRoomId('attack_list_rooms_001')
            await seedRoom(env, roomId, buildRoom())
            await assertFails(getDocs(collection(actors.attackerDb, 'rooms')))
        })

        it('attacker cannot claim callee when already occupied', async () => {
            const roomId = makeRoomId('attack_hijack_callee_001')
            await seedRoom(
                env,
                roomId,
                buildRoom({
                    calleeTokenHash: JOIN_TOKEN_HASH,
                    calleeUid: CALLEE_UID,
                    slots: {
                        caller: buildRoom().slots.caller,
                        callee: {
                            participantId: 'participant-callee-0001',
                            sessionId: 'callee-session-0001',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                    },
                }),
            )

            await assertFails(
                updateDoc(doc(actors.attackerDb, 'rooms', roomId), {
                    calleeTokenHash: ALT_TOKEN_HASH,
                    calleeUid: 'uid-attacker',
                    slots: {
                        caller: buildRoom().slots.caller,
                        callee: {
                            participantId: 'participant-attacker-0001',
                            sessionId: 'callee-session-attacker',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                    },
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('attacker cannot tamper offer/answer without token proof', async () => {
            const roomId = makeRoomId('attack_tamper_offer_answer_001')
            await seedRoom(
                env,
                roomId,
                buildRoom({
                    calleeTokenHash: JOIN_TOKEN_HASH,
                    calleeUid: CALLEE_UID,
                    slots: {
                        caller: buildRoom().slots.caller,
                        callee: {
                            participantId: 'participant-callee-0001',
                            sessionId: 'callee-session-0001',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                    },
                }),
            )

            const attackerRoomRef = doc(actors.attackerDb, 'rooms', roomId)
            await assertFails(
                updateDoc(attackerRoomRef, {
                    offer: buildOffer('malicious offer'),
                    offerMeta: { tokenHash: ALT_TOKEN_HASH, sessionId: 'attacker-sess' },
                    activeCallerSessionId: 'attacker-sess',
                    callerTokenProof: ALT_TOKEN_HASH,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )

            await assertFails(
                updateDoc(attackerRoomRef, {
                    answer: buildAnswer('malicious answer'),
                    answerMeta: { tokenHash: ALT_TOKEN_HASH, sessionId: 'attacker-sess' },
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('attacker cannot write caller/callee candidates', async () => {
            const roomId = makeRoomId('attack_candidates_inject_001')
            await seedRoom(
                env,
                roomId,
                buildRoom({
                    calleeTokenHash: JOIN_TOKEN_HASH,
                    calleeUid: CALLEE_UID,
                    slots: {
                        caller: buildRoom().slots.caller,
                        callee: {
                            participantId: 'participant-callee-0001',
                            sessionId: 'callee-session-0001',
                            joinedAt: Date.now(),
                            lastSeenAt: Date.now(),
                        },
                    },
                }),
            )

            await assertFails(
                setDoc(
                    doc(actors.attackerDb, 'rooms', roomId, 'callerCandidates', 'caller-0'),
                    buildCandidate(ALT_TOKEN_HASH),
                ),
            )
            await assertFails(
                setDoc(
                    doc(actors.attackerDb, 'rooms', roomId, 'calleeCandidates', 'callee-0'),
                    buildCandidate(ALT_TOKEN_HASH, { ownerSessionId: 'callee-session-0001' }),
                ),
            )
        })

        it('candidate flood beyond 0..80 is denied even for valid caller', async () => {
            const roomId = makeRoomId('attack_candidate_flood_001')
            await seedRoom(env, roomId, buildRoom())

            await assertFails(
                setDoc(
                    doc(actors.attackerDb, 'rooms', roomId, 'callerCandidates', 'caller-0'),
                    buildCandidate(ALT_TOKEN_HASH),
                ),
            )

            for (let i = 0; i <= 80; i++) {
                await assertSucceeds(
                    setDoc(
                        doc(actors.callerDb, 'rooms', roomId, 'callerCandidates', `caller-${i}`),
                        buildCandidate(CALLER_TOKEN_HASH),
                    ),
                )
            }

            await assertFails(
                setDoc(
                    doc(actors.callerDb, 'rooms', roomId, 'callerCandidates', 'caller-81'),
                    buildCandidate(CALLER_TOKEN_HASH),
                ),
            )
        })

        it('existing candidate doc cannot be modified', async () => {
            const roomId = makeRoomId('attack_modify_candidate_001')
            await seedRoom(env, roomId, buildRoom())
            await seedCandidate(
                env,
                roomId,
                'callerCandidates',
                'caller-0',
                buildCandidate(CALLER_TOKEN_HASH),
            )

            await assertFails(
                updateDoc(doc(actors.attackerDb, 'rooms', roomId, 'callerCandidates', 'caller-0'), {
                    candidate: 'candidate:attacker',
                }),
            )
        })

        it('room and candidates reads are denied after expiresAt', async () => {
            const roomId = makeRoomId('attack_read_after_expire_001')
            await seedRoom(
                env,
                roomId,
                buildRoom({
                    expiresAt: pastTs(1),
                }),
            )
            await seedCandidate(
                env,
                roomId,
                'callerCandidates',
                'caller-0',
                buildCandidate(CALLER_TOKEN_HASH),
            )

            await assertFails(getDoc(doc(actors.callerDb, 'rooms', roomId)))
            await assertFails(
                getDoc(doc(actors.callerDb, 'rooms', roomId, 'callerCandidates', 'caller-0')),
            )
            await assertFails(
                getDocs(collection(actors.callerDb, 'rooms', roomId, 'callerCandidates')),
            )
            await assertFails(getDoc(doc(actors.unauthenticatedDb, 'rooms', roomId)))
        })
    })
})
