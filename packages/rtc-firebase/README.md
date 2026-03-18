# @vibe-rtc/rtc-firebase 
[![npm version](https://img.shields.io/npm/v/@vibe-rtc/rtc-firebase)](https://www.npmjs.com/package/@vibe-rtc/rtc-firebase)

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

## Signaling Schema (Path-Based)

Adapter stores signaling data under role/uid paths:

- `rooms/{roomId}/callers/{uid}`
- `rooms/{roomId}/callees/{uid}`
- `rooms/{roomId}/callers/{uid}/candidates/{candidateId}`
- `rooms/{roomId}/callees/{uid}/candidates/{candidateId}`
- `rooms/{roomId}/leases/{role}` where `role in ['caller', 'callee']`
- `rooms/{roomId}/events/{eventId}` for takeover notifications

`offer` is written to caller participant doc, `answer` to callee participant doc.
ICE candidates are written to role-local candidate branches and flushed in 100ms batches.

## Takeover Semantics (Last Join Wins)

`FBAdapter` uses role leases for takeover:

- on role attach, adapter runs `claimRole()` transaction for `leases/{role}`
- if lease owner changes, previous session gets `role_taken_over` event
- transaction updates only current owner docs (`lease`, current participant, room root, optional takeover event); foreign participant docs are not rewritten
- same-role reconnect keeps the same `sessionId`; hard reload creates a new `sessionId`

This keeps exactly one active `caller` and one active `callee` per room.

`leaveRoom(role)` is ownership-guarded:

- adapter reads current lease first
- participant `active:false` and lease delete happen only when `(ownerUid, ownerSessionId)` still match local session
- stale tabs after takeover cannot clear active lease/participant state

## Security Callbacks

`FBAdapter` accepts optional callbacks:

- `onTakenOver({ roomId, bySessionId? })`
- `onRoomOccupied({ roomId })`
- `onSecurityError(error)`

These callbacks are useful for UX teardown and e2e assertions around takeover paths.

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

- path-based caller/callee signaling flow
- lease ownership and takeover constraints
- per-uid participant/candidate write isolation
- event creation/read constraints
