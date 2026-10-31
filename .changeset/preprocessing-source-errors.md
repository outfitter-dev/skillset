---
"skillset": patch
---

Distinguish deliberate preprocessing source rejections from filesystem and internal failures. Preserve nested source diagnostic causes, propagate operational failures unchanged, and retain serialization failure causes without treating arbitrary serializer exceptions as invalid source.
