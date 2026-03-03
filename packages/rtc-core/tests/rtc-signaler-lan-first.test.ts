import { afterEach, describe, expect, it, vi } from 'vitest'
import { RTCError, RTCErrorCode } from '../src/errors'
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

    it('keeps native browser ICE behavior when BROWSER_NATIVE strategy is used', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'BROWSER_NATIVE',
            lanFirstTimeoutMs: 20,
            rtcConfiguration: {
                iceServers: [
                    { urls: ['stun:stun1.example.com:3478', 'turn:turn.example.com:3478'] },
                    {
                        urls: 'turns:turn.example.com:5349?transport=tcp',
                        username: 'u',
                        credential: 'c',
                    },
                ],
            },
        })
        await signaler.joinRoom('room-browser-native')
        await signaler.connect()

        expect(FakeRTCPeerConnection.instances.length).toBe(1)
        expect(FakeRTCPeerConnection.instances[0].config.iceServers).toEqual([
            { urls: ['stun:stun1.example.com:3478', 'turn:turn.example.com:3478'] },
            {
                urls: 'turns:turn.example.com:5349?transport=tcp',
                username: 'u',
                credential: 'c',
            },
        ])

        await vi.advanceTimersByTimeAsync(25)
        expect(FakeRTCPeerConnection.instances.length).toBe(1)
    })

    it('uses strict LAN -> STUN_ONLY -> TURN_ENABLED sequence when TURN servers are configured', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'LAN_FIRST',
            lanFirstTimeoutMs: 20,
            stunOnlyTimeoutMs: 30,
            rtcConfiguration: {
                iceServers: [
                    { urls: ['stun:stun1.example.com:3478', 'turn:turn.example.com:3478'] },
                    {
                        urls: 'turns:turn.example.com:5349?transport=tcp',
                        username: 'u',
                        credential: 'c',
                    },
                ],
            },
        })
        await signaler.joinRoom('room-3phase')
        await signaler.connect()

        expect(FakeRTCPeerConnection.instances.length).toBe(1)
        expect(FakeRTCPeerConnection.instances[0].config.iceServers).toEqual([])

        await vi.advanceTimersByTimeAsync(25)
        expect(FakeRTCPeerConnection.instances.length).toBe(2)
        expect(FakeRTCPeerConnection.instances[1].config.iceServers).toEqual([
            { urls: ['stun:stun1.example.com:3478'] },
        ])
        expect(FakeRTCPeerConnection.instances[1].config.iceTransportPolicy).toBe('all')

        await vi.advanceTimersByTimeAsync(35)
        expect(FakeRTCPeerConnection.instances.length).toBe(3)
        expect(FakeRTCPeerConnection.instances[2].config.iceServers).toEqual([
            { urls: ['turn:turn.example.com:3478'] },
            {
                urls: 'turns:turn.example.com:5349?transport=tcp',
                username: 'u',
                credential: 'c',
            },
        ])
        expect(FakeRTCPeerConnection.instances[2].config.iceTransportPolicy).toBe('all')
    })

    it('keeps STUN_ONLY phase when TURN servers are not configured', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'LAN_FIRST',
            lanFirstTimeoutMs: 20,
            stunOnlyTimeoutMs: 30,
            rtcConfiguration: {
                iceServers: [{ urls: 'stun:stun1.example.com:3478' }],
            },
        })
        await signaler.joinRoom('room-no-turn')
        await signaler.connect()

        await vi.advanceTimersByTimeAsync(25)
        expect(FakeRTCPeerConnection.instances.length).toBe(2)
        expect(FakeRTCPeerConnection.instances[1].config.iceServers).toEqual([
            { urls: 'stun:stun1.example.com:3478' },
        ])

        await vi.advanceTimersByTimeAsync(3_000)
        expect(FakeRTCPeerConnection.instances.length).toBe(2)
    })

    it('does not switch to TURN_ENABLED immediately on STUN_ONLY disconnected', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'LAN_FIRST',
            lanFirstTimeoutMs: 20,
            stunOnlyTimeoutMs: 30,
            rtcConfiguration: {
                iceServers: [
                    { urls: 'stun:stun1.example.com:3478' },
                    { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' },
                ],
            },
        })
        await signaler.joinRoom('room-disconnected-grace')
        await signaler.connect()
        await vi.advanceTimersByTimeAsync(25)
        expect(FakeRTCPeerConnection.instances.length).toBe(2)

        const stunPc = FakeRTCPeerConnection.instances[1]
        stunPc.connectionState = 'disconnected'
        stunPc.emit('connectionstatechange')

        await vi.advanceTimersByTimeAsync(500)
        expect(FakeRTCPeerConnection.instances.length).toBe(2)

        await vi.advanceTimersByTimeAsync(1_400)
        expect(FakeRTCPeerConnection.instances.length).toBe(3)
        expect(FakeRTCPeerConnection.instances[2].config.iceTransportPolicy).toBe('all')
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

    it('uses longer connecting watchdog timeout in STUN phase', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'DEFAULT',
        })
        await signaler.joinRoom('room-stun-watchdog')
        await signaler.connect()

        const reconnectHard = vi.fn().mockResolvedValue(undefined)
        ;(signaler as any).reconnectHard = reconnectHard

        const pc = FakeRTCPeerConnection.instances[0]
        pc.connectionState = 'connecting'
        pc.emit('connectionstatechange')

        await vi.advanceTimersByTimeAsync(6_600)
        expect(reconnectHard).toHaveBeenCalledTimes(0)

        await vi.advanceTimersByTimeAsync(23_600)
        expect(reconnectHard).toHaveBeenCalledTimes(1)
    })

    it('limits TURN-enabled connecting watchdog hard reconnect attempts', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'DEFAULT',
            rtcConfiguration: {
                iceServers: [
                    {
                        urls: ['turn:turn.example.com:3478'],
                        username: 'u',
                        credential: 'c',
                    },
                ],
            },
        })
        await signaler.joinRoom('room-stun-watchdog-limit')
        await signaler.connect()

        const reconnectHard = vi.fn().mockResolvedValue(undefined)
        ;(signaler as any).reconnectHard = reconnectHard

        const pc = FakeRTCPeerConnection.instances[0]
        pc.connectionState = 'connecting'

        pc.emit('connectionstatechange')
        await vi.advanceTimersByTimeAsync(30_100)
        expect(reconnectHard).toHaveBeenCalledTimes(1)

        pc.emit('connectionstatechange')
        await vi.advanceTimersByTimeAsync(30_100)
        expect(reconnectHard).toHaveBeenCalledTimes(2)

        pc.emit('connectionstatechange')
        await vi.advanceTimersByTimeAsync(30_100)
        expect(reconnectHard).toHaveBeenCalledTimes(2)
    })

    it('does not surface WAIT_READY_TIMEOUT from automatic hard reconnect', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )

        const signaler = new RTCSignaler('caller', makeDb(), {
            connectionStrategy: 'DEFAULT',
        })
        const onError = vi.fn()
        signaler.setErrorHandler(onError)

        await signaler.joinRoom('room-hard-timeout-suppressed')
        await signaler.connect()

        ;(signaler as any).reconnectHard = vi.fn().mockRejectedValue(
            new RTCError(RTCErrorCode.WAIT_READY_TIMEOUT, {
                message: 'waitReady timeout',
                phase: 'transport',
                retriable: true,
            }),
        )

        const pc = FakeRTCPeerConnection.instances[0]
        pc.connectionState = 'failed'
        pc.emit('connectionstatechange')
        await Promise.resolve()
        await Promise.resolve()

        expect(onError).toHaveBeenCalledTimes(0)
    })

    it('rebuilds callee peer when remote offer session changes', async () => {
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

        await signaler.joinRoom('room-callee-session-sync')
        await signaler.connect()
        expect(FakeRTCPeerConnection.instances.length).toBe(1)

        offerCb?.({
            type: 'offer',
            sdp: 'v=0\r\no=caller 3 3 IN IP4 0.0.0.0\r\n',
            sessionId: 'sess-a',
        })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        expect(FakeRTCPeerConnection.instances.length).toBe(2)
        offerCb?.({
            type: 'offer',
            sdp: 'v=0\r\no=caller 4 4 IN IP4 0.0.0.0\r\n',
            sessionId: 'sess-b',
        })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        expect(FakeRTCPeerConnection.instances.length).toBe(3)
    })

    it('ignores stale offers from previously seen sessions', async () => {
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )
        stubRtcSessionDescription()

        let offerCb:
            | ((offer: RTCSessionDescriptionInit & { sessionId?: string }) => void)
            | undefined

        const signaler = new RTCSignaler(
            'callee',
            makeDb({
                subscribeOnOffer: (cb) => {
                    offerCb = cb as (
                        offer: RTCSessionDescriptionInit & { sessionId?: string },
                    ) => void
                    return () => {}
                },
            }),
            {
                connectionStrategy: 'DEFAULT',
            },
        )

        await signaler.joinRoom('room-stale-session-ignore')
        await signaler.connect()
        expect(FakeRTCPeerConnection.instances.length).toBe(1)

        offerCb?.({
            type: 'offer',
            sdp: 'v=0\r\no=caller 1 1 IN IP4 0.0.0.0\r\n',
            sessionId: 'sess-a',
        })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        expect(FakeRTCPeerConnection.instances.length).toBe(2)

        offerCb?.({
            type: 'offer',
            sdp: 'v=0\r\no=caller 2 2 IN IP4 0.0.0.0\r\n',
            sessionId: 'sess-b',
        })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        expect(FakeRTCPeerConnection.instances.length).toBe(3)

        offerCb?.({
            type: 'offer',
            sdp: 'v=0\r\no=caller stale 9 9 IN IP4 0.0.0.0\r\n',
            sessionId: 'sess-a',
        })
        await Promise.resolve()
        await Promise.resolve()
        expect(FakeRTCPeerConnection.instances.length).toBe(3)
    })

    it('caller ignores stale answers by sessionId marker', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'RTCPeerConnection',
            FakeRTCPeerConnection as unknown as typeof RTCPeerConnection,
        )
        stubRtcSessionDescription()

        let answerCb:
            | ((
                  answer: RTCSessionDescriptionInit & {
                      sessionId?: string
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
                            sessionId?: string
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
        const currentSessionId = (signaler as any).sessionId as string

        answerCb?.({
            type: 'answer',
            sdp: 'v=0\r\no=callee stale 1 1 IN IP4 0.0.0.0\r\n',
            sessionId: 'stale-session',
        })
        await vi.advanceTimersByTimeAsync(1)
        expect(setRemoteSpy.mock.calls.length).toBe(baselineCalls)

        answerCb?.({
            type: 'answer',
            sdp: 'v=0\r\no=callee fresh 2 2 IN IP4 0.0.0.0\r\n',
            sessionId: currentSessionId,
        })
        await vi.advanceTimersByTimeAsync(1)
        expect(setRemoteSpy.mock.calls.length).toBe(baselineCalls + 1)
    })
})
