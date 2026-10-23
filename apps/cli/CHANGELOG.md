# @skillset/cli

## 0.30.0

### Minor Changes

- 28dc751: `skillset import` and `skillset adopt` now warn instead of failing when a provider's native plugin `author` cannot become canonical source (a scalar like `42`, `{}`, an email-only object, or an empty or non-string `name`). The raw value is kept on that provider's `<provider>.manifest.author` override so it doesn't disappear, and `skillset.author` still comes only from a readable author. The `unreadable-plugin-author` adopt diagnostic is now a warning, so adoption plans and writes go through. A later build can still fail the provider's manifest conformance if the kept value is invalid there.

### Patch Changes

- 2bcac1a: Change-ledger and release fixes:

  - `draft`, `promote`, and `move --yes` now mint a fresh ledger event id per run, so two branches running the same command from the same trunk ledger no longer produce a duplicate id that breaks every ledger read after a merge.
  - `bun run change-stream:guard` accept a second amendment of the same change or release, and compare trunk's prefix correctly in CRLF checkouts.
  - A failed `release apply` restores pending change files with their original permissions, and rolling back ledger appends keeps unrelated blank lines.
  - Release baseline seeding (`skillset setup`, `skillset import`) writes `state.json` under the change-ledger lock.
  - Note for `--json` consumers: since the lifecycle ledger moved to an owned append, the ledger entry in `draft`, `promote`, and `move` JSON plans reports `plan.operations[].kind: "append"` where it previously reported `"update"`.

- f28936c: `skillset list` now labels the bare `.skillset/rules` source as "workspace rules" instead of the retired "workspace instructions".
- 9509bf3: Package placement errors no longer cite internal tracker IDs; they say the requested `plugins.output` placement is not yet supported.
- c9a1fd9: `skillset resolve` now finds a tracked `skillset.lock` whose path contains a newline; it reads tracked locks NUL-delimited instead of line by line.
- 3525b36: Relative Markdown links in rule bodies now work in every destination. Skillset reads a rule's links as relative to the directory the rule applies to (the repository root for `RULES.md`), keeps them unchanged in that directory's `AGENTS.md`, and rebases them for `.claude/CLAUDE.md`, `.claude/rules/`, and `.cursor/rules/`.
- 72b2ad6: The SessionStart stale-output hint now tells agents to preview with `npx skillset build`, write with `npx skillset build --yes`, and read the `use-skillset` skill, instead of naming a `skillset-help` skill that does not exist.
- 5969c05: Source move and pending-change fixes:

  - Releasing a reason after `skillset move` retires the old selector from the moved skill's own version instead of the workspace version, so a skill released at 1.2.3 no longer records its retirement as `0.1.0 -> 0.1.1`.
  - Moving a skill out of a plugin no longer leaves the source plugin (`plugin:<name>`) uncovered in `change check` and `change refresh`.
  - Moving a skill onto a selector that an earlier move in the same release window vacated now associates the removal with the pending reason instead of blocking check, refresh, and release.
  - Recovery guidance offers `skillset change migrate` when a legacy entry's only error is stale evidence, since migration succeeds in that case.
  - Rewriting authored YAML on move or rename keeps flow lists such as `scopes: [x]` and their comments instead of turning them into block lists.

## 0.29.0

## 0.28.0

## 0.27.0

## 0.26.1

### Patch Changes

- b284bf5: Normalize equivalent custom plugin output roots before rendering the repository README path so build, diff, and verify agree on the canonical generated file.

## 0.26.0

### Minor Changes

- 716578f: Render complete Claude plugin bundles at their explicit destinations, with independent locks and marketplace-relative source provenance. Validate bundle ownership and preserve nested destinations beneath custom marketplace roots.
- b5b7201: Validate and parse plugin-local `claude.bundle.path` destinations, rejecting unsupported targets, workspace-level overrides, and non-portable directory paths.

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
