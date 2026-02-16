import { afterEach, describe, expect, it, vi } from 'vitest'
import { RTCErrorCode, toRTCError } from '../src/errors'
import { RTCSignaler } from '../src/RTCSignaler'
import type { RoomDoc, SignalDB } from '../src/types'

const makeDb = (overrides: Partial<SignalDB> = {}): SignalDB =>
    ({
        createRoom: async () => 'room-1',
        joinRoom: async () => {},
        getRoom: async () => null,
        getOffer: async () => null,
        setOffer: async () => {},
        clearOffer: async () => {},
        setAnswer: async () => {},
        clearAnswer: async () => {},
        addCallerIceCandidate: async () => {},
        addCalleeIceCandidate: async () => {},
        subscribeOnCallerIceCandidate: () => () => {},
        subscribeOnCalleeIceCandidate: () => () => {},
        subscribeOnOffer: () => () => {},
        subscribeOnAnswer: () => () => {},
        clearCallerCandidates: async () => {},
        clearCalleeCandidates: async () => {},
        endRoom: async () => {},
        ...overrides,
    }) as SignalDB

class FakeDataChannel {
    label: string
    readyState: RTCDataChannelState = 'connecting'
    bufferedAmount = 0
    bufferedAmountLowThreshold = 0
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null

    constructor(label: string) {
        this.label = label
    }

    addEventListener(): void {}
    removeEventListener(): void {}
    send(): void {}
    close(): void {
        this.readyState = 'closed'
        this.onclose?.()
    }
}

class FakeRTCPeerConnection {
    connectionState: RTCPeerConnectionState = 'new'
    iceConnectionState: RTCIceConnectionState = 'new'
    signalingState: RTCSignalingState = 'stable'
    localDescription: RTCSessionDescription | null = null
    remoteDescription: RTCSessionDescription | null = null
    ondatachannel: ((ev: RTCDataChannelEvent) => void) | null = null
    onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null
    onnegotiationneeded: (() => void) | null = null

    addEventListener(): void {}
    createDataChannel(label: string): RTCDataChannel {
        return new FakeDataChannel(label) as unknown as RTCDataChannel
    }
    close(): void {
        this.connectionState = 'closed'
        this.iceConnectionState = 'closed'
        this.signalingState = 'closed'
    }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

async function expectRejectsMatch(promise: Promise<unknown>, expected: Record<string, unknown>) {
    try {
        await promise
    } catch (error) {
        expect(error).toMatchObject(expected)
        return
    }
    throw new Error('Expected promise to reject')
}

describe('RTCError mapping', () => {
    it('maps room-not-selected and timeout errors', async () => {
        const s = new RTCSignaler('caller', makeDb())

        await expectRejectsMatch(s.connect(), {
            code: RTCErrorCode.ROOM_NOT_SELECTED,
        })

        await expectRejectsMatch(s.waitReady({ timeoutMs: 1 }), {
            code: RTCErrorCode.WAIT_READY_TIMEOUT,
        })
    })

    it('returns typed timeout metadata from waitReady', async () => {
        const s = new RTCSignaler('caller', makeDb())
        await expectRejectsMatch(s.waitReady({ timeoutMs: 1 }), {
            code: RTCErrorCode.WAIT_READY_TIMEOUT,
            phase: 'transport',
            retriable: true,
            details: expect.objectContaining({ timeoutMs: 1 }),
        })
    })

    it('uses configured default timeout for waitReady', async () => {
        const s = new RTCSignaler('caller', makeDb(), { waitReadyTimeoutMs: 2 })
        await expectRejectsMatch(s.waitReady(), {
            code: RTCErrorCode.WAIT_READY_TIMEOUT,
            details: expect.objectContaining({ timeoutMs: 2 }),
        })
    })

    it('throws room-not-found when room does not exist on connect', async () => {
        const s = new RTCSignaler('caller', makeDb({ getRoom: async () => null }))
        await s.joinRoom('missing-room')
        await expectRejectsMatch(s.connect(), {
            code: RTCErrorCode.ROOM_NOT_FOUND,
        })
    })

    it('maps DB failures on createRoom', async () => {
        const s = new RTCSignaler(
            'caller',
            makeDb({
                createRoom: async () => {
                    throw new Error('db unavailable')
                },
            }),
        )

        await expectRejectsMatch(s.createRoom(), {
            code: RTCErrorCode.DB_UNAVAILABLE,
        })
    })

    it('bubbles WAIT_READY_TIMEOUT from reconnectHard when channel never becomes ready', async () => {
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const s = new RTCSignaler(
            'caller',
            makeDb({
                getRoom: async () =>
                    ({
                        creatorUid: null,
                        callerUid: null,
                        calleeUid: null,
                        offer: null,
                        answer: null,
                        epoch: 0,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        expiresAt: Date.now() + 60_000,
                    }) as RoomDoc,
            }),
        )

        await s.joinRoom('room-timeout')
        await expectRejectsMatch(s.reconnectHard({ awaitReadyMs: 1 }), {
            code: RTCErrorCode.WAIT_READY_TIMEOUT,
            phase: 'transport',
            retriable: true,
        })
    })

    it('classifies auth-required errors', () => {
        const err = toRTCError(new Error('Auth required'), {
            fallbackCode: RTCErrorCode.UNKNOWN,
        })
        expect(err.code).toBe(RTCErrorCode.AUTH_REQUIRED)
    })
})
