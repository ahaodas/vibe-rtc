# @vibe-rtc/sdk

## 0.1.2

### Patch Changes

- Updated dependencies [c4b7cb6]
  - @vibe-rtc/rtc-core@0.2.0
  - @vibe-rtc/rtc-react@0.2.0
  - @vibe-rtc/rtc-firebase@0.1.1

## 0.1.1

### Patch Changes

- 628d738: Limit `@vibe-rtc/sdk` root export to core and firebase modules only.
  Use `@vibe-rtc/sdk/react` for React bindings to avoid pulling React layer into non-React bundles.

## 0.1.0

### Minor Changes

- 2cf278d: Add new unified package `@vibe-rtc/sdk` that re-exports core, react, and firebase modules.
  Supports root import and subpath imports (`/core`, `/react`, `/firebase`).
