# Demo Local Pre-Deploy Checks

Updated: 2026-03-17

## Goal 1: Fast UI Regression Check (before commit)

Run only demo RTL:

```bash
pnpm --filter @vibe-rtc/demo run test
```

Or full demo precommit gate:

```bash
pnpm --filter @vibe-rtc/demo run precommit
```

## Goal 2: Full Local Confidence Check (before GH Pages deploy)

Recommended emulator-backed order:

1. Demo RTL suite
2. Demo Playwright UI smoke (`apps/demo/e2e`)
3. Existing transport recovery/takeover e2e (`packages/rtc-e2e`)

One-command shortcut:

```bash
pnpm test:demo:predeploy:emu
```

Equivalent step-by-step commands:

```bash
pnpm --filter @vibe-rtc/demo run test
pnpm test:demo:e2e:emu
pnpm test:e2e:emu
```

## Notes

- Demo Playwright smoke tests are tagged as `@demo-smoke` and include route checks plus backend-dependent caller/callee flow.
- Backend-dependent tests are skipped automatically if required Firebase env vars are missing.
