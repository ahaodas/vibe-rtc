import type { VibeRTCOperationLogEntry } from '@vibe-rtc/rtc-react'
import { describe, expect, it } from 'vitest'
import { MAX_VISIBLE_LOG_ENTRIES } from '@/features/demo/model/constants'
import {
    isChannelMessage,
    selectVisibleLog,
    sortOperationLog,
} from '@/features/demo/model/sessionLog'

function makeEntry(
    at: number,
    event: string,
    scope: VibeRTCOperationLogEntry['scope'] = 'system',
): VibeRTCOperationLogEntry {
    return {
        at,
        event,
        message: `${event}-message`,
        scope,
    }
}

describe('sessionLog helpers', () => {
    it('detects channel messages by "message:" event prefix', () => {
        expect(isChannelMessage(makeEntry(1, 'message:in-fast'))).toBe(true)
        expect(isChannelMessage(makeEntry(1, 'ice=connected', 'webrtc'))).toBe(false)
        expect(
            isChannelMessage({
                at: 1,
                message: 'no event',
                scope: 'system',
            }),
        ).toBe(false)
    })

    it('sorts entries by timestamp and preserves insertion order for same timestamps', () => {
        const a = makeEntry(20, 'event-a')
        const b = makeEntry(10, 'event-b')
        const c = makeEntry(20, 'event-c')

        expect(sortOperationLog([a, b, c])).toEqual([b, a, c])
    })

    it('filters to channel messages and keeps only trailing max visible entries', () => {
        const entries: VibeRTCOperationLogEntry[] = Array.from(
            { length: MAX_VISIBLE_LOG_ENTRIES + 30 },
            (_, index) => makeEntry(index, `message:in-${index}`, 'data'),
        )

        const visible = selectVisibleLog(entries, true)

        expect(visible).toHaveLength(MAX_VISIBLE_LOG_ENTRIES)
        expect(visible[0]?.at).toBe(30)
        expect(visible.every((entry) => isChannelMessage(entry))).toBe(true)
    })
})
