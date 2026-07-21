---
id: 8
slug: unified-source-layout
title: Unified Source Layout
status: superseded
created: 2026-06-18
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1]
superseded_by: ['9']
---

# ADR-0008: Unified Source Layout

## Context

Skillset's current source layout grew in slices:

```text
.skillset/
  config.yaml
  instructions/
  skills/
  plugins/
  shared/
  src/
    agents/
    claude/
    codex/
```

That was workable while `.skillset/src/` meant "project agents and provider-native islands only", but it now creates avoidable ambiguity:

- authors have to remember that plugins and standalone skills are source but not under `src`;
- `.skillset/instructions` competes with the wider ecosystem habit of calling durable guidance "rules";
- provider-native directories named `claude/` and `codex/` sit beside adaptive source directories, so the layout does not visually say which content Skillset may adapt and which content is provider-owned;
- generated and operational state such as `.skillset/changes`, `.skillset/cache`, and `.skillset/snapshots` already lives beside source, making `.skillset/` the workspace root rather than the source root.

The project also needs to use Skillset soon in other repositories, especially Trails. That argues for a clean layout now, before external users depend on the old split. Migration should be explicit, but it does not need to be a long-lived public compatibility framework: the only content to migrate today is a small set of Skillset trees we created while building the compiler.

## Decision

Skillset uses `.skillset/` as the workspace root and `.skillset/src/` as the default source root for repo-local source.

```text
.skillset/
  config.yaml              # workspace/build/destination config
  src/
    skillset.yaml          # root source manifest
    rules/
    hooks/
    skills/
    agents/
    plugins/
      <plugin>/
        skillset.yaml
        rules/
        hooks/
        skills/
        shared/
        _claude/
        _codex/
    shared/
    _claude/
    _codex/
  changes/
  build/
```

### Workspace Manifest Owns Build Configuration

Ordinary repos use `.skillset/skillset.yaml` as the workspace manifest. Dedicated Skillset repos use root `skillset.yaml` with root `skillset/` as the source root. In both modes, the workspace manifest owns how the repo builds:

- provider selection through `compile.targets`;
- build mode and unsupported destination policy;
- output roots and destination selection under `claude` and `codex`;
- distribution, CI, test, and future setup/runtime configuration.

It also owns root source identity for the workspace. Plugin manifests keep the same name, but live under the source root: `.skillset/src/plugins/<plugin>/skillset.yaml` in ordinary repos and `skillset/plugins/<plugin>/skillset.yaml` in dedicated repos.

### Adaptive Source Lives Under The Source Root

Adaptive source is source Skillset may adapt across providers:

| Source | Meaning |
| --- | --- |
| `<source-root>/rules/**/*.md` | Durable repo guidance that builds to Claude rules and Codex `AGENTS.md`. |
| `<source-root>/skills/**/SKILL.md` | Standalone skills. |
| `<source-root>/agents/*.md` | Repo-scoped agents. |
| `<source-root>/plugins/<plugin>/skills/**/SKILL.md` | Plugin skills. |
| `<source-root>/plugins/<plugin>/rules/**/*.md` | Plugin-scoped guidance once plugin guidance has a provider destination. |
| `<source-root>/hooks/` and `<source-root>/plugins/<plugin>/hooks/` | Hook source once adaptive hooks land. |
| `<source-root>/shared/` and plugin-local `shared/` | Shared resource roots for source organization. |

`rules/` is the adaptive guidance name. Claude happens to build this into `.claude/rules`, and Codex currently builds it into `AGENTS.md`. Codex `.rules` files are command policy, not durable guidance, so they do not define the adaptive directory name.

### Provider Source Uses Underscore Directories

Provider-owned source is explicit:

```text
<source-root>/_claude/**
<source-root>/_codex/**
<source-root>/plugins/<plugin>/_claude/**
<source-root>/plugins/<plugin>/_codex/**
```

The underscore matters. `_claude` and `_codex` are not adaptive source categories; they are provider source directories that Skillset copies or lightly transforms only for that provider destination. This keeps provider source visually distinct from adaptive directories such as `skills`, `rules`, `hooks`, and `agents`.

Provider source can still use Skillset preprocessing, variables, validation, and provenance where the compiler supports those operations. It must not silently build to the other provider.

### Repo, User, And Global Stay Separate

`repo` means "this repository." A repo source tree can build outputs into repo-local destinations, generated plugin marketplaces, or configured user/global destinations, but those destinations do not change the source kind.

User/global source is separate and should default to XDG-aware user Skillset locations such as `~/.skillset/src` or a version-controlled user Skillset repo selected by config. The repo layout should not pretend user source lives inside a project checkout.

### Migration Is A Clean Cutover

The migration map is mechanical:

| Old path | New path |
| --- | --- |
| `.skillset/instructions/` | `.skillset/src/rules/` |
| `.skillset/skills/` | `.skillset/src/skills/` |
| `.skillset/plugins/` | `.skillset/src/plugins/` |
| `.skillset/shared/` | `.skillset/src/shared/` |
| `.skillset/src/claude/` | `.skillset/src/_claude/` |
| `.skillset/src/codex/` | `.skillset/src/_codex/` |
| `.skillset/src/plugins/<plugin>/claude/` | `.skillset/src/plugins/<plugin>/_claude/` |
| `.skillset/src/plugins/<plugin>/codex/` | `.skillset/src/plugins/<plugin>/_codex/` |
| root `skillset:` metadata in legacy `.skillset/config.yaml` | workspace manifest |

Skillset should provide a local migration script or small family of scripts for the handful of existing Skillset repos. That script is allowed to be simple and repo-oriented: move paths, split root source metadata from workspace config, run the normal build, and let review catch anything surprising.

The compiler does not keep the old layout as a first-class compatibility mode. After the cutover, old source homes should fail with clear diagnostics that point at the new path. This is consistent with the tenet that migration is explicit and ambiguity is not.

### Dedicated Skillset Repos Use Root Manifest And `skillset/`

A repository whose whole purpose is authoring a Skillset can use root `skillset.yaml` plus a root `skillset/` source tree. Generated state still belongs under root `.skillset/`, while change state and lock state use the dedicated repo roots defined by the change-ledger decision.

## Consequences

### Positive

- Authors get one obvious source root.
- The distinction between adaptive source and provider source becomes visible in paths.
- Workspace state (`changes`, `build`, config, future lock/report material) stays beside source without pretending to be source.
- Setup, import, fixtures, docs, and self-hosted skills can teach one default layout.
- The compiler can reject old homes instead of carrying long-lived compatibility branches.

### Tradeoffs

- The cutover touches many tests and generated provenance paths because source paths are part of locks and change-state hashes.
- Existing pending change/release state may need a one-time refresh because source hashes include source paths.
- The word `rules` now means adaptive guidance in source while Codex `.rules` remains provider command policy. Docs must call out that distinction clearly.

### Risks

- **Mechanical overreach.** A path rewrite could accidentally move `.skillset/changes`, `.skillset/cache`, or `.skillset/snapshots`. Mitigation: scripts use an explicit allowlist of old source homes and fail if a destination already exists.
- **Provider source confusion.** `_claude` and `_codex` could look like private implementation folders. Mitigation: docs and explain/list output should name them as provider source, not hidden internals.
- **Config/source drift.** Splitting root config from root manifest creates two files. Mitigation: setup writes both, validation gives each file a focused schema, and docs keep the root minimal.

## Non-Goals

- Full public adoption of every historical layout.
- User/global source migration.
- Root-mode Skillset repos with `./skillset.yaml`, `./skills`, and `./plugins`.
- Policy source implementation. `policy/` remains future work.

## References

- [Tenets](../tenets.md) - source-first loadouts, provider truth, and explicit migration.
- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - source remains the product.
- [ADR-0001: Root Compile Policy](0001-root-compile-policy.md) - `compile.targets` remains provider selection.
- ADR: One-Action Repo Adoption (draft) - superseded for the old split layout; adoption should use the unified layout after this cutover.
- ADR: Fixtures, Tests, Dogfooding, and Evals (draft) - fixtures should follow the current default source contract, not preserve old implementation history.
