---
"skillset": minor
---

Make first-build checks and source-readiness guidance follow one truthful build transcript, and apply ordinary output plans transactionally.

Output writes and moves are now installed exclusively rather than with an overwrite-capable rename, so a workspace entry that appears between planning and install is rejected instead of silently replaced. Three cases that previously succeeded now fail loudly:

- a write or move target that becomes occupied after final approval is rejected rather than overwritten;
- on a case-sensitive filesystem, a build where a stale managed `guide.txt` and a distinct existing `Guide.txt` both exist is rejected rather than overwriting the unmanaged file;
- rollback no longer overwrites an entry that reappeared at a staged preimage's path; the preimage is preserved, the recovery journal is retained, and its recovery path is reported in the rollback failures.

Rollback also drains case-staging directories before removing directories the transaction created, so `ENOTEMPTY` no longer masks the original failure.

Exclusive install takes the destination name with an exclusive create rather than checking it first: regular files with `link()`, directories with `mkdir()`. Both refuse an existing entry — including an empty directory or a symbolic link, which is never followed — so a file install is atomically no-replace, and a directory install no longer discards an entry that is already there.

A directory install must then move onto the name it claimed, and POSIX `rename` replaces an empty directory. The claim's identity is now recorded when it is created and verified immediately before it is consumed, so a claim that another process removed and replaced — or wrote into — reports the destination as occupied and fails the transaction without touching the entry found there. This is detection that fails closed, not atomicity: neither Bun nor Node exposes a no-replace rename (`renameat2(RENAME_NOREPLACE)`, `renamex_np(RENAME_EXCL)`), so on POSIX a substitution that lands between that final verification and the `rename` itself is still replaced. Kernel refusals (`ENOTEMPTY`, `ENOTDIR`) also fail closed now instead of surfacing as raw filesystem errors.

Note for consumers on filesystems without hard-link support (exFAT/FAT32, some SMB mounts): file install uses `link()`, which fails there where `rename()` previously worked. This fails loudly rather than corrupting output.
