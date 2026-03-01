---
'@vibe-rtc/rtc-core': minor
'@vibe-rtc/rtc-react': minor
---

Introduce a production-ready LAN-first WebRTC connection strategy with automatic STUN fallback in `rtc-core`.

In `rtc-react`, expose `connectionStrategy` through `VibeRTCProvider` and add aggregated lifecycle observability:
`overallStatus`, `overallStatusText`, and `operationLog`.
