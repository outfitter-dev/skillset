---
"skillset": minor
---

Make first-build checks and source-readiness guidance follow one truthful build transcript, and apply ordinary output plans transactionally.

Output writes and moves are now installed exclusively rather than with an overwrite-capable rename, so a workspace entry that appears between planning and install is rejected instead of silently replaced. Three cases that previously succeeded now fail loudly:

- a write or move target that becomes occupied after final approval is rejected rather than overwritten;
- on a case-sensitive filesystem, a build where a stale managed `guide.txt` and a distinct existing `Guide.txt` both exist is rejected rather than overwriting the unmanaged file;
- rollback no longer overwrites an entry that reappeared at a staged preimage's path; the preimage is preserved, the recovery journal is retained, and its recovery path is reported in the rollback failures.

Rollback also drains case-staging directories before removing directories the transaction created, so `ENOTEMPTY` no longer masks the original failure.

Exclusive install takes the destination name with an exclusive create rather than checking it first: regular files with `link()`, directories with `mkdir()`. Both refuse an existing entry — including an empty directory or a symbolic link, which is never followed — so a directory install can no longer discard an unapproved entry that appeared after inspection.

Note for consumers on filesystems without hard-link support (exFAT/FAT32, some SMB mounts): file install uses `link()`, which fails there where `rename()` previously worked. This fails loudly rather than corrupting output.
