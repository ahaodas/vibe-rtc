import type { SignalDB, OfferSDP, AnswerSDP } from './types'

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

type Unsub = () => void
export type Role = 'caller' | 'callee'

export interface RTCSignalerOptions {
    rtcConfiguration?: RTCConfiguration
    fastLabel?: string
    reliableLabel?: string
    fastInit?: RTCDataChannelInit
    reliableInit?: RTCDataChannelInit
    fastBufferedAmountLowThreshold?: number
    reliableBufferedAmountLowThreshold?: number
    onMessage?: (text: string, meta: { reliable: boolean }) => void
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void
    onFastOpen?: () => void
    onFastClose?: () => void
    onReliableOpen?: () => void
    onReliableClose?: () => void
    onError?: (err: unknown) => void
}

export class RTCSignaler {
    private pc!: RTCPeerConnection
    private dcFast?: RTCDataChannel
    private dcReliable?: RTCDataChannel

    private makingOffer = false
    private polite: boolean

    private roomId: string | null = null
    private unsubscribes: Unsub[] = []

    private readonly rtcConfig: RTCConfiguration
    private readonly fastLabel: string
    private readonly reliableLabel: string
    private readonly fastInit: RTCDataChannelInit
    private readonly reliableInit: RTCDataChannelInit
    private readonly fastBALow: number
    private readonly reliableBALow: number

    // perfect negotiation helpers
    private lastHandledOfferSdp: string | null = null
    private answering = false

    // callbacks
    private onMessage: (t: string, meta: { reliable: boolean }) => void
    private onConnectionStateChange: (s: RTCPeerConnectionState) => void
    private onFastOpen: () => void
    private onFastClose: () => void
    private onReliableOpen: () => void
    private onReliableClose: () => void
    private onError: (e: unknown) => void

    constructor(
        private readonly role: Role,
        private readonly signalDb: SignalDB,
        opts: RTCSignalerOptions = {},
    ) {
        this.polite = role === 'callee'
        this.rtcConfig = opts.rtcConfiguration ?? {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        }

        this.fastLabel = opts.fastLabel ?? 'fast'
        this.reliableLabel = opts.reliableLabel ?? 'reliable'
        this.fastInit = { ordered: false, maxRetransmits: 0, ...(opts.fastInit ?? {}) }
        this.reliableInit = { ordered: true, ...(opts.reliableInit ?? {}) }
        this.fastBALow = opts.fastBufferedAmountLowThreshold ?? 64 * 1024
        this.reliableBALow = opts.reliableBufferedAmountLowThreshold ?? 256 * 1024

        this.onMessage = opts.onMessage ?? (() => {})
        this.onConnectionStateChange = opts.onConnectionStateChange ?? (() => {})
        this.onFastOpen = opts.onFastOpen ?? (() => {})
        this.onFastClose = opts.onFastClose ?? (() => {})
        this.onReliableOpen = opts.onReliableOpen ?? (() => {})
        this.onReliableClose = opts.onReliableClose ?? (() => {})
        this.onError = opts.onError ?? ((e) => console.error('[RTCSignaler]', e))
    }

    // ---------- public API ----------

    async createRoom(): Promise<string> {
        const id = await this.signalDb.createRoom()
        this.roomId = id
        return id
    }

    async joinRoom(id: string): Promise<void> {
        this.roomId = id
        await this.signalDb.joinRoom(id)
    }

    async connect(): Promise<void> {
        if (!this.roomId) throw new Error('Room not selected')
        this.initPeer()

        // подписки на УДАЛЁННЫЕ ICE-кандидаты (крест-накрест!)
        if (this.role === 'callee') {
            this.unsubscribes.push(
                this.signalDb.subscribeOnCallerIceCandidate(async (c) => {
                    try {
                        await this.pc.addIceCandidate(c)
                    } catch (e) {
                        this.onError(e)
                    }
                }),
            )
        } else {
            this.unsubscribes.push(
                this.signalDb.subscribeOnCalleeIceCandidate(async (c) => {
                    try {
                        await this.pc.addIceCandidate(c)
                    } catch (e) {
                        this.onError(e)
                    }
                }),
            )
        }

        // оффер → answer (perfect negotiation + идемпотентность)
        this.unsubscribes.push(
            this.signalDb.subscribeOnOffer(async (offer) => {
                try {
                    const desc = new RTCSessionDescription(offer)
                    if (desc.type !== 'offer') return
                    if (desc.sdp && desc.sdp === this.lastHandledOfferSdp) return

                    const collision = this.makingOffer || this.pc.signalingState !== 'stable'
                    if (collision) {
                        if (!this.polite) return
                        try {
                            await this.pc.setLocalDescription({ type: 'rollback' } as any)
                        } catch {}
                    }

                    await this.pc.setRemoteDescription(desc)
                    if (this.pc.signalingState !== 'have-remote-offer') return
                    if (this.answering) return
                    this.answering = true
                    this.lastHandledOfferSdp = desc.sdp ?? null

                    const answer = await this.pc.createAnswer()
                    await this.pc.setLocalDescription(answer)
                    await this.signalDb.setAnswer(answer as AnswerSDP)
                } catch (e) {
                    this.onError(e)
                } finally {
                    this.answering = false
                }
            }),
        )

        // answer
        this.unsubscribes.push(
            this.signalDb.subscribeOnAnswer(async (answer) => {
                try {
                    const desc = new RTCSessionDescription(answer)
                    if (desc.type !== 'answer') return
                    await this.pc.setRemoteDescription(desc)
                } catch (e) {
                    this.onError(e)
                }
            }),
        )
        // только callee проверяет оффер в БД после подписки (replay)
        if (this.role === 'callee') {
            const off = await this.signalDb.getOffer()
            if (off && off.type === 'offer' && off.sdp !== this.lastHandledOfferSdp) {
                // переиспользуем общий обработчик — публикуем его ещё раз
                await this.signalDb.setOffer(off as OfferSDP)
            }
        }
    }

    async sendFast(text: string) {
        let dc = this.dcFast
        if (!dc || dc.readyState !== 'open') {
            dc = await this.waitChannelOpen(() => this.dcFast)
        }
        await this.backpressure(dc, this.fastBALow)
        dc.send(text)
    }

    async sendReliable(text: string) {
        let dc = this.dcReliable
        if (!dc || dc.readyState !== 'open') {
            dc = await this.waitChannelOpen(() => this.dcReliable)
        }
        await this.backpressure(dc, this.reliableBALow)
        dc.send(text)
    }

    async reconnectSoft(): Promise<void> {
        if (!this.roomId) throw new Error('Room not selected')
        const offer = await this.pc.createOffer({ iceRestart: true })
        await this.pc.setLocalDescription(offer)
        await this.signalDb.setOffer(offer as OfferSDP)
    }

    async reconnectHard(opts: { awaitReadyMs?: number; resetSdp?: boolean } = {}) {
        if (!this.roomId) throw new Error('Room not selected')

        // 1) закрываем старые каналы/PC (подписки оставляем — они привязаны к this, не к старому PC)
        this.cleanupPeerOnly()

        // 2) сбрасываем флаги perfect-negotiation
        this.lastHandledOfferSdp = null
        this.answering = false

        // 3) ВАЖНО: чистим кандидатов в БД, иначе прилетит реплей старых "added"
        try {
            await this.signalDb.clearCallerCandidates()
            await this.signalDb.clearCalleeCandidates()
            await this.signalDb.clearOffer()
            await this.signalDb.clearAnswer()
        } catch (e) {
            // не критично, идём дальше; просто лог
            console.warn('[RTCSignaler] reconnectHard: clear candidates failed', e)
        }

        // 4) создаём новый PC + data-channels
        this.initPeer()

        // 5) НЕ делаем ручной createOffer()!
        // onnegotiationneeded сработает сам (caller создаёт 2 канала → оффер уйдёт)
        // callee ответит через подписку на offer → setRemote + answer

        // 6) ждём полной готовности (connected + оба DC open),
        //    чтобы метод вернулся только когда можно снова отправлять
        const waitMs = opts.awaitReadyMs ?? 15000
        await this.waitReady({ timeoutMs: waitMs })
    }

    async hangup(): Promise<void> {
        this.unsubscribes.forEach((u) => {
            try {
                u()
            } catch {}
        })
        this.unsubscribes = []
        this.cleanupPeerOnly()
    }

    async endRoom(): Promise<void> {
        await this.hangup()
        try {
            await this.signalDb.endRoom()
        } catch {}
        this.roomId = null
    }

    get currentRoomId() {
        return this.roomId
    }

    // ---------- setters (возвращают отписку) ----------

    setMessageHandler(cb: (t: string, meta: { reliable: boolean }) => void): Unsub {
        this.onMessage = cb
        return () => {
            this.onMessage = () => {}
        }
    }

    setConnectionStateHandler(cb: (s: RTCPeerConnectionState) => void): Unsub {
        this.onConnectionStateChange = cb
        return () => {
            this.onConnectionStateChange = () => {}
        }
    }

    setFastOpenHandler(cb: () => void): Unsub {
        this.onFastOpen = cb
        return () => {
            this.onFastOpen = () => {}
        }
    }

    setFastCloseHandler(cb: () => void): Unsub {
        this.onFastClose = cb
        return () => {
            this.onFastClose = () => {}
        }
    }

    setReliableOpenHandler(cb: () => void): Unsub {
        this.onReliableOpen = cb
        return () => {
            this.onReliableOpen = () => {}
        }
    }

    setReliableCloseHandler(cb: () => void): Unsub {
        this.onReliableClose = cb
        return () => {
            this.onReliableClose = () => {}
        }
    }

    setErrorHandler(cb: (e: unknown) => void): Unsub {
        this.onError = cb
        return () => {
            this.onError = (e) => console.error('[RTCSignaler]', e)
        }
    }

    // ---------- internals ----------

    private initPeer() {
        this.pc = new RTCPeerConnection(this.rtcConfig)

        if (this.role === 'caller') {
            this.dcFast = this.pc.createDataChannel(this.fastLabel, this.fastInit)
            this.setupChannel(this.dcFast, false)

            this.dcReliable = this.pc.createDataChannel(this.reliableLabel, this.reliableInit)
            this.setupChannel(this.dcReliable, true)
        } else {
            this.pc.ondatachannel = (ev) => {
                const ch = ev.channel
                const rel = ch.label === this.reliableLabel
                if (rel) this.dcReliable = ch
                else this.dcFast = ch
                this.setupChannel(ch, rel)
            }
        }

        this.pc.onconnectionstatechange = () =>
            this.onConnectionStateChange(this.pc.connectionState)

        // свои ICE → SignalDB
        this.pc.onicecandidate = async (ev) => {
            if (!ev.candidate) return
            try {
                if (this.role === 'caller') await this.signalDb.addCallerIceCandidate(ev.candidate)
                else await this.signalDb.addCalleeIceCandidate(ev.candidate)
            } catch (e) {
                this.onError(e)
            }
        }

        // инициаторский оффер — только через onnegotiationneeded, без ручных дублей
        this.pc.onnegotiationneeded = async () => {
            try {
                this.makingOffer = true
                const offer = await this.pc.createOffer()
                await this.pc.setLocalDescription(offer)
                await this.signalDb.setOffer(offer as OfferSDP)
            } catch (e) {
                this.onError(e)
            } finally {
                this.makingOffer = false
            }
        }
    }

    private setupChannel(ch: RTCDataChannel, reliable: boolean) {
        try {
            ch.bufferedAmountLowThreshold = reliable ? this.reliableBALow : this.fastBALow
        } catch {}
        ch.onopen = () => (reliable ? this.onReliableOpen() : this.onFastOpen())
        ch.onclose = () => (reliable ? this.onReliableClose() : this.onFastClose())
        ch.onmessage = (ev) => {
            const text = typeof ev.data === 'string' ? ev.data : String(ev.data)
            this.onMessage(text, { reliable })
        }
    }

    private ensureOpen(dc?: RTCDataChannel): RTCDataChannel {
        if (!dc || dc.readyState !== 'open') throw new Error('DataChannel is not open')
        return dc
    }

    private async waitChannelOpen(pick: () => RTCDataChannel | undefined, timeoutMs = 8000) {
        const t0 = Date.now()
        while (Date.now() - t0 < timeoutMs) {
            const dc = pick()
            if (dc && dc.readyState === 'open') return dc
            await new Promise((r) => setTimeout(r, 50))
        }
        throw new Error('DataChannel is not open')
    }

    private async backpressure(dc: RTCDataChannel, low: number) {
        if (dc.bufferedAmount > low) {
            await new Promise<void>((res) => {
                const h = () => {
                    dc.removeEventListener('bufferedamountlow', h)
                    res()
                }
                dc.addEventListener('bufferedamountlow', h, { once: true })
            })
        }
    }

    async waitReady(opts: { timeoutMs?: number } = {}) {
        const timeoutMs = opts.timeoutMs ?? 15000
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const s = this.inspect()
            if (
                s.pcState === 'connected' &&
                s.fast?.state === 'open' &&
                s.reliable?.state === 'open'
            )
                return
            await sleep(100)
        }
        throw new Error('waitReady timeout: ' + JSON.stringify(this.inspect()))
    }

    inspect() {
        return {
            pcState: this.pc?.connectionState ?? 'none',
            iceState: this.pc?.iceConnectionState ?? 'none',
            signalingState: this.pc?.signalingState ?? 'none',
            fast: this.dcFast
                ? {
                      label: this.dcFast.label,
                      state: this.dcFast.readyState,
                      ba: this.dcFast.bufferedAmount,
                  }
                : null,
            reliable: this.dcReliable
                ? {
                      label: this.dcReliable.label,
                      state: this.dcReliable.readyState,
                      ba: this.dcReliable.bufferedAmount,
                  }
                : null,
        }
    }

    private cleanupPeerOnly() {
        try {
            this.dcFast?.close()
        } catch {}
        try {
            this.dcReliable?.close()
        } catch {}
        this.dcFast = undefined
        this.dcReliable = undefined
        try {
            this.pc.close()
        } catch {}
        // @ts-ignore
        this.pc = undefined
    }
}
