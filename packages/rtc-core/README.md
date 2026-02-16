# @vibe-rtc/rtc-core

Core WebRTC signaling/transport package with reconnect behavior and typed errors.

## Install

```bash
pnpm add @vibe-rtc/rtc-core
```

## Main API

- `RTCSignaler`
- `RTCError`, `RTCErrorCode`, `toRTCError`, `isRTCError`
- `SignalDB` interface for custom signaling backends

## SignalDB Contract

Implement `SignalDB` from `src/types.tsx` with methods for:

- room lifecycle: `createRoom`, `joinRoom`, `getRoom`, `endRoom`
- SDP exchange: `getOffer`, `setOffer`, `clearOffer`, `setAnswer`, `clearAnswer`
- ICE exchange: add/subscribe for caller/callee candidate streams
- cleanup: `clearCallerCandidates`, `clearCalleeCandidates`

## Quick Example

```ts
import { RTCSignaler } from '@vibe-rtc/rtc-core'

const signaler = new RTCSignaler('caller', signalDb, {
  rtcConfiguration: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
})

const roomId = await signaler.createRoom()
await signaler.joinRoom(roomId)
await signaler.connect()

await signaler.sendReliable('hello')
await signaler.reconnectSoft()
await signaler.reconnectHard({ awaitReadyMs: 15000 })

await signaler.endRoom()
```

## Error Handling

Use `RTCErrorCode` for stable UI/test handling:

- `ROOM_NOT_SELECTED`
- `ROOM_NOT_FOUND`
- `AUTH_REQUIRED`
- `DB_UNAVAILABLE`
- `SIGNAL_TIMEOUT`
- `WAIT_READY_TIMEOUT`
- `SIGNALING_FAILED`
- `INVALID_STATE`
- `UNKNOWN`

## Development

```bash
pnpm --filter @vibe-rtc/rtc-core build
pnpm --filter @vibe-rtc/rtc-core test
```
