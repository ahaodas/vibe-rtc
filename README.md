# vibe-rtc

[![CI](https://github.com/ahaodas/vibe-rtc/actions/workflows/ci.yml/badge.svg)](https://github.com/ahaodas/vibe-rtc/actions/workflows/ci.yml)
[![Pages](https://github.com/ahaodas/vibe-rtc/actions/workflows/pages.yml/badge.svg)](https://github.com/ahaodas/vibe-rtc/actions/workflows/pages.yml)
[![Version](https://img.shields.io/github/v/tag/ahaodas/vibe-rtc?label=version)](https://github.com/ahaodas/vibe-rtc/tags)

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
