---
"@vibe-rtc/sdk": patch
---

Limit `@vibe-rtc/sdk` root export to core and firebase modules only.
Use `@vibe-rtc/sdk/react` for React bindings to avoid pulling React layer into non-React bundles.
