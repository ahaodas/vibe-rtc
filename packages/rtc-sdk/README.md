# @vibe-rtc/sdk

Unified package for `rtc-core`, `rtc-react`, and `rtc-firebase`.

## Install

```bash
pnpm add @vibe-rtc/sdk
```

## Usage

Root export (core + firebase):

```ts
import { RTCSignaler, FBAdapter, ensureFirebase } from '@vibe-rtc/sdk'
```

Namespaced exports:

```ts
import { rtcCore, rtcFirebase } from '@vibe-rtc/sdk'
```

Subpath exports:

```ts
import { RTCSignaler } from '@vibe-rtc/sdk/core'
import { VibeRTCProvider } from '@vibe-rtc/sdk/react'
import { FBAdapter } from '@vibe-rtc/sdk/firebase'
```

Use subpath imports in apps to avoid pulling unused modules into the bundle.
