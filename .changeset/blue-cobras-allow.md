---
"@vibe-rtc/rtc-firebase": minor
---

Split Node-only Firebase config helpers into a dedicated `@vibe-rtc/rtc-firebase/node` export.
This keeps the root browser entry free from Node dependencies (`fs`/`dotenv`) and fixes demo runtime on GitHub Pages.
