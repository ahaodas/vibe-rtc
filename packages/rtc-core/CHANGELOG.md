# @vibe-rtc/rtc-core

## [0.3.2](https://github.com/ahaodas/vibe-rtc/compare/rtc-core-v0.3.1...rtc-core-v0.3.2) (2026-03-18)


### Bug Fixes

* **rtc-core:** refine package metadata ([a17d877](https://github.com/ahaodas/vibe-rtc/commit/a17d877dc6906d826237133c4c604e821c5bfb94))

## [0.3.1](https://github.com/ahaodas/vibe-rtc/compare/rtc-core-v0.3.0...rtc-core-v0.3.1) (2026-03-18)


### Bug Fixes

* **rtc-core:** remove unused backward-compatible aliases ([095fa5d](https://github.com/ahaodas/vibe-rtc/commit/095fa5d26c925d86e5ffbda7e1f669999963f8cd))

## [0.3.0](https://github.com/ahaodas/vibe-rtc/compare/rtc-core-v0.2.1...rtc-core-v0.3.0) (2026-03-18)


### Features

* **config:** move ICE server setup to init config ([a64f956](https://github.com/ahaodas/vibe-rtc/commit/a64f9560d1773242b32070373750b6d8df2e2acc))
* **core:** add configurable ready timeout and gated debug logs ([3ed6510](https://github.com/ahaodas/vibe-rtc/commit/3ed65103f48eb12b16ec15237f5117cb5910e269))
* **demo:** split caller/callee routes and improve room lifecycle UX ([dc27059](https://github.com/ahaodas/vibe-rtc/commit/dc270593d7ef6b9a7b15eba410f456e66c058304))
* **rtc-core:** add browser-native connection strategy ([a3f111e](https://github.com/ahaodas/vibe-rtc/commit/a3f111e4d3f05bf462ab0efedff0d7832225d0d9))
* **rtc-core:** add ping/net RTT telemetry and phase ice filters ([1cfbba1](https://github.com/ahaodas/vibe-rtc/commit/1cfbba1a2ee5b41db0a29a7611c18fca08bdcd9a))
* **rtc-core:** add session-aware takeover isolation ([0346828](https://github.com/ahaodas/vibe-rtc/commit/0346828adbf1267527f168cbc08dd0ed074249fb))
* **rtc-core:** add typed error codes and stabilize test setup ([d27ff7d](https://github.com/ahaodas/vibe-rtc/commit/d27ff7da7b87ad5f0952c98419d120ccb91a30f5))
* **rtc-core:** implement LAN_FIRST strategy with STUN fallback ([75069a6](https://github.com/ahaodas/vibe-rtc/commit/75069a672ce49c95d904f87cc78665de96f1ad62))
* **rtc-core:** resolve selected ICE path from stats ([514c565](https://github.com/ahaodas/vibe-rtc/commit/514c565f086fbc8f2f1e7cd54f557864f0670f59))
* **rtc:** propagate peer leave via signaling adapter ([bc3a8eb](https://github.com/ahaodas/vibe-rtc/commit/bc3a8ebaefb8f1c391a35b9c64918e292a6c335e))


### Bug Fixes

* **rtc-core:** preserve pre-offer candidates on callee reload ([7bddef1](https://github.com/ahaodas/vibe-rtc/commit/7bddef15d0606a761ad74221b90d67fc7622d9f8))
* **rtc-core:** stabilize create flow and slot ownership checks ([9f04285](https://github.com/ahaodas/vibe-rtc/commit/9f042855a54b32c5abe98f2cd2f24a3aacfcb441))
* **rtc-core:** stabilize STUN reconnect watchdog flow ([baec326](https://github.com/ahaodas/vibe-rtc/commit/baec32634de9287087855176285b0cdcefaf5399))
* **rtc:** harden reconnect lifecycle and ICE persistence ([9f3af0f](https://github.com/ahaodas/vibe-rtc/commit/9f3af0fd848a093e8984600ff34452a9dfe1d1aa))
* **rtc:** harden takeover flow across sessions and UIDs ([ca1520d](https://github.com/ahaodas/vibe-rtc/commit/ca1520d86927c290d8c6c178f238577da2465b7a))
* **rtc:** stabilize reload recovery and signaling epochs ([56e4b0a](https://github.com/ahaodas/vibe-rtc/commit/56e4b0aebae50c97d8d2a22010222fc5e677b5b4))
* **signaling:** preserve ICE candidate flow across pc generations ([eccc75c](https://github.com/ahaodas/vibe-rtc/commit/eccc75cf9fdb5cb79e7c2837c2a89000dc4e3839))
* **signaling:** use sessionId for stale message filtering ([0d54db1](https://github.com/ahaodas/vibe-rtc/commit/0d54db1ccc7e2d7cc715b348ba0f9fd85eb60525))

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
