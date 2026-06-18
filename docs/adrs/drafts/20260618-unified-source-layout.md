---
slug: unified-source-layout
title: Unified Source Layout
status: draft
created: 2026-06-18
updated: 2026-06-18
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, one-action-repo-adoption, fixtures-tests-dogfooding-and-evals]
---

# ADR: Unified Source Layout

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
- generated and operational state such as `.skillset/changes` and `.skillset/build` already lives beside source, making `.skillset/` the workspace root rather than the source root.

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

### `.skillset/config.yaml` Is Workspace Config

Root `.skillset/config.yaml` owns how the repo builds:

- provider selection through `compile.targets`;
- build mode and unsupported destination policy;
- output roots and destination selection under `claude` and `codex`;
- distribution, CI, test, and future setup/runtime configuration.

It does not own source identity. Root source metadata moves to `.skillset/src/skillset.yaml`. That file carries the root `skillset` block and other source-level declarations that describe the loadout rather than the build workspace. This keeps "where should outputs go?" separate from "what source is this?"

Plugin manifests keep the same name, but move under the source root: `.skillset/src/plugins/<plugin>/skillset.yaml`.

### Adaptive Source Lives Under `src`

Adaptive source is source Skillset may adapt across providers:

| Source | Meaning |
| --- | --- |
| `.skillset/src/rules/**/*.md` | Durable repo guidance that builds to Claude rules and Codex `AGENTS.md`. |
| `.skillset/src/skills/**/SKILL.md` | Standalone skills. |
| `.skillset/src/agents/*.md` | Repo-scoped agents. |
| `.skillset/src/plugins/<plugin>/skills/**/SKILL.md` | Plugin skills. |
| `.skillset/src/plugins/<plugin>/rules/**/*.md` | Plugin-scoped guidance once plugin guidance has a provider destination. |
| `.skillset/src/hooks/` and `.skillset/src/plugins/<plugin>/hooks/` | Hook source once adaptive hooks land. |
| `.skillset/src/shared/` and plugin-local `shared/` | Shared resource roots for source organization. |

`rules/` is the adaptive guidance name. Claude happens to build this into `.claude/rules`, and Codex currently builds it into `AGENTS.md`. Codex `.rules` files are command policy, not durable guidance, so they do not define the adaptive directory name.

### Provider Source Uses Underscore Directories

Provider-owned source is explicit:

```text
.skillset/src/_claude/**
.skillset/src/_codex/**
.skillset/src/plugins/<plugin>/_claude/**
.skillset/src/plugins/<plugin>/_codex/**
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
| root `skillset:` metadata in `.skillset/config.yaml` | `.skillset/src/skillset.yaml` |

Skillset should provide a local migration script or small family of scripts for the handful of existing Skillset repos. That script is allowed to be simple and repo-oriented: move paths, split root source metadata from workspace config, run the normal build, and let review catch anything surprising.

The compiler does not keep the old layout as a first-class compatibility mode. After the cutover, old source homes should fail with clear diagnostics that point at the new path. This is consistent with the tenet that migration is explicit and ambiguity is not.

### Future Skillset-Repos Can Adopt Root Source Later

A repository whose whole purpose is authoring a Skillset may eventually use a root-oriented source mode with a root `skillset.yaml`, root `skills/`, and root `plugins/`, plus a root `.skillset.config.yaml` for workspace config. That is a future mode, not this decision. The default repo-local contract remains `.skillset/config.yaml` plus `.skillset/src/`.

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

- **Mechanical overreach.** A path rewrite could accidentally move `.skillset/changes` or `.skillset/build`. Mitigation: scripts use an explicit allowlist of old source homes and fail if a destination already exists.
- **Provider source confusion.** `_claude` and `_codex` could look like private implementation folders. Mitigation: docs and explain/list output should name them as provider source, not hidden internals.
- **Config/source drift.** Splitting root config from root manifest creates two files. Mitigation: setup writes both, validation gives each file a focused schema, and docs keep the root minimal.

## Non-Goals

- Full public adoption of every historical layout.
- User/global source migration.
- Root-mode Skillset repos with `./skillset.yaml`, `./skills`, and `./plugins`.
- Policy source implementation. `policy/` remains future work.

## References

- [Tenets](../../tenets.md) - source-first loadouts, provider truth, and explicit migration.
- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source remains the product.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - `compile.targets` remains provider selection.
- ADR: One-Action Repo Adoption (draft) - superseded for the old split layout; adoption should use the unified layout after this cutover.
- ADR: Fixtures, Tests, Dogfooding, and Evals (draft) - fixtures should follow the current default source contract, not preserve old implementation history.
