---
description: Defines the canonical Skillset workspace tree, authored source families, generated-output boundary, and operational storage paths.
---

# Workspace Layout

A Skillset [workspace](../../glossary.md#workspace) keeps its root `skillset.yaml` manifest beside a flat `.skillset/` [source root](../../glossary.md#source-root). These are the authored inputs. Lock-owned [build](../../glossary.md#build) [destinations](../../glossary.md#destination) and their provenance are derived [generated output](../../glossary.md#generated-output), not competing source truth. Setup may also create authored or user-owned scaffolds, including the root manifest and an optional CI workflow; those files remain user-owned configuration rather than disposable output.

## Authored workspace

```text
skillset.yaml
.skillset/
  agents/
    <agent-name>.md
  changes/
  hooks/
  partials/
  plugins/
    <plugin-name>/
      skillset.yaml
      README.md
      agents/
      commands/
      hooks/
      partials/
      shared/
      skills/
      _claude/
      _codex/
      _cursor/
  rules/
    <topic>.md
  shared/
    assets/
    references/
    scripts/
    templates/
  skills/
    <skill-name>/
      SKILL.md
  tests.yaml
  tests/
  _claude/
  _codex/
  _cursor/
```

Only the families a repository uses need content. Setup may retain empty families with placeholders so their intended ownership remains visible.

The root `skillset.yaml` owns workspace configuration and root source metadata. Plugin directories derive their identity from `<plugin-name>` and carry their own `skillset.yaml`. Skill directories derive their identity from `<skill-name>` and use `SKILL.md` as their entry point. Do not reintroduce the retired `.skillset/config.yaml`, `.skillset/skillset.yaml`, `.skillset/src/`, or root `skillset/` layouts; current source loading rejects them.

Use the [project configuration guide](../../configuration/project-configuration.md) for the root manifest, the [frontmatter guide](../../configuration/frontmatter.md) for document metadata, and the generated [schemas and examples](../schemas/README.md) for exhaustive field shapes.

## Source families

| Source path | Purpose |
| --- | --- |
| `.skillset/skills/<skill>/` | Standalone skills and their skill-local support files. |
| `.skillset/rules/**/*.md` | Durable portable project instructions. |
| `.skillset/agents/*.md` | Portable project-agent definitions. |
| `.skillset/hooks/` | Adaptive project hook definitions. |
| `.skillset/plugins/<plugin>/` | Plugin-scoped source, including skills and native companion material. |
| `.skillset/shared/` | Workspace resources that a skill may declare and copy into its generated directory. |
| `.skillset/partials/` | Workspace named partials used during Markdown preprocessing. |
| `.skillset/tests.yaml` and `.skillset/tests/*.yaml` | Workspace-owned behavioral test declarations. |
| `.skillset/changes/` | Committed change and [release state](../features/releases.md). |

Support files beside a `SKILL.md`, such as `references/`, `scripts/`, `assets/`, and `templates/`, already belong to that skill. Root `shared/` and plugin-local `shared/` are for material reused by multiple skills. Shared material is not copied merely because it exists: a skill declares the resources it needs. The [resources reference](../features/resources.md) owns declaration, copy, link-rewrite, and executable-mode behavior.

## Provider-native islands

Directories named `_claude`, `_codex`, and `_cursor` are explicit [target-native islands](../../glossary.md#target-native-island). At the workspace root, their contents mirror to that provider's project root. Inside a plugin, supported companion files mirror only into that plugin's generated bundle. Codex plugin `.rules` files are unsupported and fail instead of being copied; Codex command-policy files belong only to the workspace-level `_codex/rules/` island.

These directories preserve provider-shaped files when there is no adaptive representation. They do not make a provider active and they do not turn provider capabilities into portable support. Consult the [support matrix](../support-matrix.md) and owning feature page before choosing an island.

Codex command-policy files are one important distinction: `.skillset/_codex/rules/**/*.rules` can mirror to `.codex/rules/**/*.rules`, while portable instruction prose under `.skillset/rules/` renders through discovered `AGENTS.md` files. See [Instructions](instructions.md).

## Generated destinations and provenance

An enabled [target](../../glossary.md#target) receives files in its native repository layout. Standalone skills normally render below `.claude/skills/`, `.agents/skills/`, or `.cursor/skills/`; project instructions render to Claude and Cursor rule roots or Codex `AGENTS.md` files; plugin bundles normally render below `plugins/<plugin>/<target>/`. Configuration can select or relocate supported destinations.

Nearby `skillset.lock` files record source paths, target ownership, hashes, and render evidence. Generated paths are reviewable and may be committed, but edit `.skillset/` when the intent is portable. Use `skillset explain <path>` to trace one source or destination and `skillset check --only outputs` to detect [drift](../../glossary.md#drift). Exact flags belong to the generated [CLI reference](../cli/README.md).

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. [Build and activation are separate workflows](../../start/build-versus-activation.md).

## Operational storage and lifetimes

Skillset keeps authored source, reproducible output, temporary operational
evidence, recovery material, and durable operation receipts in separate stores.
The logical `.skillset/cache/...` paths printed by workspace commands resolve to
the repository's XDG cache bucket; they are not physical repo directories.

| Surface | Physical owner and location | Lifetime and identity | Source-of-truth boundary |
| --- | --- | --- | --- |
| Authored source and configuration | Repository: `skillset.yaml` and `.skillset/` source families | Durable, repository-versioned paths | Canonical authored intent |
| Generated provider output and locks | Configured repository destinations and nearby `skillset.lock` files | Deterministic and disposable; rebuilt from current source | Reviewable projection, never competing source |
| Operational cache | `$XDG_CACHE_HOME/skillset/<repo-key>/...`, displayed as logical `.skillset/cache/...` | Repository-bucketed, rebuildable or rerunnable evidence | Cache only; commands may retain run-specific readers or `latest` views |
| Recovery snapshots | Repository-local ignored `.skillset/snapshots/<backup-id>/` | Retained for explicit restore under the snapshot contract | Recovery evidence, not cache or canonical source |
| Immutable operational reports | `$XDG_STATE_HOME/skillset/reports/<report-id>/` | User-global, create-only UUIDv4 identity; retained until a future explicit pruning contract | Durable operation receipt, not generated output or workspace cache |

Use [`skillset report show <id-or-path>`](../features/operational-reports.md)
to inspect a completed immutable report. Existing test, eval, CI, adoption, and
fixture evidence keeps its producer-specific cache path and reader until an
explicit migration; a cache report does not become a global receipt merely
because both contain structured results.

| Kind | Environment variable | Default base | Skillset directory |
| --- | --- | --- | --- |
| Configuration | `XDG_CONFIG_HOME` | `~/.config` | `$XDG_CONFIG_HOME/skillset` |
| Cache | `XDG_CACHE_HOME` | `~/.cache` | `$XDG_CACHE_HOME/skillset` |
| State | `XDG_STATE_HOME` | `~/.local/state` | `$XDG_STATE_HOME/skillset` |
| Data | `XDG_DATA_HOME` | `~/.local/share` | `$XDG_DATA_HOME/skillset` |

Unset, empty, or relative XDG values fall back to the listed home-relative bases. Per-repository cache buckets use `workspace.cacheKey` when explicitly configured; otherwise Skillset derives a machine-local key from the checkout. Most repositories should keep the automatic key.

Logical `.skillset/cache/<suffix>` paths map to `$XDG_CACHE_HOME/skillset/<repo-key>/<suffix>`. An explicit `workspace.cacheKey` supplies `<repo-key>`; otherwise Skillset derives `<basename>--local-<sha12>` from the checkout. The managed known-workspaces index is machine-local configuration used to resolve local repository identities. It is disposable convenience state, not committed source or portable verification evidence.

Current public commands remain repository-local unless an existing command receives an explicit root; the prospective workspace in the [global/XDG draft ADR](../../adrs/drafts/20260604-global-xdg-managed-installs-and-sync.md) is not an implemented fallback.
