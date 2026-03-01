# @vibe-rtc/rtc-core

Core WebRTC signaling/transport package with reconnect behavior and typed errors.

## Install

```bash
pnpm add @vibe-rtc/rtc-core
```

## Main API

- `RTCSignaler`
- `RTCError`, `RTCErrorCode`, `toRTCError`, `isRTCError`
- `withDefaultIceServers`, `DEFAULT_ICE_SERVERS`
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
  debug: true,
  waitReadyTimeoutMs: 10000,
  rtcConfiguration: {
    iceServers: [
      { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    ],
  },
})

const roomId = await signaler.createRoom()
await signaler.joinRoom(roomId)
await signaler.connect()

await signaler.sendReliable('hello')
await signaler.reconnectSoft()
await signaler.reconnectHard({ awaitReadyMs: 15000 })

await signaler.endRoom()
```

## Runtime Options

- `debug`: enables internal console logs (`console.log`/`console.error`).  
  By default logs are enabled only in test runtime.
- `waitReadyTimeoutMs`: default timeout for `waitReady()` and `reconnectHard()` if no timeout is passed explicitly.
- `connectionStrategy`: `"LAN_FIRST"` (default) or `"DEFAULT"`.
  - `"LAN_FIRST"` starts with host-only LAN candidates and no STUN/TURN, then falls back to STUN on timeout.
  - `"DEFAULT"` creates `RTCPeerConnection` with regular STUN behavior immediately.
- `lanFirstTimeoutMs`: LAN-first fallback timeout in milliseconds (default `1800`).
- `stunServers`: STUN servers used in fallback/default STUN mode.  
  Defaults to `[{ urls: "stun:stun.l.google.com:19302" }]`.
- `rtcConfiguration`: optional `RTCPeerConnection` config.  
  If omitted (or if `iceServers` is empty), `rtc-core` injects default STUN servers.

## LAN-first Strategy

With `connectionStrategy: "LAN_FIRST"`:

- Phase `LAN`: `RTCPeerConnection` starts with `iceServers: []` and only `typ host` candidates are sent/accepted.
- Phase `STUN`: if not connected before `lanFirstTimeoutMs`, the current peer is closed and rebuilt with STUN enabled.
- Signaling payload format is backward-compatible. Optional `pcGeneration` metadata is added to reduce stale message handling during rebuilds.
- Debug snapshots (`onDebug`) include strategy phase, candidate counters by type (`host`/`srflx`/`relay`) and best-effort selected path inference.

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
