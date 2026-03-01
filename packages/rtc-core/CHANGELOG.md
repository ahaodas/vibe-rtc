# @vibe-rtc/rtc-core

## 0.2.1

### Patch Changes

- a8e0fa4: Fix ICE candidate propagation in reconnect scenarios by carrying `pcGeneration` in candidate payloads and tightening candidate stream deduplication keys.

  In Firebase signaling adapter, process both `added` and `modified` candidate snapshot events with per-document deduplication to avoid dropping refreshed ICE updates after fast page reloads.

## 0.2.0

### Minor Changes

- c4b7cb6: Introduce a production-ready LAN-first WebRTC connection strategy with automatic STUN fallback in `rtc-core`.

  In `rtc-react`, expose `connectionStrategy` through `VibeRTCProvider` and add aggregated lifecycle observability:
  `overallStatus`, `overallStatusText`, and `operationLog`.

## 0.1.0

### Minor Changes

- ec696ad: Add configurable ICE server helpers and move demo/e2e initialization to explicit rtcConfiguration setup.
  React provider now relies on rtc-core defaults when iceServers are not provided.
