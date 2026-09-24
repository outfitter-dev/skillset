---
description: Rebuilds pre-v4 generated state for current projection roles without granting old locks cleanup authority.
---

# Rebuild Generated State for Inherent Standards

Skillset 0.27.0 makes every adopted, applicable Agent standard an inherent projection. Existing provider targets remain provider choices, but valid rule, skill, and plugin source may add `AGENTS.md`, `.agents/skills/`, or `plugins/<plugin>/` package output without a standards selector.

This is a one-time generated-state rebuild, not a source migration. Preserve `skillset.yaml`, `.skillset/`, provider-native source, user edits, and unmanaged neighbors. Do not add `compile.agents` or another opt-out. Plugin-owned skills now have one standard placement inside their Agent Plugins package; `.agents/skills/` contains standalone standard skills unless a separately owned project-use projection is present. Pre-v4 locks can explain why a rebuild is required, but they cannot prove ownership or authorize deletion.

## Stop Conditions

Stop before moving or rebuilding anything when:

- local changes have not been classified by the repository owner;
- a proposed generated root contains authored or uncertain files;
- a lock is malformed, from the future, or disagrees with the configured output roots;
- the canonical source does not pass `skillset check`; or
- the required released Skillset version is unavailable.

Do not delete a mixed directory, recursively replace a repository root, or infer ownership from a pre-v4 lock. Move only individually reviewed generated paths to a recoverable backup outside every configured output root.

## Evidence to Capture

Before the rebuild, record:

```bash
git -C /absolute/path/to/repository rev-parse HEAD
git -C /absolute/path/to/repository status --short
bunx @skillset/cli@0.27.0 --version
bunx @skillset/cli@0.27.0 status --json --root /absolute/path/to/repository
bunx @skillset/cli@0.27.0 check --only outputs --root /absolute/path/to/repository
```

For schema-v1 through schema-v3 state, the last two commands should report that the lock is rebuild-only and cannot authorize cleanup. Save the complete diagnostic. An old lock with `items: []` still blocks the build; an empty inventory does not make its provenance trustworthy or trigger an automatic upgrade. If the owner confirms that no generated output remains under that lock, move the lock itself to a recoverable backup outside every configured output root before previewing a fresh build. Otherwise classify and back up each generated path as described below. Record each configured root, each path the owner classifies as generated, the backup location, and the repository owner accepting that classification.

After moving only those reviewed paths, rebuild from canonical source and verify the new ownership model:

```bash
bunx @skillset/cli@0.27.0 build --root /absolute/path/to/repository
bunx @skillset/cli@0.27.0 build --yes --root /absolute/path/to/repository
bunx @skillset/cli@0.27.0 check --only outputs --root /absolute/path/to/repository
bunx @skillset/cli@0.27.0 status --json --root /absolute/path/to/repository
bunx @skillset/cli@0.27.0 diff --root /absolute/path/to/repository
git -C /absolute/path/to/repository status --short
```

Save and inspect the unconfirmed build plan before running the `--yes` command. The receipt must identify the repository and source commit, Skillset version, pre-rebuild diagnostic, backup, preview, generated diff, v4 locks, physical owners and `standard`/`project-use`/`bundle` roles, relevant disposable consumer proof, owner acceptance, date, and limitations. Retain the backup until the owner accepts the rebuilt result.

Package publication and active CLI upgrades are separate release operations. Do not run these commands against an unreleased `0.27.0`, and do not treat a source checkout or development binary as proof of released-version migration.

## Owner-Approved Backup and Rebuild

A pre-v4 lock identifies possible generated paths but does not authorize moving
them. Before writing a backup script or changing output, the repository owner
must classify every proposed path as generated, authored, or uncertain. Stop on
any uncertain path.

For each owner-approved generated path:

1. Confirm the source exists and record its type, mode, and content hash.
2. Confirm the destination does not exist.
3. Use a durable backup directory outside the repository and every configured
   output root.
4. Move only the approved path while preserving its repository-relative path.
5. Stop on the first failed preflight or move. Restore every path already moved
   before retrying; do not continue into the build.

After every approved path is recoverably backed up, run the released-version
preview and inspect it before confirming the build. Verify the rebuilt provider
trees, inherent standards trees, and v4 lock ownership and roles against both the
preview and the backup. Run any pinned consumer proof required by the
repository, then retain the backup until the owner accepts the result.

The rebuild receipt must enumerate the approved paths and backup hashes rather
than relying on a broad directory label. It must also identify who approved the
classification and confirmation, what commands ran, what changed, and which
runtime or publication checks remain outside the rebuild's authority.

## Recovery

If the rebuilt output is wrong, stop before making further changes. Restore only from the recorded backup after checking that the current destination still matches the just-generated bytes and that no newer edits would be overwritten. A rebuild receipt is evidence for review; it never broadens authority to publish, install globally, change provider settings, trust a plugin, or activate it.
