import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, type DocumentData, doc, setDoc, Timestamp } from 'firebase/firestore'

export const CALLER_UID = 'uid-caller'
export const CALLEE_UID = 'uid-callee'
export const ATTACKER_UID = 'uid-attacker'

export const CALLER_SESSION = 'caller-session-0001'
export const CALLEE_SESSION = 'callee-session-0001'

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

export function makeRoomId(suffix: string): string {
    return `room_secure_flow_${suffix}`.slice(0, 28)
}

export function futureTs(minutes = 60): Timestamp {
    return Timestamp.fromMillis(Date.now() + minutes * 60_000)
}

export function buildRoom(overrides: Partial<DocumentData> = {}): DocumentData {
    const now = Timestamp.fromMillis(Date.now())
    return {
        creatorUid: CALLER_UID,
        callerUid: CALLER_UID,
        calleeUid: null,
        offer: null,
        answer: null,
        epoch: 0,
        createdAt: now,
        updatedAt: now,
        expiresAt: futureTs(60),
        ...overrides,
    }
}

export function buildLease(
    role: 'caller' | 'callee',
    ownerUid: string,
    ownerSessionId: string,
    leaseVersion = 1,
): DocumentData {
    const now = Timestamp.fromMillis(Date.now())
    return {
        role,
        ownerUid,
        ownerSessionId,
        leaseVersion,
        createdAt: now,
        updatedAt: now,
    }
}

export function buildOffer(sdp = 'v=0\no=- 1 1 IN IP4 127.0.0.1\ns=-\n'): DocumentData {
    return {
        type: 'offer',
        sdp,
        epoch: 0,
        sessionId: CALLER_SESSION,
        pcGeneration: 0,
        icePhase: 'STUN',
    }
}

export function buildAnswer(sdp = 'v=0\no=- 2 2 IN IP4 127.0.0.1\ns=-\n'): DocumentData {
    return {
        type: 'answer',
        sdp,
        epoch: 0,
        sessionId: CALLEE_SESSION,
        pcGeneration: 0,
        icePhase: 'STUN',
    }
}

export function buildCallerParticipant(overrides: Partial<DocumentData> = {}): DocumentData {
    const now = Timestamp.fromMillis(Date.now())
    return {
        uid: CALLER_UID,
        role: 'caller',
        sessionId: CALLER_SESSION,
        active: true,
        offer: null,
        answer: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    }
}

export function buildCalleeParticipant(overrides: Partial<DocumentData> = {}): DocumentData {
    const now = Timestamp.fromMillis(Date.now())
    return {
        uid: CALLEE_UID,
        role: 'callee',
        sessionId: CALLEE_SESSION,
        active: true,
        offer: null,
        answer: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    }
}

export function buildCandidate(overrides: Partial<DocumentData> = {}): DocumentData {
    return {
        candidate: 'candidate:1 1 udp 2122252543 10.0.0.2 54400 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'ufrag',
        sessionId: CALLER_SESSION,
        epoch: 0,
        pcGeneration: 0,
        gen: 0,
        icePhase: 'STUN',
        createdAt: Timestamp.fromMillis(Date.now()),
        ...overrides,
    }
}

export function buildTakeoverEvent(overrides: Partial<DocumentData> = {}): DocumentData {
    return {
        type: 'role_taken_over',
        role: 'caller',
        targetUid: CALLER_UID,
        targetSessionId: CALLER_SESSION,
        byUid: CALLEE_UID,
        bySessionId: CALLEE_SESSION,
        createdAt: Timestamp.fromMillis(Date.now()),
        ...overrides,
    }
}

export type RulesActors = {
    callerDb: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>
    calleeDb: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>
    attackerDb: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>
    unauthenticatedDb: ReturnType<
        ReturnType<RulesTestEnvironment['unauthenticatedContext']>['firestore']
    >
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

export async function seedLease(
    env: RulesTestEnvironment,
    roomId: string,
    role: 'caller' | 'callee',
    data: DocumentData,
): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'rooms', roomId, 'leases', role), data)
    })
}

export async function seedParticipant(
    env: RulesTestEnvironment,
    roomId: string,
    collectionName: 'callers' | 'callees',
    uid: string,
    data: DocumentData,
): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'rooms', roomId, collectionName, uid), data)
    })
}

export async function seedCandidate(
    env: RulesTestEnvironment,
    roomId: string,
    collectionName: 'callers' | 'callees',
    uid: string,
    candidateId: string,
    data: DocumentData,
): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
            doc(
                collection(ctx.firestore(), 'rooms', roomId, collectionName, uid, 'candidates'),
                candidateId,
            ),
            data,
        )
    })
}
