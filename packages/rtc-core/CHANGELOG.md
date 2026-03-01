# @vibe-rtc/rtc-core

## 0.2.0

### Minor Changes

- c4b7cb6: Introduce a production-ready LAN-first WebRTC connection strategy with automatic STUN fallback in `rtc-core`.

  In `rtc-react`, expose `connectionStrategy` through `VibeRTCProvider` and add aggregated lifecycle observability:
  `overallStatus`, `overallStatusText`, and `operationLog`.

## 0.1.0

### Minor Changes

- ec696ad: Add configurable ICE server helpers and move demo/e2e initialization to explicit rtcConfiguration setup.
  React provider now relies on rtc-core defaults when iceServers are not provided.
