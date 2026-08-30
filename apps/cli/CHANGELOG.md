# @skillset/cli

## 0.25.0

### Minor Changes

- b53c0f7: Require Bun 1.4 for the Bun-distributed CLI, align repository tooling and native artifacts with that floor, and install transaction directories with host-native atomic no-replace rename semantics.

  Directory installs now fail closed instead of falling back to a non-atomic check-then-rename sequence. On hosts that cannot provide the atomic no-replace primitive — filesystems without `renameat2`/`renamex_np` no-replace support (NFS without v4.2 flag support, older overlayfs, OpenZFS before 2.2, network mounts) and Linux hosts without glibc (musl/Alpine) — directory installs report an `unsupported` error rather than completing with weaker guarantees. Moving the workspace to a supported local filesystem restores installs; musl support is planned.

### Patch Changes

- 8bbb8d3: Generated-file installs fall back to exclusive create on filesystems without hard-link support (exFAT, FAT32, some SMB mounts) instead of failing the transaction. The no-replace guarantee is preserved; only content atomicity is relaxed on those volumes.
- e64f5ff: Build reports no longer claim a path was deleted when an entry was recreated at that path after preimage staging. The transaction now classifies such paths as superseded — the unmanaged entry wins and stays on disk — and the report excludes them from `deletedPaths`.

## 0.24.0

## 0.23.0

### Minor Changes

- 9175b61: Publish the complete Bun-targeted CLI as `@skillset/cli`, keep the transitional unscoped bundle byte-identical, and expose `skillset --version` as a shared distribution smoke contract.

### Patch Changes

- 74c0e09: Make the native global command the primary onboarding path and document exact npm, Homebrew, GitHub asset, Bun, CI, local dependency, and contributor runtime requirements.
- c6fd10f: Align the native distribution set with the current source version before the one-time package bootstrap.
