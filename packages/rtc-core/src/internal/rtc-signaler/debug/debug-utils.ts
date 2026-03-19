let debugSequence = 0

const nowLabel = () =>
    typeof performance !== 'undefined' && performance.now
        ? performance.now().toFixed(1)
        : String(Date.now())

export const sdpHash = (s?: string | null): string => {
    if (!s) return '∅'
    const line1 = s.split('\n')[0]?.trim() ?? ''
    let x = 0
    for (let i = 0; i < line1.length; i++) x = (x * 33) ^ line1.charCodeAt(i)
    return `${line1} #${(x >>> 0).toString(16)}`
}

export interface SignalerDebugger {
    p: (message: string, extra?: unknown) => void
    pe: (message: string, error: unknown) => void
}

export const createSignalerDebugger = (ctx: {
    role: 'caller' | 'callee'
    roomId: () => string | null
    pc: () => RTCPeerConnection | undefined
    enabled: boolean
}): SignalerDebugger => {
    const p = (message: string, extra?: unknown) => {
        if (!ctx.enabled) return
        const pc = ctx.pc()
        const tag = `[${++debugSequence}|${nowLabel()}|${ctx.role}|${ctx.roomId() ?? 'no-room'}]`
        const signalingState = pc ? pc.signalingState : 'no-pc'
        const iceState = pc ? pc.iceConnectionState : 'no-pc'
        const localDescription = pc?.localDescription?.type ?? '∅'
        console.log(
            `${tag} ${message}  [sig=${signalingState} ice=${iceState} loc=${localDescription}]`,
            extra ?? '',
        )
    }

    const pe = (message: string, error: unknown) => {
        if (!ctx.enabled) return
        const pc = ctx.pc()
        const tag = `[${++debugSequence}|${nowLabel()}|${ctx.role}|${ctx.roomId() ?? 'no-room'}]`
        const signalingState = pc ? pc.signalingState : 'no-pc'
        console.error(`${tag} ${message} [sig=${signalingState}]`, error)
    }

    return { p, pe }
}
