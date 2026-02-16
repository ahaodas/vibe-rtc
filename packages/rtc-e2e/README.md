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

## Run Tests

```bash
pnpm --filter @vibe-rtc/rtc-e2e test
```

Playwright config starts local Vite server (`dev:e2e`) and runs Chromium tests.

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

## Notes

- Tests run against real browser context.
- Keep Firebase rules in sync with signaling contract from `@vibe-rtc/rtc-firebase`.
