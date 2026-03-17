# Apps Demo Testing TODO

Updated: 2026-03-17

Legend:
- `[x]` done
- `[-]` in progress
- `[ ]` pending

## Objectives

- [x] Define split of responsibilities between RTL and Playwright
- [x] Prioritize fast pre-commit regression checks for demo UI
- [x] Prioritize local pre-deploy confidence checks before GH Pages publish

## Phase 0: Test Infrastructure (RTL)

- [x] Add `vitest` + `@testing-library/*` + `jsdom` to `apps/demo`
- [x] Add `vitest.config.ts` and `vitest.setup.ts`
- [x] Add demo test scripts (`test`, `test:watch`) and wire into `precommit`
- [x] Ensure package tests run green locally

## Phase 1: Fast Pre-Commit RTL Suite (P0)

### Route and parser logic
- [x] `AttachQueryRedirectPage` route redirection cases
- [x] `routes.ts` (`toRouteStrategyMode`, `toSessionPath`, `toBasePath`, `toCalleeUrl`)

### Critical page UI flows
- [x] `HomePage`:
  create default room flow
  create native room flow
  join modal open/submit validation
- [x] `OperationLog`:
  empty state
  scope/message rendering
  hide-toggle callback wiring

### Core state helpers
- [x] `homeReducer` transitions
- [x] `sessionReducer` transitions
- [x] `sessionLog` helpers (`isChannelMessage`, ordering, filtering)
- [x] `sessionDiagnostics` helper behavior

## Phase 2: Extended RTL Suite (P1)

- [x] `SessionOverlays` modal visibility matrix (room not found, occupied, takeover, leave, QR)
- [x] `SessionHeader` rendering contract (status, latency, QR/close actions)
- [x] `MessageComposer` enable/disable and callbacks
- [x] Hook-level tests with fake timers:
  `useSessionConnectProgress`, `useSessionNetworkWarning`, `useSessionModalState`

## Phase 3: Demo Playwright Smoke (Pre-Deploy)

- [x] Create demo UI smoke spec (separate from existing transport harness)
- [x] Cover minimal scenarios:
  home open -> create room -> session route
  join by room id -> callee session route
  attach query redirect path
  caller/callee exchange fast+reliable messages
  leave flow (caller remove-room / callee disconnect)
- [x] Add local run recipe for pre-deploy (emulator and/or real smoke)

## Phase 4: Integration with Existing `rtc-e2e`

- [x] Reuse existing `packages/rtc-e2e` recovery/takeover runs as deploy gate
- [x] Document combined local check command order (RTL + demo smoke + recovery smoke)
