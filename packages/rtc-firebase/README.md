# @vibe-rtc/rtc-firebase

Firebase/Firestore signaling adapter for `@vibe-rtc/rtc-core`.

## Install

```bash
pnpm add @vibe-rtc/rtc-firebase
```

## Exports

- `FBAdapter`: `SignalDB` implementation on Firestore
- `ensureFirebase(config)`: initializes app/auth/firestore and signs in anonymously
- `@vibe-rtc/rtc-firebase/node`: Node-only env config helpers (`loadFirebaseConfig`, `cfgFromProcessEnv`)

## Quick Example

```ts
import { RTCSignaler } from '@vibe-rtc/rtc-core'
import { FBAdapter, ensureFirebase } from '@vibe-rtc/rtc-firebase'

const { db, auth } = await ensureFirebase({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

const signalDb = new FBAdapter(db, auth)
const rtc = new RTCSignaler('caller', signalDb)
```

## Takeover Semantics (Same Role / Multi-Tab)

`FBAdapter` implements role-slot takeover with "last join wins":

- each browser tab has adapter-level `participantId`
- on `joinRoom(id, role)` adapter writes/updates `rooms/{roomId}.slots[role]` with:
  - `participantId`
  - `sessionId` (new on takeover/join)
  - `joinedAt`, `lastSeenAt`
- signaling documents (`offer`, `answer`, ICE candidates) carry `sessionId`

Room schema fragment:

```ts
slots: {
  caller?: { participantId: string; sessionId: string; joinedAt: number; lastSeenAt: number } | null
  callee?: { participantId: string; sessionId: string; joinedAt: number; lastSeenAt: number } | null
}
```

This lets `rtc-core` ignore stale signaling from old tabs and detect slot takeover reliably.

## Environment Variables

For `cfgFromProcessEnv` / `loadFirebaseConfig` (from `@vibe-rtc/rtc-firebase/node`) default prefix `VITE_`:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (optional)

## Firestore Rules

Rules live in this package:

- `firestore.rules`
- `firestore.indexes.json`
- `firebase.json`

Deploy rules:

```bash
pnpm --filter @vibe-rtc/rtc-firebase run rules:deploy
```

For CI/non-interactive deployment:

```bash
pnpm --filter @vibe-rtc/rtc-firebase run rules:deploy:ci
```

Use `FIREBASE_PROJECT_ID` to target non-default project.

### GitHub Actions Deploy

Repository includes workflow `.github/workflows/firestore-rules.yml`.
It runs on changes in Firestore rule files and can be started manually.

Required GitHub configuration:

- Repository variable: `FIREBASE_PROJECT_ID`
- Repository secret: `FIREBASE_SERVICE_ACCOUNT` (JSON of Firebase service account with Firestore rules deploy permissions)

## Development

```bash
pnpm --filter @vibe-rtc/rtc-firebase build
pnpm --filter @vibe-rtc/rtc-firebase test
pnpm --filter @vibe-rtc/rtc-firebase emulator
```

## Firestore Rules Tests (Emulator)

Rules tests are in:

- `tests/rules/firestore.rules.test.ts`
- `tests/rules/helpers.ts`

Run only rules tests:

```bash
pnpm --filter @vibe-rtc/rtc-firebase run test:rules
```

Recommended (auto-start firestore emulator):

```bash
pnpm test:rules:emu
```

This suite covers:

- happy-path caller/callee flow
- edge cases (TTL, payload size limits, candidate bounds, immutable fields)
- attacking scenarios (list/hijack/tamper/flood/modify)
