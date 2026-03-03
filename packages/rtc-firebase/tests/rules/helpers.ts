import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, type DocumentData, doc, setDoc, Timestamp } from 'firebase/firestore'

export const CALLER_UID = 'uid-caller'
export const CALLEE_UID = 'uid-callee'
export const ATTACKER_UID = 'uid-attacker'

export const CALLER_TOKEN_HASH = 'callerTokenHash_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export const JOIN_TOKEN_HASH = 'joinTokenHash_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
export const ALT_TOKEN_HASH = 'altTokenHash_cccccccccccccccccccccccccccccccccc'

const DEFAULT_ROOM_ID = 'room_secure_flow_abcdefghijkl'
const PROJECT_ID = process.env.FIREBASE_RULES_TEST_PROJECT_ID ?? 'vibe-rtc-rules-test'

function parseEmulatorHost(value: string | undefined): { host: string; port: number } {
    const fallback = { host: '127.0.0.1', port: 8080 }
    if (!value) return fallback

    const [host, portRaw] = value.split(':')
    const port = Number.parseInt(portRaw ?? '', 10)
    if (!host || Number.isNaN(port)) return fallback
    return { host, port }
}

export type RoomSeedOverrides = Partial<{
    creatorUid: string | null
    callerUid: string | null
    calleeUid: string | null
    callerTokenHash: string
    joinTokenHash: string
    calleeTokenHash: string | null
    activeCallerSessionId: string
    callerTokenProof: string
    slots: DocumentData
    offer: DocumentData | null
    offerMeta: DocumentData | null
    answer: DocumentData | null
    answerMeta: DocumentData | null
    epoch: number
    createdAt: Timestamp
    updatedAt: Timestamp
    expiresAt: Timestamp
}>

export function makeRoomId(suffix: string): string {
    return `room_secure_flow_${suffix}`.slice(0, 28)
}

export function futureTs(minutes = 60): Timestamp {
    return Timestamp.fromMillis(Date.now() + minutes * 60_000)
}

export function pastTs(minutes = 1): Timestamp {
    return Timestamp.fromMillis(Date.now() - minutes * 60_000)
}

export function buildRoom(overrides: RoomSeedOverrides = {}): DocumentData {
    const now = Timestamp.fromMillis(Date.now())
    return {
        creatorUid: CALLER_UID,
        callerUid: CALLER_UID,
        calleeUid: null,
        callerTokenHash: CALLER_TOKEN_HASH,
        joinTokenHash: JOIN_TOKEN_HASH,
        calleeTokenHash: null,
        activeCallerSessionId: 'caller-session-0001',
        callerTokenProof: CALLER_TOKEN_HASH,
        slots: {
            caller: {
                participantId: 'participant-caller-0001',
                sessionId: 'caller-session-0001',
                joinedAt: 1_700_000_000_000,
                lastSeenAt: 1_700_000_000_000,
            },
            callee: null,
        },
        offer: null,
        offerMeta: null,
        answer: null,
        answerMeta: null,
        epoch: 0,
        createdAt: now,
        updatedAt: now,
        expiresAt: futureTs(60),
        ...overrides,
    }
}

export function buildOffer(sdp = 'v=0\no=- 1 1 IN IP4 127.0.0.1\ns=-\n'): DocumentData {
    return {
        type: 'offer',
        sdp,
        epoch: 0,
        sessionId: 'caller-session-0001',
        pcGeneration: 0,
        icePhase: 'STUN',
    }
}

export function buildAnswer(sdp = 'v=0\no=- 2 2 IN IP4 127.0.0.1\ns=-\n'): DocumentData {
    return {
        type: 'answer',
        sdp,
        epoch: 0,
        sessionId: 'callee-session-0001',
        pcGeneration: 0,
        icePhase: 'STUN',
    }
}

export function buildCandidate(
    tokenHash: string,
    overrides: Partial<DocumentData> = {},
): DocumentData {
    return {
        candidate: 'candidate:1 1 udp 2122252543 10.0.0.2 54400 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'ufrag',
        sessionId: 'caller-session-0001',
        ownerSessionId: 'caller-session-0001',
        epoch: 0,
        pcGeneration: 0,
        gen: 0,
        icePhase: 'STUN',
        tokenHash,
        createdAt: Timestamp.fromMillis(Date.now()),
        ...overrides,
    }
}

export type RulesActors = {
    callerDb: any
    calleeDb: any
    attackerDb: any
    unauthenticatedDb: any
}

export async function createRulesEnv(): Promise<RulesTestEnvironment> {
    const hostCfg = parseEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST)
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
    try {
        return await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: {
                host: hostCfg.host,
                port: hostCfg.port,
                rules,
            },
        })
    } catch (error) {
        throw new Error(
            `[rules-test] Firestore emulator is required at ${hostCfg.host}:${hostCfg.port}. Start it with "pnpm test:rules:emu" or "pnpm emulators". Original error: ${String(error)}`,
        )
    }
}

export async function clearRulesData(env: RulesTestEnvironment): Promise<void> {
    await env.clearFirestore()
}

export function createActors(env: RulesTestEnvironment): RulesActors {
    return {
        callerDb: env.authenticatedContext(CALLER_UID).firestore(),
        calleeDb: env.authenticatedContext(CALLEE_UID).firestore(),
        attackerDb: env.authenticatedContext(ATTACKER_UID).firestore(),
        unauthenticatedDb: env.unauthenticatedContext().firestore(),
    }
}

export async function seedRoom(
    env: RulesTestEnvironment,
    roomId = DEFAULT_ROOM_ID,
    data: DocumentData = buildRoom(),
): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'rooms', roomId), data)
    })
}

export async function seedCandidate(
    env: RulesTestEnvironment,
    roomId: string,
    side: 'callerCandidates' | 'calleeCandidates',
    candidateId: string,
    data: DocumentData,
): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(collection(ctx.firestore(), 'rooms', roomId, side), candidateId), data)
    })
}
