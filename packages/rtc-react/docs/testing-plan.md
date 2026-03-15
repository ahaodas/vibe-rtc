# Testing Plan for @vibe-rtc/rtc-react

## Overview

This document outlines the testing strategy for the `@vibe-rtc/rtc-react` package. The package provides React bindings for the `@vibe-rtc/rtc-core` library through a Context Provider and custom hook.

## Current State

✅ **Existing tests:**
- `src/state.test.ts` - Basic unit tests for state reducer and helper functions

## Testing Strategy

### Unit Tests with React Testing Library

All tests will use **Vitest** + **React Testing Library** for component/hook testing with proper mocking of `@vibe-rtc/rtc-core` dependencies.

---

## Test Suite Breakdown

### 1. State & Reducers (Priority: HIGH)

**File:** `src/state.test.ts` (expand existing)

**Coverage:**
- ✅ `mapPcState()` - all RTCPeerConnectionState variants
- ✅ `normalizeError()` - error normalization and takeover detection
- ✅ `reducer()` - basic message handling and status transitions
- ⚠️ **Missing:**
  - `toOverallStatus()` - all state combinations (bootError, lastError, booting, statuses)
  - `toOverallStatusText()` - status text generation for different states
  - `toOperationScope()` - event string parsing logic
  - `describeDebugEvent()` - debug event descriptions
  - Edge cases: null/undefined inputs, malformed errors

---

### 2. Provider Initialization & Boot (Priority: CRITICAL)

**File:** `src/__tests__/provider.boot.test.tsx`

**Test cases:**
- ✅ Provider renders with `signalServer` prop (immediate boot)
- ✅ Provider renders with `createSignalServer` (async boot with loading state)
- ✅ `createSignalServer` rejects → `bootError` state, `renderBootError` called
- ✅ Missing both `signalServer` and `createSignalServer` → boot error
- ✅ `renderLoading` displayed during `booting=true`
- ✅ Provider cleanup on unmount → disposes signaler, stops heartbeat
- ✅ `getSignalDB()` caches instance, doesn't re-initialize

**Mocking:**
- Mock `createSignalServer` as async factory
- Mock `SignalDB` interface methods

---

### 3. Lifecycle Methods (Priority: CRITICAL)

**File:** `src/__tests__/provider.lifecycle.test.tsx`

**Test cases:**

#### `createChannel()`
- ✅ Creates RTCSignaler with role='caller'
- ✅ Calls `signaler.createRoom()` and returns roomId
- ✅ Updates state: `roomId`, `status='connecting'`
- ✅ Starts room watch
- ✅ Error handling → sets `lastError`, throws

#### `joinChannel(roomId)`
- ✅ Creates RTCSignaler with role='callee'
- ✅ Calls `signaler.joinRoom(roomId)`
- ✅ Updates state: `roomId`, `status='connecting'`
- ✅ Error: missing roomId → throws
- ✅ Error handling → sets `lastError`

#### `attachAsCaller(roomId)` / `attachAsCallee(roomId)`
- ✅ Disposes previous signaler before attach
- ✅ Resets messages on attach
- ✅ Clears `lastError` before operation
- ✅ Joins existing room as specified role
- ✅ Starts room watch

#### `attachAuto(roomId, opts)`
- ✅ Detects existing role from room (callerUid/calleeUid match)
- ✅ Claims free slot (caller → callee fallback)
- ✅ Takeover logic with `allowTakeOver=true` and `staleMs`
- ✅ Error: room occupied, no takeover → throws
- ✅ Starts heartbeat loop, returns stop function
- ✅ Heartbeat stop on cleanup

#### `disconnect()`
- ✅ Calls `signaler.hangup()`
- ✅ Clears `lastError`
- ✅ Sets `status='disconnected'`
- ✅ Does NOT clear roomId

#### `endRoom()`
- ✅ Calls `signaler.endRoom()`
- ✅ Disposes signaler
- ✅ Resets messages, clears roomId, lastError
- ✅ Stops room watch
- ✅ Sets `status='idle'`

**Mocking:**
- Mock `RTCSignaler` methods (`createRoom`, `joinRoom`, `connect`, `hangup`, `endRoom`)
- Mock `SignalDB.getRoom()` for room state

---

### 4. Messaging (Priority: HIGH)

**File:** `src/__tests__/provider.messaging.test.tsx`

**Test cases:**

#### Outgoing messages
- ✅ `sendFast(text)` → calls `signaler.sendFast()`
- ✅ `sendReliable(text)` → calls `signaler.sendReliable()`
- ✅ Send without signaler → throws error
- ✅ Operation log updated with message

#### Incoming messages
- ✅ `setMessageHandler` receives fast message → updates `lastFastMessage`, `messageSeqFast++`
- ✅ Receives reliable message → updates `lastReliableMessage`, `messageSeqReliable++`
- ✅ Message metadata (reliable flag) handled correctly

#### Message reset
- ✅ `RESET_MESSAGES` action clears messages and counters
- ✅ New session (createChannel/joinChannel) resets messages

**Mocking:**
- Simulate message handler callbacks

---

### 5. Error Handling (Priority: CRITICAL)

**File:** `src/__tests__/provider.errors.test.tsx`

**Test cases:**
- ✅ Signaler error handler → updates `lastError`
- ✅ `lastError` set → `overallStatus='error'`
- ✅ Takeover-like error normalized to `TAKEOVER_DETECTED` code
- ✅ Error with code → displayed in `overallStatusText`
- ✅ Operation log receives error entries
- ✅ Boot error → `bootError` state, `overallStatus='error'`
- ✅ Connection error during `createChannel` → error propagated
- ✅ Clear error on successful reconnect (`reconnectSoft/Hard`)

**Mocking:**
- Trigger `setErrorHandler` callback with various error shapes

---

### 6. Room Watch & Takeover Detection (Priority: HIGH)

**File:** `src/__tests__/provider.room-watch.test.tsx`

**Test cases:**

#### Room deletion
- ✅ `getRoom()` returns null → dispose signaler, error `ROOM_NOT_FOUND`
- ✅ Room watch stops after detection

#### Takeover detection
- ✅ `participantId` mismatch → dispose, error `TAKEOVER_DETECTED`
- ✅ `sessionId` mismatch → dispose, error `TAKEOVER_DETECTED`
- ✅ Operation log entry with takeover details

#### Peer left detection
- ✅ Caller connected, `calleeUid` becomes null → dispose, error `PEER_LEFT`
- ✅ Callee connected, `callerUid` becomes null → dispose, error `PEER_LEFT`
- ✅ Not active transport → peer left doesn't trigger

#### Watch lifecycle
- ✅ `startRoomWatch()` polls every 2s
- ✅ `stopRoomWatch()` stops polling
- ✅ Dispose signaler → stops room watch

**Mocking:**
- Mock timers (`vi.useFakeTimers()`)
- Mock `SignalDB.getRoom()` to return changing room state

---

### 7. Reconnection (Priority: MEDIUM)

**File:** `src/__tests__/provider.reconnect.test.tsx`

**Test cases:**
- ✅ `reconnectSoft()` → calls `signaler.reconnectSoft()`
- ✅ `reconnectHard(opts)` → calls `signaler.reconnectHard(opts)`
- ✅ Reconnect without signaler → throws error
- ✅ Reconnect clears `lastError`
- ✅ Operation log updated

**Mocking:**
- Mock signaler reconnect methods

---

### 8. Operation Log (Priority: MEDIUM)

**File:** `src/__tests__/provider.operation-log.test.tsx`

**Test cases:**
- ✅ `pushOperation(scope, message)` adds entry to log
- ✅ Log limited to 200 entries (MAX_OPERATION_LOG_SIZE)
- ✅ Newest entries first (prepend)
- ✅ `clearOperationLog()` clears all entries
- ✅ `toOperationScope(event)` correctly categorizes events:
  - 'error' for error events
  - 'signaling' for offer/answer/negotiation/epoch
  - 'data' for dc/selected-path
  - 'webrtc' for ice/connection/pc
  - 'system' as fallback

**Mocking:**
- Trigger various signaler events to populate log

---

### 9. Debug State & Handlers (Priority: MEDIUM)

**File:** `src/__tests__/provider.debug.test.tsx`

**Test cases:**
- ✅ `setDebugHandler` updates `debugState` in state
- ✅ Debug log deduplication by key (pcGeneration, phase, event, etc.)
- ✅ `describeDebugEvent()` returns human-readable descriptions
- ✅ `toDebugLogLine()` formats debug info
- ✅ Debug state reflected in `overallStatusText`

**Mocking:**
- Simulate debug callbacks with DebugState objects

---

### 10. Connection State Handlers (Priority: HIGH)

**File:** `src/__tests__/provider.connection-state.test.tsx`

**Test cases:**
- ✅ `setConnectionStateHandler` → updates `status` via `mapPcState()`
- ✅ `pcState='connected'` → clears `lastError`
- ✅ `setFastOpenHandler` → sets `status='connected'`
- ✅ `setReliableOpenHandler` → sets `status='connected'`
- ✅ `setFastCloseHandler` → sets `status='disconnected'`
- ✅ `setReliableCloseHandler` → sets `status='disconnected'`

**Mocking:**
- Simulate data channel open/close events

---

### 11. Hook Usage (Priority: HIGH)

**File:** `src/__tests__/use-vibe-rtc.test.tsx`

**Test cases:**
- ✅ `useVibeRTC()` outside provider → throws error "VibeRTCProvider missing"
- ✅ `useVibeRTC()` inside provider → returns context value
- ✅ Context value contains all expected methods and state

**Approach:**
- Render test component with/without provider

---

### 12. Overall Status Computation (Priority: MEDIUM)

**File:** `src/__tests__/overall-status.test.tsx`

**Test cases:**
- ✅ `bootError` → `overallStatus='error'`
- ✅ `lastError` → `overallStatus='error'`
- ✅ `booting=true` → `overallStatus='connecting'`
- ✅ `status='booting'` → `overallStatus='connecting'`
- ✅ `status='connecting'` → `overallStatus='connecting'`
- ✅ `status='disconnected' + roomId` → `overallStatus='connecting'`
- ✅ `status='connected'` → `overallStatus='connected'`
- ✅ `status='idle'` → `overallStatus='none'`

**Approach:**
- Test `toOverallStatus()` helper with various state combinations

---

## Test Configuration

### Update `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'jsdom', // Required for React components
        globals: true,
        setupFiles: ['./vitest.setup.ts'],
        reporters: ['default'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.test.{ts,tsx}', 'src/__tests__/**'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 75,
                statements: 80,
            },
        },
    },
})
```

### Add `vitest.setup.ts`

```typescript
import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Auto-cleanup after each test
afterEach(() => {
    cleanup()
})
```

### Required Dependencies

```json
{
  "devDependencies": {
    "@testing-library/react": "^14.2.1",
    "@testing-library/jest-dom": "^6.2.0",
    "@testing-library/user-event": "^14.5.2",
    "jsdom": "^24.0.0",
    "vitest": "^4.0.4"
  }
}
```

---

## Mock Strategy

### Core Mocks

**RTCSignaler mock:**
```typescript
const mockSignaler = {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    connect: vi.fn(),
    hangup: vi.fn(),
    endRoom: vi.fn(),
    sendFast: vi.fn(),
    sendReliable: vi.fn(),
    reconnectSoft: vi.fn(),
    reconnectHard: vi.fn(),
    inspect: vi.fn(),
    setConnectionStateHandler: vi.fn(),
    setMessageHandler: vi.fn(),
    setDebugHandler: vi.fn(),
    setErrorHandler: vi.fn(),
    setFastOpenHandler: vi.fn(),
    setReliableOpenHandler: vi.fn(),
    setFastCloseHandler: vi.fn(),
    setReliableCloseHandler: vi.fn(),
}
```

**SignalDB mock:**
```typescript
const mockSignalDB = {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    getRoom: vi.fn(),
    // + presence ops for attachAuto tests
    auth: { currentUser: { uid: 'test-uid' } },
    getParticipantId: vi.fn(),
    getRoleSessionId: vi.fn(),
    claimCallerIfFree: vi.fn(),
    claimCalleeIfFree: vi.fn(),
    tryTakeOver: vi.fn(),
    heartbeat: vi.fn(),
}
```

---

## Implementation Order

### Phase 1: Critical Path (Week 1)
1. Provider boot tests
2. Lifecycle methods (createChannel, joinChannel, disconnect, endRoom)
3. Error handling
4. Hook usage validation

### Phase 2: Core Functionality (Week 2)
5. Messaging tests
6. Connection state handlers
7. Room watch & takeover detection
8. Overall status computation

### Phase 3: Polish (Week 3)
9. Reconnection tests
10. Operation log tests
11. Debug state tests
12. Expand state.test.ts with missing helpers

---

## Success Criteria

- ✅ **Code coverage:** >80% lines, >75% branches
- ✅ **All critical paths tested:** boot, lifecycle, errors, messaging
- ✅ **Mock isolation:** No real RTCPeerConnection or network calls
- ✅ **Fast execution:** Full suite runs <10s
- ✅ **CI integration:** Tests run on every commit

---

## Future Enhancements

- Integration tests with real Firebase signaling backend (separate test suite)
- Playwright E2E tests for demo app flows
- Performance/stress testing (100+ rapid connect/disconnect cycles)
- Visual regression tests for custom `renderLoading`/`renderBootError` components
