# @vibe-rtc/rtc-react

React integration for `@vibe-rtc/rtc-core`.

Provides `VibeRTCProvider` and `useVibeRTC()` for room/channel lifecycle, messaging, reconnect, and typed state for UI.

## Install

```bash
pnpm add @vibe-rtc/rtc-react @vibe-rtc/rtc-core
```

`react` is a peer dependency (`>=18`).

If you prefer one package for core + react + firebase, install:

```bash
pnpm add @vibe-rtc/sdk
```

## Provider Setup

You can pass either:

- `signalServer`: ready `SignalDB` instance
- `createSignalServer`: async factory (provider handles booting/error state)

```tsx
import { VibeRTCProvider } from '@vibe-rtc/rtc-react'

<VibeRTCProvider createSignalServer={createSignalServer}>
  <App />
</VibeRTCProvider>
```

`rtcConfiguration` is optional. If not provided, `rtc-core` default ICE servers are used.
`connectionStrategy` is optional (`LAN_FIRST` by default in `rtc-core`).

## Hook API

```ts
const rtc = useVibeRTC()

await rtc.createChannel()          // caller flow
await rtc.joinChannel(roomId)      // callee flow
await rtc.attachAsCaller(roomId)
await rtc.attachAsCallee(roomId)
await rtc.attachAuto(roomId, { allowTakeOver: true, staleMs: 60_000 })

await rtc.sendFast('ping')
await rtc.sendReliable('pong')

await rtc.reconnectSoft()
await rtc.reconnectHard({ awaitReadyMs: 15000 })

await rtc.disconnect()
await rtc.endRoom()
```

## State Model

`useVibeRTC()` returns:

- `status`: `idle | booting | connecting | connected | disconnected | error`
- `overallStatus`: `none | connecting | connected | error` (aggregated signaling + WebRTC state)
- `overallStatusText`: current high-level operation description
- `operationLog`: chronological operation feed (`signaling | webrtc | data | system | error`)
- `clearOperationLog()`: clears operation feed
- `booting`, `bootError`, `lastError`
- `roomId`
- `lastFastMessage`, `lastReliableMessage`
- `messageSeqFast`, `messageSeqReliable`
- `debugState` (from core signaler)

## Development

```bash
pnpm --filter @vibe-rtc/rtc-react build
pnpm --filter @vibe-rtc/rtc-react test
```
