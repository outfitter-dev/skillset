---
"@skillset/cli": patch
---

Generated-file installs fall back to exclusive create on filesystems without hard-link support (exFAT, FAT32, some SMB mounts) instead of failing the transaction. The no-replace guarantee is preserved; only content atomicity is relaxed on those volumes.
