---
description: Defines the core terms used by Skillset's source, build, provider, and activation workflows.
---

# Glossary

## Adaptive source

Repository-owned Skillset source that expresses a shared authoring intent and can be transformed into one or more faithful provider-native destinations. Adaptive does not mean every provider supports every feature.

## Activation

A provider or user action that makes generated material discoverable, trusted, enabled, or connected at runtime. Activation is outside ordinary Skillset build operations.

## Agent standard

A provider-neutral format that Skillset renders inherently when the workspace has applicable source: Agent Instructions (`AGENTS.md`), Agent Skills (`.agents/skills/`), and Agent Plugins (`plugins/<plugin>/`). Standards are not [targets](#target) and have no selector in configuration; `compile.targets` chooses providers only. Each standard is adopted through a [standard profile](#standard-profile).

## Baseline

The portable output an [Agent standard](#agent-standard) produces from source, such as a `.agents/skills/<skill>/SKILL.md`. A provider that can read the same file adds a [delta](#delta) instead of writing its own copy. `skillset diff` and `skillset explain` label this as, for example, `agent-skills baseline`.

## Build

The deterministic derivation and rendering of validated Skillset source into repo-local provider-native files. Builds preview by default and write only with explicit authority.

## Canonical source

The one authored location that owns a fact or source unit. Generated projections and explanatory summaries refer back to that owner instead of becoming competing truth.

## Cascade

The scoped inheritance of workspace and plugin defaults into a source unit, with narrower explicit configuration taking precedence. Cascade does not mean arbitrary filesystem inheritance.

## Consumer

A logical projection that a generated file represents: a standard [baseline](#baseline) or a provider [delta](#delta). One physical file has one [owner](#owner) and can have several consumers; for example, `.agents/skills/` serves both the Agent Skills baseline and the Codex delta. The [lock](#lock) records every consumer. A consumer is provenance, not proof that a provider has discovered or [activated](#activation) the file.

## Delta

The provider-specific part a [target](#target) contributes on top of a compatible [baseline](#baseline), instead of writing a separate file. `skillset diff` shows a shared file as, for example, `[agent-skills baseline + codex delta]`.

## Destination

One concrete output location and format owned by a target adapter, such as a Claude skill directory, a Codex `AGENTS.md`, or a Cursor rule file.

## Drift

A difference between current canonical source and its expected generated output, or between a generated contract and its checked-in documentation projection.

## Generated output

Provider-native files derived from Skillset source. Generated output may be committed and reviewed, but it is disposable and is not the authored source of truth.

## Loadout

A reusable collection of agent-facing skills, rules, agents, hooks, plugins, and related resources prepared for one or more providers.

## Lock

A generated `skillset.lock` file beside managed output. It records source paths, generated paths, hashes, [owners](#owner), [consumers](#consumer), and projection roles, so checks can tell managed output from unrelated files. Locks are [generated output](#generated-output); never edit them by hand.

## Owner

The single standard or provider recorded as responsible for writing one physical generated file. When a standard and a provider share a file, the standard owns it and the provider is a [consumer](#consumer). `skillset explain` prints this as, for example, `owner: agent-skills baseline`.

## Project agent

A repository-scoped subagent authored under `.skillset/subagents/` and rendered to each provider's agent location, such as `.claude/agents/`. Project agents are source; provider settings for them, such as a default model, live under `defaults.<provider>.agents`.

## Projection

A deterministic set of generated artifacts derived from canonical source or a typed contract. A projection is checked for freshness but is not edited as source truth.

## Provider-native

Data or files shaped for a provider's own supported interface rather than forced into a lowest-common-denominator format.

## Render

To transform validated source intent into one target's provider-native destination shape without installing or activating the result.

## Render result

A structured record of what one renderer emitted, skipped, degraded, or could not support, including the evidence needed for diagnostics and provenance.

## Rule

Authored agent guidance. The front page, `.skillset/RULES.md`, renders to Claude's project instruction file and the first section of root `AGENTS.md`. Scoped rules under `.skillset/rules/**/*.md` can be limited to paths and render to Claude rules, Cursor rules, and root or scoped `AGENTS.md` files. `AGENTS.md` output is owned by the Agent Instructions standard. See the [Rules reference](reference/features/rules.md).

## Source root

The directory containing authored Skillset units. In the canonical workspace layout it is `.skillset/`, configured by the root `skillset.yaml`.

## Source unit

One addressable authored item—such as a skill, rule, agent, hook, plugin, or resource—that Skillset can validate, track, and project.

## Standard profile

The pinned, validated version of an [Agent standard](#agent-standard) that Skillset has adopted, with its conformance evidence. An applicable adopted profile is what makes a standard render inherently.

## Target

An enabled provider adapter that receives rendered output. Skillset's canonical targets are Claude, Codex, and Cursor; current per-feature status lives in the [support matrix](reference/support-matrix.md).

## Target-native island

Explicit provider-specific source preserved when a concept cannot or should not be represented as adaptive source.

## Workspace

A repository configured by `skillset.yaml`, including its source root, selected targets, destination configuration, and generated provenance.
