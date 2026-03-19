export type RemoteSignalSource = 'offer' | 'answer' | 'candidate'
export type RemoteSyncRole = 'caller' | 'callee'

export interface RemoteSessionSyncInput {
    source: RemoteSignalSource
    role: RemoteSyncRole
    remoteSessionId: string | undefined
    currentSessionId: string | null | undefined
    remoteDescSet: boolean
}

export type RemoteSessionSyncDecision =
    | {
          action: 'keep-current'
          nextSessionId: string | undefined
      }
    | {
          action: 'adopt-session'
          nextSessionId: string
      }
    | {
          action: 'rebuild-peer'
          nextSessionId: string
      }
    | {
          action: 'reject-stale'
          staleSessionId: string
      }

export const resolveRemoteSessionSyncDecision = (
    input: RemoteSessionSyncInput,
): RemoteSessionSyncDecision => {
    if (!input.remoteSessionId) {
        return {
            action: 'keep-current',
            nextSessionId: input.currentSessionId ?? undefined,
        }
    }

    if (input.remoteSessionId === input.currentSessionId) {
        return {
            action: 'keep-current',
            nextSessionId: input.remoteSessionId,
        }
    }

    if (input.source === 'answer' && input.role === 'caller') {
        return {
            action: 'adopt-session',
            nextSessionId: input.remoteSessionId,
        }
    }

    if (input.source === 'candidate' && !input.remoteDescSet) {
        return {
            action: 'adopt-session',
            nextSessionId: input.remoteSessionId,
        }
    }

    if (input.source !== 'offer') {
        return {
            action: 'reject-stale',
            staleSessionId: input.remoteSessionId,
        }
    }

    return {
        action: 'rebuild-peer',
        nextSessionId: input.remoteSessionId,
    }
}
