---
"skillset": patch
"@skillset/cli": patch
---

Reject native Claude plugin imports whose additional hook declarations would be dropped while synthesizing source configuration, preserving original files and leaving the destination unclaimed.
