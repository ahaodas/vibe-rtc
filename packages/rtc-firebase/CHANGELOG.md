# @vibe-rtc/rtc-firebase

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
