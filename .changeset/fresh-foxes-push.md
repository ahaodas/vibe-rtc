---
'@vibe-rtc/rtc-core': patch
'@vibe-rtc/rtc-firebase': patch
---

Fix ICE candidate propagation in reconnect scenarios by carrying `pcGeneration` in candidate payloads and tightening candidate stream deduplication keys.

In Firebase signaling adapter, process both `added` and `modified` candidate snapshot events with per-document deduplication to avoid dropping refreshed ICE updates after fast page reloads.
