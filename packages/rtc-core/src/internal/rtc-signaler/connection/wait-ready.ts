export interface WaitReadyInspectSnapshot {
    pcState: string
    fast: { state: string } | null
    reliable: { state: string } | null
}

export const isWaitReadySatisfied = (snapshot: WaitReadyInspectSnapshot): boolean =>
    snapshot.pcState === 'connected' &&
    snapshot.fast?.state === 'open' &&
    snapshot.reliable?.state === 'open'
