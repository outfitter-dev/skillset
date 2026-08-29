---
"@skillset/cli": minor
---

Require Bun 1.4 for the Bun-distributed CLI, align repository tooling and native artifacts with that floor, and install transaction directories with host-native atomic no-replace rename semantics.

Directory installs now fail closed instead of falling back to a non-atomic check-then-rename sequence. On hosts that cannot provide the atomic no-replace primitive — filesystems without `renameat2`/`renamex_np` no-replace support (NFS without v4.2 flag support, older overlayfs, OpenZFS before 2.2, network mounts) and Linux hosts without glibc (musl/Alpine) — directory installs report an `unsupported` error rather than completing with weaker guarantees. Moving the workspace to a supported local filesystem restores installs; musl support is planned.
