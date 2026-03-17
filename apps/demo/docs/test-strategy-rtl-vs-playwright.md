# Demo Test Strategy: RTL vs Playwright

Updated: 2026-03-17
Scope: `apps/demo` (with awareness of existing `packages/rtc-e2e` coverage)

## Goals

1. Catch UI regressions quickly before commit.
2. Validate real user scenarios before local GH Pages deploy checks (not CI-only).

## Current State Snapshot

- `apps/demo` now has RTL coverage for routes, reducers, helpers, key pages/components, and session hooks.
- `apps/demo` now has a dedicated Playwright smoke spec at `apps/demo/e2e/demo.ui.smoke.spec.ts`.
- `packages/rtc-e2e` remains the transport/recovery/takeover gate with dedicated harness (`e2e-rtc.html`).

## Split Rule (What goes where)

- Use RTL for deterministic UI logic, rendering states, route parsing, modal toggles, form behavior, and timer-driven local state.
- Use Playwright for multi-page flows, real browser APIs, real WebRTC/Firebase behavior, reload/takeover races, and deploy-like smoke checks.
- Do not use Playwright for pure formatting/reducer helpers.
- Do not rely on RTL to prove real browser-to-browser connectivity.

## Coverage Matrix

| Area / Scenario | RTL | Playwright | Why |
|---|---|---|---|
| Home page buttons/modals (`Create`, `Create native`, `Join`) | Yes | Smoke only | Mostly local state + navigation wiring. |
| `AttachQueryRedirectPage` query parsing (`role/as`, `roomId/room`, `strategy`) | Yes | Optional smoke | Deterministic parser logic. |
| `SessionPage` UI state matrix (status text, QR button visibility, leave modal, room/takeover modals) | Yes | Smoke only | High UI regression risk, fast to run with mocked `useVibeRTC`. |
| Message composer enable/disable and input clearing | Yes | Yes | RTL for button logic, Playwright for real end-to-end send/receive. |
| Operation log rendering/filter toggle (`hideConnectionMessages`) | Yes | Optional smoke | Pure rendering/filtering behavior. |
| Connect progress and network warning timers (`useSessionConnectProgress`, `useSessionNetworkWarning`) | Yes | No | Timer logic is deterministic and fast in fake timers. |
| QR generation behavior (`useSessionQrCode`, loading/fallback) | Yes | Smoke only | RTL can mock `qrcode`; Playwright verifies visible QR in real page. |
| Route helpers (`toSessionPath`, `toCalleeUrl`, base path handling) | Yes | Yes | Unit speed plus deploy-like path verification. |
| RTC provider boot overlays (`renderLoading`, `renderBootError`) | Yes | Smoke only | UI contract around provider boot lifecycle. |
| Caller + callee connect and exchange messages in real browser | No | Yes | Requires real browser contexts and signaling backend. |
| Reload recovery and takeover race scenarios | No | Yes | Already in `packages/rtc-e2e`; keep as pre-deploy gate. |
| GH Pages hash route + base path smoke (`VITE_BASE_PATH`) | No | Yes | Must emulate deploy routing behavior end-to-end. |

## Implemented RTL Suites (fast pre-commit gate)

Key test files in `apps/demo/src`:

- `features/demo/pages/HomePage.test.tsx`
- `features/demo/pages/AttachQueryRedirectPage.test.tsx`
- `features/demo/components/session/SessionOverlays.test.tsx`
- `features/demo/components/session/SessionHeader.test.tsx`
- `features/demo/components/OperationLog.test.tsx`
- `features/demo/components/MessageComposer.test.tsx`
- `features/demo/hooks/useSessionConnectProgress.test.ts`
- `features/demo/hooks/useSessionNetworkWarning.test.ts`
- `features/demo/hooks/useSessionModalState.test.ts`
- `features/demo/model/routes.test.ts`
- `features/demo/model/sessionDiagnostics.test.ts`
- `features/demo/model/sessionLog.test.ts`
- `features/demo/model/homeReducer.test.ts`
- `features/demo/model/sessionReducer.test.ts`

Target for this pack:

- local runtime under ~30-45s
- fully mock `@vibe-rtc/rtc-react` in UI tests
- no real Firebase/WebRTC dependencies

## Implemented Playwright Suite (pre-deploy local gate)

Keep existing `packages/rtc-e2e/tests/rtc.e2e.spec.ts` for transport resilience.

Use the demo-UI-focused Playwright spec:

- `apps/demo/e2e/demo.ui.smoke.spec.ts` smoke scenarios:
1. Open home page, create room (default), land on session route.
2. Open join modal, submit room ID, land on callee route.
3. Attach query redirect (`#/attach?...`) resolves to session route.
4. Caller + callee connect from UI and exchange fast/reliable messages.
5. Leave flow: caller `remove room` behavior and callee `disconnect` behavior.
6. Caller QR modal opens before ready and hides after ready/takeover.
7. Error modal visibility for room-not-found / takeover.
8. Base path smoke with `VITE_BASE_PATH` and hash routing.

Optional heavy pack before release:

- existing takeover stress and reload recovery scenarios from `rtc-e2e`.

## Run Profiles Aligned With Goals

Pre-commit (Goal 1, fast):

1. Demo RTL smoke pack.
2. No heavy Playwright by default.

Pre-deploy local (Goal 2, confidence before GH Pages):

1. Demo RTL full pack.
2. Demo UI Playwright smoke pack on emulator.
3. Existing `rtc-e2e` recovery/takeover smoke (`pnpm test:e2e:emu` or `pnpm test:e2e:real:smoke` depending on env).
4. Demo production build with deploy-like base path.

## Practical Recommendation

- Use RTL as the commit-time regression net for UI contracts.
- Use Playwright as the deploy-time integration proof for real browser behavior.
- Reuse `packages/rtc-e2e` for network resilience, and add a small demo-UI Playwright layer to close the current UI coverage gap.
