# vibe-rtc

[![CI](https://github.com/ahaodas/vibe-rtc/actions/workflows/ci.yml/badge.svg)](https://github.com/ahaodas/vibe-rtc/actions/workflows/ci.yml)
[![Pages](https://github.com/ahaodas/vibe-rtc/actions/workflows/pages.yml/badge.svg)](https://github.com/ahaodas/vibe-rtc/actions/workflows/pages.yml)
[![Version](https://img.shields.io/github/v/tag/ahaodas/vibe-rtc?label=version)](https://github.com/ahaodas/vibe-rtc/tags)

Monorepo with tools for stable browser-to-browser WebRTC data connections with signaling via Firebase Firestore.

> Disclosure: this repository is developed with heavy use of AI assistance (OpenAI Codex).

## Packages

- `@vibe-rtc/rtc-core`: transport/signaling engine, reconnect logic, typed errors.
- `@vibe-rtc/rtc-firebase`: Firestore signaling adapter + Firebase bootstrap helpers + rules.
- `@vibe-rtc/rtc-react`: React provider/hooks on top of `rtc-core`.
- `@vibe-rtc/sdk`: unified package re-exporting core + react + firebase.
- `@vibe-rtc/rtc-e2e`: Playwright E2E tests for reload/recovery scenarios.

## Workspace

Use `pnpm` (not `npm`).

```bash
pnpm install
```

Unified install for app projects:

```bash
npm i @vibe-rtc/sdk@latest
```

## Common Commands

```bash
pnpm build:all
pnpm test:int
pnpm test:e2e
pnpm lint
pnpm typecheck
```

## Development

When changing exported APIs in workspace packages (for example `rtc-core` -> `rtc-react`/`demo`),
rebuild changed package(s) and their consumers before running app/type checks.

Typical flow:

```bash
# Rebuild all libraries and SDK
pnpm build:all

# Or rebuild specific chain explicitly
pnpm --filter @vibe-rtc/rtc-core build
pnpm --filter @vibe-rtc/rtc-react build
pnpm --filter @vibe-rtc/demo build
```

Linting and fixes are done with Biome:

```bash
# Lint (Biome)
pnpm lint

# Apply safe Biome fixes
pnpm biome:fix:safe
```

Before commit, package-level checks are run automatically by Husky `pre-commit`.
You can run them manually when needed:

```bash
# All workspace packages/apps:
# Biome check in each package, then unit tests where defined
pnpm run precommit:packages

# Or one package:
pnpm --filter @vibe-rtc/rtc-core run precommit
```

Commit messages must follow Conventional Commits (validated by Husky `commit-msg`):

```text
feat(rtc-react): add per-session connectionStrategy override
fix(rtc-core): keep browser-native ICE servers unfiltered
chore(release): version packages
```

Allowed common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `build`, `ci`.

## Local Demo

Demo app lives in `apps/demo`.

```bash
pnpm --filter @vibe-rtc/demo dev
```

Production demo is deployed via GitHub Pages from `master/main` by workflow:

- `Deploy Demo to GitHub Pages` (`.github/workflows/pages.yml`)

Required env for demo and tests (via Vite env):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (optional in some setups)
- `VITE_FIREBASE_AUTH_DOMAIN` (optional if derivable)

STUN/TURN (`iceServers`) are configured in code during `RTCSignaler`/`VibeRTCProvider` initialization
(see `apps/demo/src/main.tsx` and `packages/rtc-e2e/src/main.ts`).

### Demo TURN Provider

Demo supports any TURN provider via Vite variables:

- `VITE_TURN_URLS` (optional, comma-separated TURN/TURNS URLs)
- `VITE_TURN_USERNAME`
- `VITE_TURN_CREDENTIAL`

Backward-compatible aliases for Metered are also supported:

- `VITE_METERED_USER`
- `VITE_METERED_CREDENTIAL`

If no TURN credentials are provided, demo uses STUN-only mode (less reliable on restrictive NAT/firewall networks).

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

- `pre-commit`: Biome safe fixes for staged files, then package-level `precommit` checks.
- `commit-msg`: Conventional Commit validation via commitlint.
- `pre-push`: commitlint for pushed range + typecheck for changed projects.

Manual equivalents:

```bash
pnpm run precommit:packages
pnpm typecheck
pnpm commitlint --from origin/master --to HEAD
```

## Firebase Rules

Firestore rules and Firebase config are versioned in `packages/rtc-firebase`:

- `packages/rtc-firebase/firestore.rules`
- `packages/rtc-firebase/firestore.indexes.json`
- `packages/rtc-firebase/firebase.json`

Path-based signaling layout used by `@vibe-rtc/rtc-firebase`:

- `rooms/{roomId}/leases/{role}`
- `rooms/{roomId}/callers/{uid}` and `rooms/{roomId}/callees/{uid}`
- `rooms/{roomId}/{role}s/{uid}/candidates/{candidateId}`
- `rooms/{roomId}/events/{eventId}` for takeover notifications

Deploy rules:

```bash
pnpm --filter @vibe-rtc/rtc-firebase run rules:deploy
```

### Local Emulator + Rules Tests

Root-level Firebase emulator config lives in [firebase.json](./firebase.json) and points to:

- [firestore.rules](./packages/rtc-firebase/firestore.rules)
- [firestore.indexes.json](./packages/rtc-firebase/firestore.indexes.json)

Commands:

```bash
# Start Emulator Suite (Firestore + Auth + Emulator UI)
pnpm emulators

# Run Firestore rules tests (expects FIRESTORE_EMULATOR_HOST to be available)
pnpm test:rules

# Start firestore emulator and run rules tests in one command
pnpm test:rules:emu

# Run Playwright harness against emulators (no real Firebase project)
pnpm test:e2e:emu
```

Emulator UI is available at `http://127.0.0.1:4000` and can be used to inspect reads/writes and rule denials while running tests.

CI deploy is available via `.github/workflows/firestore-rules.yml`.
Set:
- Repository variable `FIREBASE_PROJECT_ID`
- Repository secret `FIREBASE_SERVICE_ACCOUNT` (service account JSON)
