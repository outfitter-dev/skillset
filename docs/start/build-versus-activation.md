---
description: Separates Skillset's deterministic repository builds from provider installation, trust, and runtime activation.
---

# Build Versus Activation

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration.

That boundary is deliberate. A build is a deterministic repository operation: Skillset validates authored source, previews destination changes, and—after explicit confirmation—writes provider-native files plus provenance. Those changes can be inspected, tested, committed, and reviewed like other project files.

Activation gives those files runtime authority. Depending on the provider, activation may mean installing a plugin, trusting a repository, enabling a hook, connecting an MCP server, or placing files in user-level configuration. Those actions have different security and lifecycle consequences, so Skillset does not infer them from a successful build.

## What build commands may do

- Read `skillset.yaml` and the `.skillset/` source tree.
- Validate source and target compatibility.
- Preview deterministic repo-local destination changes.
- Write confirmed generated files, lock provenance, and recoverable backups.
- Report whether generated output is missing, stale, edited, or unsupported.

## What requires a separate decision

- Installing or enabling a plugin in a provider.
- Trusting generated hooks, scripts, apps, or server configuration.
- Symlinking output into a user-level skill or plugin directory.
- Publishing a package, plugin, marketplace entry, or repository.
- Changing Claude, Codex, Cursor, or other user-level settings.

After `skillset build --yes`, use `skillset check --only outputs` to prove the repository projection is current. Then follow the target provider's own review and activation process. The generated [support matrix](../reference/support-matrix.md) describes what Skillset can render; it does not claim that any output is installed or active.
