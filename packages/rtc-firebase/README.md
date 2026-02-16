# @vibe-rtc/rtc-firebase

Firebase/Firestore signaling adapter for `@vibe-rtc/rtc-core`.

## Install

```bash
pnpm add @vibe-rtc/rtc-firebase
```

## Exports

- `FBAdapter`: `SignalDB` implementation on Firestore
- `ensureFirebase(config)`: initializes app/auth/firestore and signs in anonymously
- `loadFirebaseConfig`, `cfgFromProcessEnv`: env-based config helpers

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

## Environment Variables

For `cfgFromProcessEnv` / `loadFirebaseConfig` default prefix `VITE_`:

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

## Development

```bash
pnpm --filter @vibe-rtc/rtc-firebase build
pnpm --filter @vibe-rtc/rtc-firebase test
pnpm --filter @vibe-rtc/rtc-firebase emulator
```
