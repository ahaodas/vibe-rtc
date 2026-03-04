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
    runTransaction,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
    ATTACKER_UID,
    buildAnswer,
    buildCalleeParticipant,
    buildCallerParticipant,
    buildCandidate,
    buildLease,
    buildOffer,
    buildRoom,
    buildTakeoverEvent,
    CALLEE_SESSION,
    CALLEE_UID,
    CALLER_SESSION,
    CALLER_UID,
    clearRulesData,
    createActors,
    createRulesEnv,
    makeRoomId,
    type RulesActors,
    seedCandidate,
    seedLease,
    seedParticipant,
    seedRoom,
} from './helpers'

describe.sequential('Firestore rules (path-based signaling)', () => {
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
        it('caller can create room root', async () => {
            const roomId = makeRoomId('create_room_001')
            await assertSucceeds(setDoc(doc(actors.callerDb, 'rooms', roomId), buildRoom()))
            await assertSucceeds(getDoc(doc(actors.callerDb, 'rooms', roomId)))
        })

        it('caller/callee can update their room slot with partial merge patch', async () => {
            const roomId = makeRoomId('room_slot_update_001')
            await seedRoom(env, roomId, buildRoom())

            await assertSucceeds(
                setDoc(
                    doc(actors.callerDb, 'rooms', roomId),
                    {
                        callerUid: CALLER_UID,
                        updatedAt: Timestamp.fromMillis(Date.now()),
                    },
                    { merge: true },
                ),
            )

            await assertSucceeds(
                setDoc(
                    doc(actors.calleeDb, 'rooms', roomId),
                    {
                        calleeUid: CALLEE_UID,
                        updatedAt: Timestamp.fromMillis(Date.now()),
                    },
                    { merge: true },
                ),
            )
        })

        it('caller can create own lease/participant/offer/candidates', async () => {
            const roomId = makeRoomId('caller_flow_001')
            await seedRoom(env, roomId, buildRoom())

            await assertSucceeds(
                setDoc(
                    doc(actors.callerDb, 'rooms', roomId, 'leases', 'caller'),
                    buildLease('caller', CALLER_UID, CALLER_SESSION, 1),
                ),
            )

            await assertSucceeds(
                setDoc(
                    doc(actors.callerDb, 'rooms', roomId, 'callers', CALLER_UID),
                    buildCallerParticipant({ offer: buildOffer(), answer: null }),
                ),
            )

            await assertSucceeds(
                setDoc(
                    doc(
                        actors.callerDb,
                        'rooms',
                        roomId,
                        'callers',
                        CALLER_UID,
                        'candidates',
                        'cand-1',
                    ),
                    buildCandidate({ sessionId: CALLER_SESSION }),
                ),
            )
        })

        it('callee can create own lease/participant/answer/candidates', async () => {
            const roomId = makeRoomId('callee_flow_001')
            await seedRoom(env, roomId, buildRoom())

            await assertSucceeds(
                setDoc(
                    doc(actors.calleeDb, 'rooms', roomId, 'leases', 'callee'),
                    buildLease('callee', CALLEE_UID, CALLEE_SESSION, 1),
                ),
            )

            await assertSucceeds(
                setDoc(
                    doc(actors.calleeDb, 'rooms', roomId, 'callees', CALLEE_UID),
                    buildCalleeParticipant({ answer: buildAnswer(), offer: null }),
                ),
            )

            await assertSucceeds(
                setDoc(
                    doc(
                        actors.calleeDb,
                        'rooms',
                        roomId,
                        'callees',
                        CALLEE_UID,
                        'candidates',
                        'cand-1',
                    ),
                    buildCandidate({ sessionId: CALLEE_SESSION }),
                ),
            )
        })

        it('participant create allows omitted optional offer/answer fields', async () => {
            const roomId = makeRoomId('participant_optional_001')
            await seedRoom(env, roomId, buildRoom())
            const now = Timestamp.fromMillis(Date.now())

            await assertSucceeds(
                setDoc(doc(actors.callerDb, 'rooms', roomId, 'callers', CALLER_UID), {
                    uid: CALLER_UID,
                    role: 'caller',
                    sessionId: CALLER_SESSION,
                    active: true,
                    createdAt: now,
                    updatedAt: now,
                }),
            )

            await assertSucceeds(
                setDoc(doc(actors.calleeDb, 'rooms', roomId, 'callees', CALLEE_UID), {
                    uid: CALLEE_UID,
                    role: 'callee',
                    sessionId: CALLEE_SESSION,
                    active: true,
                    createdAt: now,
                    updatedAt: now,
                }),
            )
        })

        it('takeover lease update allows cross-uid owner switch with leaseVersion increment', async () => {
            const roomId = makeRoomId('lease_takeover_001')
            await seedRoom(env, roomId, buildRoom())
            await seedLease(
                env,
                roomId,
                'caller',
                buildLease('caller', CALLER_UID, CALLER_SESSION, 1),
            )

            await assertSucceeds(
                updateDoc(doc(actors.calleeDb, 'rooms', roomId, 'leases', 'caller'), {
                    ownerUid: CALLEE_UID,
                    ownerSessionId: 'callee-session-0002',
                    leaseVersion: 2,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )

            await assertFails(
                updateDoc(doc(actors.calleeDb, 'rooms', roomId, 'leases', 'caller'), {
                    ownerUid: CALLEE_UID,
                    ownerSessionId: 'callee-session-0003',
                    leaseVersion: 2,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('claimRole-like transaction succeeds with serverTimestamp and multi-write', async () => {
            const roomId = makeRoomId('claim_role_tx_001')
            const newSessionId = 'callee-session-tx-0001'
            await seedRoom(env, roomId, buildRoom())
            await seedLease(
                env,
                roomId,
                'caller',
                buildLease('caller', CALLER_UID, CALLER_SESSION, 1),
            )
            await seedParticipant(env, roomId, 'callers', CALLER_UID, buildCallerParticipant())

            await assertSucceeds(
                runTransaction(actors.calleeDb, async (tx) => {
                    const roomRef = doc(actors.calleeDb, 'rooms', roomId)
                    const leaseRef = doc(actors.calleeDb, 'rooms', roomId, 'leases', 'caller')
                    const participantRef = doc(
                        actors.calleeDb,
                        'rooms',
                        roomId,
                        'callers',
                        CALLEE_UID,
                    )
                    const takeoverEventRef = doc(
                        actors.calleeDb,
                        'rooms',
                        roomId,
                        'events',
                        'evt-claim-role-tx-001',
                    )

                    const leaseSnap = await tx.get(leaseRef)
                    const previousLease = leaseSnap.data() as { leaseVersion?: number } | undefined
                    const nextLeaseVersion = (previousLease?.leaseVersion ?? 0) + 1

                    tx.update(leaseRef, {
                        role: 'caller',
                        ownerUid: CALLEE_UID,
                        ownerSessionId: newSessionId,
                        leaseVersion: nextLeaseVersion,
                        updatedAt: serverTimestamp(),
                    })

                    tx.set(participantRef, {
                        uid: CALLEE_UID,
                        role: 'caller',
                        sessionId: newSessionId,
                        active: true,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    })

                    tx.set(takeoverEventRef, {
                        type: 'role_taken_over',
                        role: 'caller',
                        targetUid: CALLER_UID,
                        targetSessionId: CALLER_SESSION,
                        byUid: CALLEE_UID,
                        bySessionId: newSessionId,
                        createdAt: serverTimestamp(),
                    })

                    tx.update(roomRef, {
                        callerUid: CALLEE_UID,
                        updatedAt: serverTimestamp(),
                    })
                }),
            )
        })

        it('events can be created by authenticated user with matching byUid', async () => {
            const roomId = makeRoomId('event_create_001')
            await seedRoom(env, roomId, buildRoom())

            await assertSucceeds(
                setDoc(
                    doc(actors.calleeDb, 'rooms', roomId, 'events', 'evt-1'),
                    buildTakeoverEvent({
                        role: 'caller',
                        targetUid: CALLER_UID,
                        targetSessionId: CALLER_SESSION,
                        byUid: CALLEE_UID,
                        bySessionId: CALLEE_SESSION,
                    }),
                ),
            )
        })
    })

    describe('B) security checks', () => {
        it('cannot write participant under чужой uid path', async () => {
            const roomId = makeRoomId('foreign_participant_001')
            await seedRoom(env, roomId, buildRoom())

            await assertFails(
                setDoc(
                    doc(actors.attackerDb, 'rooms', roomId, 'callers', CALLER_UID),
                    buildCallerParticipant({ uid: CALLER_UID }),
                ),
            )
        })

        it('cannot write candidate under чужой uid path', async () => {
            const roomId = makeRoomId('foreign_candidate_001')
            await seedRoom(env, roomId, buildRoom())

            await assertFails(
                setDoc(
                    doc(
                        actors.attackerDb,
                        'rooms',
                        roomId,
                        'callers',
                        CALLER_UID,
                        'candidates',
                        'cand-1',
                    ),
                    buildCandidate(),
                ),
            )
        })

        it('cannot write lease with ownerUid != request.auth.uid', async () => {
            const roomId = makeRoomId('foreign_lease_001')
            await seedRoom(env, roomId, buildRoom())

            await assertFails(
                setDoc(
                    doc(actors.attackerDb, 'rooms', roomId, 'leases', 'caller'),
                    buildLease('caller', CALLER_UID, CALLER_SESSION, 1),
                ),
            )
        })

        it('cannot write events when byUid != request.auth.uid', async () => {
            const roomId = makeRoomId('foreign_event_001')
            await seedRoom(env, roomId, buildRoom())

            await assertFails(
                setDoc(
                    doc(actors.attackerDb, 'rooms', roomId, 'events', 'evt-1'),
                    buildTakeoverEvent({
                        byUid: CALLER_UID,
                        bySessionId: CALLER_SESSION,
                    }),
                ),
            )
        })

        it('cannot write role-mismatched participant payload', async () => {
            const roomId = makeRoomId('role_mismatch_001')
            await seedRoom(env, roomId, buildRoom())

            await assertFails(
                setDoc(
                    doc(actors.callerDb, 'rooms', roomId, 'callers', CALLER_UID),
                    buildCallerParticipant({ role: 'callee' }),
                ),
            )
        })

        it('cannot read signaling docs unauthenticated', async () => {
            const roomId = makeRoomId('unauth_read_001')
            await seedRoom(env, roomId, buildRoom())
            await seedParticipant(
                env,
                roomId,
                'callers',
                CALLER_UID,
                buildCallerParticipant({ offer: buildOffer() }),
            )
            await seedCandidate(env, roomId, 'callers', CALLER_UID, 'cand-1', buildCandidate())

            await assertFails(getDoc(doc(actors.unauthenticatedDb, 'rooms', roomId)))
            await assertFails(
                getDoc(doc(actors.unauthenticatedDb, 'rooms', roomId, 'callers', CALLER_UID)),
            )
            await assertFails(
                getDoc(
                    doc(
                        actors.unauthenticatedDb,
                        'rooms',
                        roomId,
                        'callers',
                        CALLER_UID,
                        'candidates',
                        'cand-1',
                    ),
                ),
            )
            await assertFails(
                getDoc(doc(actors.unauthenticatedDb, 'rooms', roomId, 'leases', 'caller')),
            )
            await assertFails(
                getDoc(doc(actors.unauthenticatedDb, 'rooms', roomId, 'events', 'evt-1')),
            )
        })

        it('list rooms is denied for authenticated users', async () => {
            const roomId = makeRoomId('list_rooms_denied_001')
            await seedRoom(env, roomId, buildRoom())
            await assertFails(getDocs(collection(actors.callerDb, 'rooms')))
            await assertFails(getDocs(collection(actors.attackerDb, 'rooms')))
        })

        it('attacker cannot delete room root owned by caller', async () => {
            const roomId = makeRoomId('room_delete_denied_001')
            await seedRoom(env, roomId, buildRoom())
            await assertFails(deleteDoc(doc(actors.attackerDb, 'rooms', roomId)))
        })

        it('attacker uid cannot impersonate caller participant update', async () => {
            const roomId = makeRoomId('participant_update_denied_001')
            await seedRoom(env, roomId, buildRoom())
            await seedParticipant(env, roomId, 'callers', CALLER_UID, buildCallerParticipant())

            await assertFails(
                updateDoc(doc(actors.attackerDb, 'rooms', roomId, 'callers', CALLER_UID), {
                    active: false,
                    updatedAt: Timestamp.fromMillis(Date.now()),
                }),
            )
        })

        it('oversized SDP payload is denied in participant doc', async () => {
            const roomId = makeRoomId('oversized_sdp_001')
            await seedRoom(env, roomId, buildRoom())

            await assertFails(
                setDoc(
                    doc(actors.callerDb, 'rooms', roomId, 'callers', CALLER_UID),
                    buildCallerParticipant({
                        offer: buildOffer('x'.repeat(20_001)),
                    }),
                ),
            )
        })

        it('attacker cannot read/write another user signaling branches', async () => {
            const roomId = makeRoomId('attacker_scope_001')
            await seedRoom(env, roomId, buildRoom())
            await seedLease(
                env,
                roomId,
                'caller',
                buildLease('caller', CALLER_UID, CALLER_SESSION, 1),
            )
            await seedParticipant(
                env,
                roomId,
                'callers',
                CALLER_UID,
                buildCallerParticipant({ offer: buildOffer() }),
            )

            await assertSucceeds(
                getDoc(doc(actors.attackerDb, 'rooms', roomId, 'leases', 'caller')),
            )
            await assertSucceeds(
                getDoc(doc(actors.attackerDb, 'rooms', roomId, 'callers', CALLER_UID)),
            )

            await assertFails(
                setDoc(
                    doc(actors.attackerDb, 'rooms', roomId, 'callers', CALLER_UID),
                    buildCallerParticipant({ uid: ATTACKER_UID }),
                ),
            )
        })
    })
})
