# @vibe-rtc/rtc-firebase

## [0.2.4](https://github.com/ahaodas/vibe-rtc/compare/rtc-firebase-v0.2.3...rtc-firebase-v0.2.4) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.4

## [0.2.3](https://github.com/ahaodas/vibe-rtc/compare/rtc-firebase-v0.2.2...rtc-firebase-v0.2.3) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.3

## [0.2.2](https://github.com/ahaodas/vibe-rtc/compare/rtc-firebase-v0.2.1...rtc-firebase-v0.2.2) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.2

## [0.2.1](https://github.com/ahaodas/vibe-rtc/compare/rtc-firebase-v0.2.0...rtc-firebase-v0.2.1) (2026-03-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.1

## [0.2.0](https://github.com/ahaodas/vibe-rtc/compare/rtc-firebase-v0.1.2...rtc-firebase-v0.2.0) (2026-03-18)


### Features

* **rtc-core:** add ping/net RTT telemetry and phase ice filters ([1cfbba1](https://github.com/ahaodas/vibe-rtc/commit/1cfbba1a2ee5b41db0a29a7611c18fca08bdcd9a))
* **rtc-core:** add typed error codes and stabilize test setup ([d27ff7d](https://github.com/ahaodas/vibe-rtc/commit/d27ff7da7b87ad5f0952c98419d120ccb91a30f5))
* **rtc-firebase:** implement role-slot takeover sessions ([ff85866](https://github.com/ahaodas/vibe-rtc/commit/ff8586627c508c8d34a76f4baa75795de8117252))
* **rtc:** propagate peer leave via signaling adapter ([bc3a8eb](https://github.com/ahaodas/vibe-rtc/commit/bc3a8ebaefb8f1c391a35b9c64918e292a6c335e))
* **security:** harden Firestore signaling and add emulator rules tests ([73fcca1](https://github.com/ahaodas/vibe-rtc/commit/73fcca1004c2c088607c5f19b51da4223d0254fc))


### Bug Fixes

* **github:** stabilize pages demo deployment and connectivity ([d3845c5](https://github.com/ahaodas/vibe-rtc/commit/d3845c533f65d162185eb6eaba90140b392b6497))
* **rtc-firebase:** harden takeover watch against startup stale snapshots ([29d80a6](https://github.com/ahaodas/vibe-rtc/commit/29d80a61bec759ff67fd0d294d1ee899091d8ccd))
* **rtc:** harden reconnect lifecycle and ICE persistence ([9f3af0f](https://github.com/ahaodas/vibe-rtc/commit/9f3af0fd848a093e8984600ff34452a9dfe1d1aa))
* **rtc:** harden takeover flow across sessions and UIDs ([ca1520d](https://github.com/ahaodas/vibe-rtc/commit/ca1520d86927c290d8c6c178f238577da2465b7a))
* **rtc:** stabilize reload recovery and signaling epochs ([56e4b0a](https://github.com/ahaodas/vibe-rtc/commit/56e4b0aebae50c97d8d2a22010222fc5e677b5b4))
* **signaling:** preserve ICE candidate flow across pc generations ([eccc75c](https://github.com/ahaodas/vibe-rtc/commit/eccc75cf9fdb5cb79e7c2837c2a89000dc4e3839))
* **signaling:** use sessionId for stale message filtering ([0d54db1](https://github.com/ahaodas/vibe-rtc/commit/0d54db1ccc7e2d7cc715b348ba0f9fd85eb60525))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @vibe-rtc/rtc-core bumped to 0.3.0

## 0.1.2

### Patch Changes

- a8e0fa4: Fix ICE candidate propagation in reconnect scenarios by carrying `pcGeneration` in candidate payloads and tightening candidate stream deduplication keys.

  In Firebase signaling adapter, process both `added` and `modified` candidate snapshot events with per-document deduplication to avoid dropping refreshed ICE updates after fast page reloads.

- Updated dependencies [a8e0fa4]
  - @vibe-rtc/rtc-core@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [c4b7cb6]
  - @vibe-rtc/rtc-core@0.2.0

## 0.1.0

### Minor Changes

- 6922554: Split Node-only Firebase config helpers into a dedicated `@vibe-rtc/rtc-firebase/node` export.
  This keeps the root browser entry free from Node dependencies (`fs`/`dotenv`) and fixes demo runtime on GitHub Pages.

## 0.0.1

### Patch Changes

- Updated dependencies [ec696ad]
  - @vibe-rtc/rtc-core@0.1.0
