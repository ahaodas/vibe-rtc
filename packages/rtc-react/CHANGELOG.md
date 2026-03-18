# @vibe-rtc/rtc-react

## [0.3.8](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.3.7...rtc-react-v0.3.8) (2026-03-18)


### Bug Fixes

* **rtc-react:** define git repository URL for package metadata ([6f76389](https://github.com/ahaodas/vibe-rtc/commit/6f76389b5a40beb5621d1c1432e440b94ffe7bec))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.7

## [0.3.7](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.3.6...rtc-react-v0.3.7) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.6

## [0.3.6](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.3.5...rtc-react-v0.3.6) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.5

## [0.3.5](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.3.4...rtc-react-v0.3.5) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.4

## [0.3.4](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.3.3...rtc-react-v0.3.4) (2026-03-18)


### Bug Fixes

* **rtc-react:** refine package metadata ([36fe013](https://github.com/ahaodas/vibe-rtc/commit/36fe0134e50c48886d97748b16ab85dd9ef28be1))

## [0.3.3](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.3.2...rtc-react-v0.3.3) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.3

## [0.3.2](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.3.1...rtc-react-v0.3.2) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.2

## [0.3.1](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.3.0...rtc-react-v0.3.1) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.1

## [0.3.0](https://github.com/ahaodas/vibe-rtc/compare/rtc-react-v0.2.0...rtc-react-v0.3.0) (2026-03-18)


### Features

* **config:** move ICE server setup to init config ([a64f956](https://github.com/ahaodas/vibe-rtc/commit/a64f9560d1773242b32070373750b6d8df2e2acc))
* **demo:** add latency HUD and net route warnings ([96ff12e](https://github.com/ahaodas/vibe-rtc/commit/96ff12ecd543aaaa4b4b9d39bd90e5e4088dad7e))
* **demo:** split caller/callee routes and improve room lifecycle UX ([dc27059](https://github.com/ahaodas/vibe-rtc/commit/dc270593d7ef6b9a7b15eba410f456e66c058304))
* **rtc-core:** add typed error codes and stabilize test setup ([d27ff7d](https://github.com/ahaodas/vibe-rtc/commit/d27ff7da7b87ad5f0952c98419d120ccb91a30f5))
* **rtc-react:** add reconnect api and state tests ([fcb4940](https://github.com/ahaodas/vibe-rtc/commit/fcb49403f6af8ef3c7f0d53d8e36d6d67bb07ab1))
* **rtc-react:** add unified lifecycle status and operation log ([19e1e2b](https://github.com/ahaodas/vibe-rtc/commit/19e1e2bc7cbd1dad0324f089dc5d6be4c4bc082a))
* **rtc-react:** expose connectionStrategy in provider API ([472f787](https://github.com/ahaodas/vibe-rtc/commit/472f787c598f4a718a71d168605a04eb27ead264))
* **rtc-react:** show connected route details from stats ([80c13b9](https://github.com/ahaodas/vibe-rtc/commit/80c13b9298a2ee6637e3ec51dd9415202a4379ee))
* **rtc-react:** support per-session strategy overrides ([27b6afa](https://github.com/ahaodas/vibe-rtc/commit/27b6afacefa16c441a18e2c28e18c4c6a75f55de))
* **rtc-react:** surface takeover and stop inactive role ([93d6200](https://github.com/ahaodas/vibe-rtc/commit/93d620033cffc5e254d30e9bffc800212ef2b26a))
* **rtc:** propagate peer leave via signaling adapter ([bc3a8eb](https://github.com/ahaodas/vibe-rtc/commit/bc3a8ebaefb8f1c391a35b9c64918e292a6c335e))
* **sdk:** add unified @vibe-rtc/sdk package ([2cf278d](https://github.com/ahaodas/vibe-rtc/commit/2cf278d531c72149937e6bfccdf3324a6f66ae9a))


### Bug Fixes

* **rtc-react:** classify operation scopes case-insensitively ([9f43750](https://github.com/ahaodas/vibe-rtc/commit/9f43750d29807af3fef37205905db3841cd9a7a9))
* **rtc-react:** clear stale errors and remove built-in boot fallback UI ([8a5c463](https://github.com/ahaodas/vibe-rtc/commit/8a5c4634249aa0bec0e7886da75c3486d51beb75))
* **rtc-react:** keep reconnect state and expose lanFirstTimeoutMs ([c416cd6](https://github.com/ahaodas/vibe-rtc/commit/c416cd618ff9c785a7622b1d88da251cb8b31f8e))
* **rtc-react:** preserve runtime status during boot and normalize takeover errors ([e19db8f](https://github.com/ahaodas/vibe-rtc/commit/e19db8fccd6095468a070a4a02aaef2a16a02d24))
* **rtc:** harden takeover flow across sessions and UIDs ([ca1520d](https://github.com/ahaodas/vibe-rtc/commit/ca1520d86927c290d8c6c178f238577da2465b7a))
* **typecheck:** align demo/test typings and enforce pre-commit checks ([c8a720f](https://github.com/ahaodas/vibe-rtc/commit/c8a720feec926c6c65f016ec6b5a030a64b1c665))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.0

## 0.2.0

### Minor Changes

- c4b7cb6: Introduce a production-ready LAN-first WebRTC connection strategy with automatic STUN fallback in `rtc-core`.

  In `rtc-react`, expose `connectionStrategy` through `VibeRTCProvider` and add aggregated lifecycle observability:
  `overallStatus`, `overallStatusText`, and `operationLog`.

### Patch Changes

- Updated dependencies [c4b7cb6]
  - @vibe-rtc/rtc-core@0.2.0

## 0.1.1

### Patch Changes

- ec696ad: Add configurable ICE server helpers and move demo/e2e initialization to explicit rtcConfiguration setup.
  React provider now relies on rtc-core defaults when iceServers are not provided.
- Updated dependencies [ec696ad]
  - @vibe-rtc/rtc-core@0.1.0
