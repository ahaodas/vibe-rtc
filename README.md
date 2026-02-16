# vibe-rtc

Monorepo with tools for stable browser-to-browser WebRTC data connections with signaling via Firebase Firestore.

## Packages

- `@vibe-rtc/rtc-core`: transport/signaling engine, reconnect logic, typed errors.
- `@vibe-rtc/rtc-firebase`: Firestore signaling adapter + Firebase bootstrap helpers + rules.
- `@vibe-rtc/rtc-react`: React provider/hooks on top of `rtc-core`.
- `vibe-rtc-common`: convenience re-exports for core + firebase.
- `@vibe-rtc/rtc-e2e`: Playwright E2E tests for reload/recovery scenarios.

## Workspace

Use `pnpm` (not `npm`).

```bash
pnpm install
```

## Common Commands

```bash
pnpm build:all
pnpm test:int
pnpm test:e2e
pnpm lint
pnpm typecheck
```

## Local Demo

Demo app lives in `apps/demo`.

```bash
pnpm --filter @vibe-rtc/demo dev
```

Required env for demo and tests (via Vite env):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (optional in some setups)
- `VITE_FIREBASE_AUTH_DOMAIN` (optional if derivable)
- `VITE_METERED_USER`, `VITE_METERED_CREDENTIAL` (optional TURN)

## Release Workflow

The repo uses Changesets.

```bash
pnpm changeset
pnpm version-packages
pnpm build:all
pnpm release:tag
pnpm release
```

See also `RELEASING.md`.

## Git Hooks

Husky hooks are configured:

- `pre-commit`: Biome safe fixes for staged files.
- `commit-msg`: Conventional Commit validation via commitlint.
- `pre-push`: commitlint for pushed range + Biome/typecheck for changed projects.

## Firebase Rules

Firestore rules and Firebase config are versioned in `packages/rtc-firebase`:

- `packages/rtc-firebase/firestore.rules`
- `packages/rtc-firebase/firestore.indexes.json`
- `packages/rtc-firebase/firebase.json`

Deploy rules:

```bash
pnpm --filter @vibe-rtc/rtc-firebase run rules:deploy
```
