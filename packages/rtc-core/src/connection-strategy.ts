export type ConnectionStrategy = 'LAN_FIRST' | 'DEFAULT'
export type IcePhase = 'LAN' | 'STUN'
export type CandidateType = 'host' | 'srflx' | 'relay' | 'unknown'

export function getCandidateType(candidateStr?: string | null): CandidateType {
    if (!candidateStr) return 'unknown'
    const match = candidateStr.match(/\btyp\s+([a-z0-9]+)/i)
    const rawType = (match?.[1] ?? '').toLowerCase()
    if (rawType === 'host') return 'host'
    if (rawType === 'srflx') return 'srflx'
    if (rawType === 'relay') return 'relay'
    return 'unknown'
}

export function shouldSendCandidate(phase: IcePhase, candidateStr?: string | null): boolean {
    if (phase !== 'LAN') return true
    return getCandidateType(candidateStr) === 'host'
}

export function shouldAcceptCandidate(phase: IcePhase, candidateStr?: string | null): boolean {
    if (phase !== 'LAN') return true
    return getCandidateType(candidateStr) === 'host'
}
