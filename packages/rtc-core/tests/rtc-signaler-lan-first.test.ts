import { afterEach, describe, expect, it, vi } from 'vitest'
import { RTCSignaler } from '../src/RTCSignaler'
import type { RoomDoc, SignalDB } from '../src/types'

const makeRoom = (): RoomDoc => ({
    creatorUid: null,
    callerUid: null,
    calleeUid: null,
    offer: null,
    answer: null,
    epoch: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
})

const makeDb = (overrides: Partial<SignalDB> = {}): SignalDB =>
    ({
        createRoom: async () => 'room-1',
        joinRoom: async () => {},
        getRoom: async () => makeRoom(),
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
    static instances: FakeRTCPeerConnection[] = []

    readonly config: RTCConfiguration
    connectionState: RTCPeerConnectionState = 'new'
    iceConnectionState: RTCIceConnectionState = 'new'
    signalingState: RTCSignalingState = 'stable'
    localDescription: RTCSessionDescription | null = null
    remoteDescription: RTCSessionDescription | null = null
    ondatachannel: ((ev: RTCDataChannelEvent) => void) | null = null
    onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null
    onnegotiationneeded: (() => void) | null = null
    private listeners = new Map<string, Array<() => void>>()

    constructor(config: RTCConfiguration) {
        this.config = config
        FakeRTCPeerConnection.instances.push(this)
    }

    addEventListener(event: string, cb: () => void): void {
        const next = this.listeners.get(event) ?? []
        next.push(cb)
        this.listeners.set(event, next)
    }

    emit(
        event: 'connectionstatechange' | 'iceconnectionstatechange' | 'signalingstatechange',
    ): void {
        for (const cb of this.listeners.get(event) ?? []) cb()
    }

    createDataChannel(label: string): RTCDataChannel {
        return new FakeDataChannel(label) as unknown as RTCDataChannel
    }

    async createOffer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'offer', sdp: 'v=0\r\n' }
    }

    async createAnswer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'answer', sdp: 'v=0\r\n' }
    }

    async setLocalDescription(desc?: RTCSessionDescriptionInit | null): Promise<void> {
        this.localDescription = (desc ?? null) as RTCSessionDescription | null
        if (desc?.type === 'offer') this.signalingState = 'have-local-offer'
        if (desc?.type === 'answer') this.signalingState = 'stable'
        this.emit('signalingstatechange')
    }

    async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
        this.remoteDescription = desc as RTCSessionDescription
        if (desc.type === 'offer') this.signalingState = 'have-remote-offer'
        if (desc.type === 'answer') this.signalingState = 'stable'
        this.emit('signalingstatechange')
    }

    async addIceCandidate(): Promise<void> {}

    close(): void {
        this.connectionState = 'closed'
        this.iceConnectionState = 'closed'
        this.signalingState = 'closed'
    }
}

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    FakeRTCPeerConnection.instances = []
})

function stubRtcSessionDescription() {
    vi.stubGlobal(
        'RTCSessionDescription',
        class {
            type: RTCSdpType
            sdp: string | null
            constructor(init: RTCSessionDescriptionInit) {
                this.type = init.type as RTCSdpType
                this.sdp = init.sdp ?? null
            }
            toJSON(): RTCSessionDescriptionInit {
                return { type: this.type, sdp: this.sdp ?? undefined }
            }
        } as unknown as typeof RTCSessionDescription,
    )
}

describe('RTCSignaler LAN_FIRST strategy', () => {
    it('rebuilds RTCPeerConnection with STUN after LAN timeout', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'LAN_FIRST',
            lanFirstTimeoutMs: 20,
        })
        await signaler.joinRoom('room-1')
        await signaler.connect()

        expect(FakeRTCPeerConnection.instances.length).toBe(1)
        expect(FakeRTCPeerConnection.instances[0].config.iceServers).toEqual([])

        await vi.advanceTimersByTimeAsync(25)

        expect(FakeRTCPeerConnection.instances.length).toBe(2)
        expect(FakeRTCPeerConnection.instances[1].config.iceServers).toEqual([
            { urls: 'stun:stun.l.google.com:19302' },
        ])
    })

    it('publishes bootstrap offer when negotiationneeded is not fired', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )
        const setOffer = vi.fn(async () => {})

        const signaler = new RTCSignaler(
            'caller',
            makeDb({
                setOffer,
            }),
            {
                connectionStrategy: 'LAN_FIRST',
                lanFirstTimeoutMs: 60_000,
            },
        )
        await signaler.joinRoom('room-bootstrap')
        await signaler.connect()

        await vi.advanceTimersByTimeAsync(1)
        expect(setOffer).toHaveBeenCalledTimes(1)
    })

    it('keeps LAN connection when connected before timeout', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'LAN_FIRST',
            lanFirstTimeoutMs: 20,
        })
        await signaler.joinRoom('room-2')
        await signaler.connect()

        const firstPc = FakeRTCPeerConnection.instances[0]
        firstPc.connectionState = 'connected'
        firstPc.emit('connectionstatechange')

        await vi.advanceTimersByTimeAsync(25)
        expect(FakeRTCPeerConnection.instances.length).toBe(1)
    })

    it('forces hard reconnect when caller is stuck in connecting', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'LAN_FIRST',
            lanFirstTimeoutMs: 60_000,
        })
        await signaler.joinRoom('room-3')
        await signaler.connect()

        const reconnectHard = vi.fn().mockResolvedValue(undefined)
        ;(signaler as any).reconnectHard = reconnectHard

        const pc = FakeRTCPeerConnection.instances[0]
        pc.connectionState = 'connecting'
        pc.emit('connectionstatechange')

        await vi.advanceTimersByTimeAsync(6_600)
        expect(reconnectHard).toHaveBeenCalledTimes(1)
    })

    it('does not poison remote generation from echoed answer', async () => {
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )
        stubRtcSessionDescription()

        let offerCb:
            | ((offer: RTCSessionDescriptionInit & { pcGeneration?: number }) => void)
            | undefined
        let answerCb:
            | ((answer: RTCSessionDescriptionInit & { pcGeneration?: number }) => void)
            | undefined
        const setAnswer = vi.fn(async () => {})
        const setRemoteSpy = vi.spyOn(FakeRTCPeerConnection.prototype, 'setRemoteDescription')

        const signaler = new RTCSignaler(
            'callee',
            makeDb({
                setAnswer,
                subscribeOnOffer: (cb) => {
                    offerCb = cb as (
                        offer: RTCSessionDescriptionInit & { pcGeneration?: number },
                    ) => void
                    return () => {}
                },
                subscribeOnAnswer: (cb) => {
                    answerCb = cb as (
                        answer: RTCSessionDescriptionInit & { pcGeneration?: number },
                    ) => void
                    return () => {}
                },
            }),
            {
                connectionStrategy: 'LAN_FIRST',
                lanFirstTimeoutMs: 60_000,
            },
        )

        await signaler.joinRoom('room-generation-echo')
        await signaler.connect()

        offerCb?.({
            type: 'offer',
            sdp: 'v=0\r\no=caller 1 1 IN IP4 0.0.0.0\r\n',
            pcGeneration: 1,
        })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        answerCb?.({
            type: 'answer',
            sdp: 'v=0\r\no=callee 99 99 IN IP4 0.0.0.0\r\n',
            pcGeneration: 99,
        })
        await Promise.resolve()
        await Promise.resolve()

        offerCb?.({
            type: 'offer',
            sdp: 'v=0\r\no=caller 2 2 IN IP4 0.0.0.0\r\n',
            pcGeneration: 2,
        })
        await Promise.resolve()
        await Promise.resolve()

        const offerSdps = setRemoteSpy.mock.calls
            .map(([desc]) => (desc as RTCSessionDescriptionInit | undefined)?.sdp ?? '')
            .filter((sdp) => sdp.includes('o=caller'))
        expect(offerSdps).toContain('v=0\r\no=caller 2 2 IN IP4 0.0.0.0\r\n')
        expect(offerSdps.length).toBeGreaterThanOrEqual(2)
    })

    it('rebuilds callee peer when remote offer generation is ahead in STUN phase', async () => {
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )
        stubRtcSessionDescription()

        let offerCb:
            | ((offer: RTCSessionDescriptionInit & { pcGeneration?: number }) => void)
            | undefined

        const signaler = new RTCSignaler(
            'callee',
            makeDb({
                subscribeOnOffer: (cb) => {
                    offerCb = cb as (
                        offer: RTCSessionDescriptionInit & { pcGeneration?: number },
                    ) => void
                    return () => {}
                },
            }),
            {
                connectionStrategy: 'DEFAULT',
            },
        )

        await signaler.joinRoom('room-callee-generation-sync')
        await signaler.connect()
        expect(FakeRTCPeerConnection.instances.length).toBe(1)

        offerCb?.({
            type: 'offer',
            sdp: 'v=0\r\no=caller 3 3 IN IP4 0.0.0.0\r\n',
            pcGeneration: 2,
        })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        expect(FakeRTCPeerConnection.instances.length).toBe(2)
    })

    it('caller ignores stale answers by forPcGeneration marker', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )
        stubRtcSessionDescription()

        let answerCb:
            | ((
                  answer: RTCSessionDescriptionInit & {
                      pcGeneration?: number
                      forPcGeneration?: number
                  },
              ) => void)
            | undefined
        const setRemoteSpy = vi.spyOn(FakeRTCPeerConnection.prototype, 'setRemoteDescription')

        const signaler = new RTCSignaler(
            'caller',
            makeDb({
                subscribeOnAnswer: (cb) => {
                    answerCb = cb as (
                        answer: RTCSessionDescriptionInit & {
                            pcGeneration?: number
                            forPcGeneration?: number
                        },
                    ) => void
                    return () => {}
                },
            }),
            {
                connectionStrategy: 'LAN_FIRST',
                lanFirstTimeoutMs: 20,
            },
        )

        await signaler.joinRoom('room-answer-generation')
        await signaler.connect()
        await vi.advanceTimersByTimeAsync(25)
        const baselineCalls = setRemoteSpy.mock.calls.length

        answerCb?.({
            type: 'answer',
            sdp: 'v=0\r\no=callee stale 1 1 IN IP4 0.0.0.0\r\n',
            pcGeneration: 1,
            forPcGeneration: 1,
        })
        await vi.advanceTimersByTimeAsync(1)
        expect(setRemoteSpy.mock.calls.length).toBe(baselineCalls)

        answerCb?.({
            type: 'answer',
            sdp: 'v=0\r\no=callee fresh 2 2 IN IP4 0.0.0.0\r\n',
            pcGeneration: 2,
            forPcGeneration: 2,
        })
        await vi.advanceTimersByTimeAsync(1)
        expect(setRemoteSpy.mock.calls.length).toBe(baselineCalls + 1)
    })
})
