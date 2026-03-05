import type { VibeRTCOperationLogEntry } from '@vibe-rtc/rtc-react'
import { MAX_VISIBLE_LOG_ENTRIES } from '@/features/demo/model/constants'

export function isChannelMessage(entry: VibeRTCOperationLogEntry): boolean {
    return entry.event?.startsWith('message:') ?? false
}

export function sortOperationLog(entries: VibeRTCOperationLogEntry[]): VibeRTCOperationLogEntry[] {
    return entries
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => {
            if (a.entry.at !== b.entry.at) return a.entry.at - b.entry.at
            return a.index - b.index
        })
        .map((item) => item.entry)
}

export function selectVisibleLog(
    entries: VibeRTCOperationLogEntry[],
    hideConnectionMessages: boolean,
): VibeRTCOperationLogEntry[] {
    const filtered = hideConnectionMessages ? entries.filter(isChannelMessage) : entries
    return filtered.slice(-MAX_VISIBLE_LOG_ENTRIES)
}
