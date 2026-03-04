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
Available modes: `LAN_FIRST`, `DEFAULT`, `BROWSER_NATIVE`.
You can set strategy globally on provider, or override it per `create/join/attach` call.

## Hook API

```ts
const rtc = useVibeRTC()

await rtc.createChannel()          // caller flow
await rtc.joinChannel(roomId)      // callee flow
await rtc.createChannel({ connectionStrategy: 'BROWSER_NATIVE' })
await rtc.joinChannel(roomId, { connectionStrategy: 'DEFAULT' })
await rtc.attachAsCaller(roomId)
await rtc.attachAsCallee(roomId)
await rtc.attachAuto(roomId, {
  allowTakeOver: true,
  staleMs: 60_000,
  connectionStrategy: 'BROWSER_NATIVE',
})

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

## Takeover Behavior

`rtc-react` watches effective room slot ownership (lease-backed `slots`) and handles same-role takeover:

- if another tab takes your role slot, provider disposes active session
- `lastError` is set to `TAKEOVER_DETECTED`
  (including core `INVALID_STATE` takeover signals normalized to this code)
- signaling/data channels are closed and no auto-rejoin is performed

Recommended UI flow:

- show a modal like "This room was taken over in another tab"
- after confirmation, navigate user back to your home/start screen

## Development

```bash
pnpm --filter @vibe-rtc/rtc-react build
pnpm --filter @vibe-rtc/rtc-react test
```
