# @vibe-rtc/rtc-react 
[![npm version](https://img.shields.io/npm/v/@vibe-rtc/rtc-react)](https://www.npmjs.com/package/@vibe-rtc/rtc-react)

React integration for `@vibe-rtc/rtc-core`.

Provides:

- `VibeRTCProvider` for signaling bootstrap
- `useVibeRTCSession(options)` as the invite-driven reactive hook (primary DX)
- `useVibeRTC()` legacy context API (still available)

## Install

```bash
pnpm add @vibe-rtc/rtc-react @vibe-rtc/rtc-core
```

`react` is a peer dependency (`>=18`).

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

## Invite-Driven Hook API

```ts
import { useVibeRTCSession } from '@vibe-rtc/rtc-react'

type RoomInvite = {
  roomId: string
  sessionId?: string // optional; shared invite can omit it
  connectionStrategy: ConnectionStrategy
}

const rtc = useVibeRTCSession({
  role: 'callee',
  invite, // RoomInvite | null
  autoStart: true,   // default true
  autoCreate: false, // default false
  debug: true,       // opt-in rich debug
  logMessages: true, // opt-in operation log verbosity
})
```

`useVibeRTCSession(options)` returns:

- `invite: RoomInvite | null`
- `joinUrl: string | null`
- `status: idle | connecting | connected | disconnected | error`
- `overallStatus: none | connecting | connected | error`
- `overallStatusText: string`
- `lastError`
- `debugState` (only when debug/log mode is enabled)
- `operationLog` + `clearOperationLog()`
- `start()` / `stop()` for imperative control when `autoStart=false`
- `endRoom()` for caller-side room removal
- `sendFast()`, `sendReliable()`, `reconnectSoft()`, `reconnectHard()`

Behavior:

- If `options.invite` is present, hook restores/continues that session.
- Invite `sessionId` is optional; the hook can resolve/fill effective role session internally.
- If `invite` is absent and `role='caller'` with `autoCreate=true`, hook creates a new room.
- If `invite` is absent and `role='callee'`, hook stays idle/waiting.
- Hook reacts to semantic option changes (`invite`, `role`, `autoStart`, `autoCreate`, `debug`, `logMessages`, presence of `onPing`) without unnecessary restarts on object identity-only rerenders.
- Invite persistence is external: read/write invite in URL/storage/router outside the hook and pass it through `options.invite`.

## Example: Durable Reconnect

```tsx
const [invite, setInvite] = useState<RoomInvite | null>(() => readInviteFromUrlOrStorage())

const rtc = useVibeRTCSession({
  role,
  invite,
  autoStart: true,
  autoCreate: role === 'caller',
})

useEffect(() => {
  if (!rtc.invite) return
  setInvite(rtc.invite)
  writeInviteToUrlOrStorage(rtc.invite)
}, [rtc.invite])
```

## Legacy Hook (Secondary)

`useVibeRTC()` is unchanged and still exposes the original imperative lifecycle/context API (`createChannel`, `joinChannel`, `attachAsCaller`, ...). Prefer `useVibeRTCSession(options)` for new integrations focused on durable invite-driven reconnect.

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
