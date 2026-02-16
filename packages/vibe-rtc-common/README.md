# vibe-rtc-common

Convenience package that re-exports `@vibe-rtc/rtc-core` and `@vibe-rtc/rtc-firebase`.

## Install

```bash
pnpm add vibe-rtc-common
```

## Exports

- root export: core + firebase exports
- `vibe-rtc-common/core`: core-only re-exports
- `vibe-rtc-common/firebase`: firebase-only re-exports

## Example

```ts
import { RTCSignaler, FBAdapter, ensureFirebase } from 'vibe-rtc-common'
```

Or scoped entrypoints:

```ts
import { RTCSignaler } from 'vibe-rtc-common/core'
import { FBAdapter } from 'vibe-rtc-common/firebase'
```

## Build

```bash
pnpm --filter vibe-rtc-common build
```
