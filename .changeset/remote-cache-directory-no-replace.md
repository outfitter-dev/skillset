---
"skillset": patch
---

Publish remote-repository cache checkouts with the host atomic no-replace rename so an outside occupant is refused instead of replaced, and a late symlink occupant is refused instead of followed. Marketplace checks on a cache filesystem without that primitive now report the move-the-cache remedy instead of an invalid-workspace reason, and a host rename failure such as a permission error reports a cache-publication reason.
