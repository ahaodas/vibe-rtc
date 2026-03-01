import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FBAdapter } from '../../src/FBAdapter'

const firestoreMocks = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn((_col: unknown, id: string) => ({ id })),
    deleteDoc: vi.fn(),
    getDoc: vi.fn(),
    getDocFromServer: vi.fn(),
    getDocs: vi.fn(),
    increment: vi.fn((n: number) => n),
    onSnapshot: vi.fn(),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => 'server-ts'),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
}))

vi.mock('firebase/firestore', () => firestoreMocks)

type FakeDocChange = {
    type: 'added' | 'modified' | 'removed'
    doc: { id: string; data: () => RTCIceCandidateInit & { epoch?: number; pcGeneration?: number } }
}

const makeChange = (
    type: FakeDocChange['type'],
    id: string,
    data: RTCIceCandidateInit & { epoch?: number; pcGeneration?: number },
): FakeDocChange => ({
    type,
    doc: {
        id,
        data: () => data,
    },
})

const makeAdapter = () => {
    const adapter = new FBAdapter({} as never, { currentUser: { uid: 'u1' } } as never)
    ;(adapter as unknown as { callerCol?: unknown }).callerCol = { id: 'caller-col' }
    ;(adapter as unknown as { calleeCol?: unknown }).calleeCol = { id: 'callee-col' }
    ;(adapter as unknown as { roomEpoch: number }).roomEpoch = 7
    return adapter
}

describe('FBAdapter ICE subscriptions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('delivers modified candidate updates and dedupes identical payload by doc id', () => {
        const adapter = makeAdapter()
        let snapCb: ((snap: { docChanges: () => FakeDocChange[] }) => void) | undefined
        const innerUnsub = vi.fn()
        firestoreMocks.onSnapshot.mockImplementationOnce((_col, cb) => {
            snapCb = cb as (snap: { docChanges: () => FakeDocChange[] }) => void
            return innerUnsub
        })

        const received: Array<RTCIceCandidateInit & { epoch?: number; pcGeneration?: number }> = []
        const unsub = adapter.subscribeOnCallerIceCandidate((ice) => received.push(ice))
        expect(firestoreMocks.onSnapshot).toHaveBeenCalledTimes(1)

        const base = {
            candidate: 'candidate:a 1 udp 2113937151 10.0.0.1 5000 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
            epoch: 2,
            pcGeneration: 1,
        }

        snapCb?.({ docChanges: () => [makeChange('added', 'doc-1', base)] })
        expect(received).toHaveLength(1)

        snapCb?.({ docChanges: () => [makeChange('modified', 'doc-1', base)] })
        expect(received).toHaveLength(1)

        const updated = { ...base, pcGeneration: 2 }
        snapCb?.({ docChanges: () => [makeChange('modified', 'doc-1', updated)] })
        expect(received).toHaveLength(2)

        snapCb?.({ docChanges: () => [makeChange('removed', 'doc-1', updated)] })
        snapCb?.({ docChanges: () => [makeChange('added', 'doc-1', updated)] })
        expect(received).toHaveLength(3)

        unsub()
        expect(innerUnsub).toHaveBeenCalledTimes(1)
    })

    it('stores epoch and pcGeneration from candidate payload (with roomEpoch fallback)', async () => {
        const adapter = makeAdapter()

        const withEpoch = {
            candidate: 'candidate:b 1 udp 2113937151 10.0.0.2 5001 typ srflx',
            sdpMid: '0',
            sdpMLineIndex: 0,
            epoch: 11,
            pcGeneration: 4,
        }
        await adapter.addCallerIceCandidate(withEpoch as never)
        expect(firestoreMocks.setDoc).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({
                candidate: withEpoch.candidate,
                epoch: 11,
                pcGeneration: 4,
                createdAt: 'server-ts',
            }),
            { merge: true },
        )

        const withoutEpoch = {
            candidate: 'candidate:c 1 udp 2113937151 10.0.0.3 5002 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
            pcGeneration: 5,
        }
        await adapter.addCallerIceCandidate(withoutEpoch as never)
        expect(firestoreMocks.setDoc).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({
                candidate: withoutEpoch.candidate,
                epoch: 7,
                pcGeneration: 5,
                createdAt: 'server-ts',
            }),
            { merge: true },
        )
    })
})
