# @vibe-rtc/rtc-e2e

End-to-end tests (Playwright) for WebRTC recovery scenarios.

This package is internal and not published.

## What Is Covered

- caller page reload recovery
- callee page reload recovery
- alternating reloads
- repeated reloads on same side
- message flow survival after reconnect
- SLA-style recovery timing checks
- dedicated recovery branch for `connectionStrategy: "BROWSER_NATIVE"`
- same-role takeover (`last tab wins`) for caller/callee
- cross-context takeover (different auth uid) via attach hash
- stress scenario: `20` consecutive caller takeovers with latest-owner checks
- takeover security callbacks (`onTakenOver`) and stale-tab disconnect assertions

## Run Tests

```bash
pnpm --filter @vibe-rtc/rtc-e2e test
```

Run takeover-only suite:

```bash
pnpm --filter @vibe-rtc/rtc-e2e exec playwright test --project=chromium --grep takeover
```

Run against local Firebase emulators (from repo root):

```bash
pnpm test:e2e:emu
```

Run only takeover suite:

```bash
pnpm test:e2e:emu:takeover
```

Run against real Firebase (from repo root, emulator hosts forced to empty values):

```bash
pnpm test:e2e:real
pnpm test:e2e:real:takeover
pnpm test:e2e:real:full
```

`pnpm test:e2e:real` is intentionally smoke-only.
`pnpm test:e2e:real:full` is currently unstable and not recommended for regular runs/CI gating.

Playwright config starts local Vite server (`dev:e2e`) and runs Chromium tests.
Global test timeout is mode-aware: `60s` on emulator and `120s` on real Firebase.

## Local Dev Server for E2E Harness

```bash
pnpm --filter @vibe-rtc/rtc-e2e dev:e2e
```

## Environment

The harness expects Firebase Vite env variables:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`

Optional emulator env:

- `FIRESTORE_EMULATOR_HOST` or `VITE_FIRESTORE_EMULATOR_HOST`
- `FIREBASE_AUTH_EMULATOR_HOST` or `VITE_FIREBASE_AUTH_EMULATOR_HOST`

When `*_EMULATOR_HOST` is set, harness works in emulator mode. For real Firebase runs, keep these vars unset.
The harness now fails fast with explicit error if required Firebase env vars are missing.

STUN servers for E2E are configured directly in `src/main.ts` via `rtcConfiguration`.
The harness also supports strategy override per role factory call
(`makeCaller` / `makeCallee`) and is used by tests to run both `DEFAULT` and `BROWSER_NATIVE`.

Attach-link flow is supported for takeover tests:

- hash format: `#/attach/{caller|callee}/{roomId}?strategy=native`
- `window.app.attachFromHash()` parses hash and joins role/room directly
- core/adapter receive normal role/room arguments (URL is only harness layer)

## Notes

- Tests run against real browser context.
- Keep Firebase rules in sync with signaling contract from `@vibe-rtc/rtc-firebase`.
- Harness role API includes `hangup()` (non-destructive cleanup), `endRoom()`, `takeSecurityEvents()` and `debugSignal()`.
