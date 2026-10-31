---
description: Separates Skillset's deterministic repository builds from provider installation, trust, and runtime activation.
---

# Build Versus Activation

Build commands render files without installing, trusting, activating, symlinking, or mutating user-level provider configuration. The separate, explicit `hooks setup` workflow can configure one generated-edit guard after a preview and `--yes`; it never grants provider trust.

That boundary is deliberate. A build is a deterministic repository operation: Skillset validates authored source, previews destination changes, and—after explicit confirmation—writes provider-native files plus provenance. Those changes can be inspected, tested, committed, and reviewed like other project files.

Activation gives those files runtime authority. Depending on the provider, activation may mean installing a plugin, trusting a repository, enabling a hook, connecting an MCP server, or placing files in user-level configuration. Those actions have different security and lifecycle consequences, so Skillset does not infer them from a successful build.

## What build commands may do

- Read `skillset.yaml` and the `.skillset/` source tree.
- Validate source and target compatibility.
- Preview deterministic repo-local destination changes.
- Write confirmed generated files, lock provenance, and recoverable backups.
- Report whether generated output is missing, stale, edited, or unsupported.

## Explicit generated-edit hook setup

Use `skillset hooks setup --target claude --scope project` (or `--target codex`) to preview the exact configuration and command. `--scope user` explicitly selects user configuration; `--yes` applies the plan. Removal uses the same selection with `--remove`, followed by `--yes` after review. See [Hooks](../reference/features/hooks.md#explicit-generated-edit-guard-setup) for ownership, environment overrides, supported platforms and trust requirements.

## What requires a separate decision

- Installing or enabling a plugin in a provider.
- Trusting generated hooks, scripts, apps, or server configuration.
- Symlinking output into a user-level skill or plugin directory.
- Publishing a package, plugin, marketplace entry, or repository.
- Changing Claude, Codex, Cursor, or other user-level settings.

After `skillset build --yes`, use `skillset check --only outputs` to prove the repository projection is current. Then follow the target provider's own review and activation process. The generated [support matrix](../reference/support-matrix.md) describes what Skillset can render; it does not claim that any output is installed or active.

The optional project SessionStart hook follows the same boundary: it reports stale generated paths and recommends a build, but never runs the build, installs a hook, or changes provider trust on its own. See [Hooks](../reference/features/hooks.md#skillset-owned-project-sessionstart).
