# Skillset Design Tenets

> Source-first loadouts: author once, lower faithfully.

This is the stable doctrinal layer for the Skillset compiler. It describes what Skillset believes, how it decides between competing designs, and what agents should preserve when changing the source contract. When implementation or tactical docs drift from this document, bring the repo back into alignment or make a deliberate decision to change the tenets.

Skillset exists to make reusable agent loadouts easier to author and safer to ship across Claude and Codex. It should make the happy path smaller, not make authors learn every target-specific file shape before they can write a useful skill.

## Documentation Tiers

Skillset docs are organized by how often the information should change:

- **Tenets**: What we believe and why. This document changes only when our model of Skillset changes.
- **Decisions and packets**: ADRs under `docs/adrs/`, goal packets, review reports, and retros that explain what is true now, what changed, and why.
- **Guides and references**: How to use the current compiler, source layout, target lowering, versioning, imports, hooks, resources, and checks.
- **Agent guidance**: `AGENTS.md`, generated skills, and repo-local instructions. These are practical operating notes and change with the repo.

Tenets govern the other tiers. A guide can be stale, a packet can be superseded, and an `AGENTS.md` file can be tactical. The tenets are the long-lived test for whether a proposal fits the system we are building.

## Principles

These are the foundational beliefs of Skillset. Every source-schema decision, renderer, lint rule, import helper, and generated-output contract should be consistent with them.

### Help the happy path

Building agent loadouts with Skillset should be easier than hand-authoring parallel Claude and Codex trees. A small useful skill or plugin should not require authors to decide target output paths, repeat obvious names, duplicate descriptions, or learn provider-specific edge cases before they have a reason.

Power should come from derivation, defaults, validation, and clear escape hatches. If a common authoring flow makes the user copy the same idea into several places, the compiler should treat that as design feedback.

### Source is the product

`.skillset/` is the authored source of truth. Claude and Codex outputs are target-native projections of that source.

Generated plugin repositories, standalone skill roots, lockfiles, and instruction files can be committed and reviewed, but they are not source truth. Edits should flow from source to generated output through `skillset build`, and `skillset check` should make stale output visible.

### One meaning, one key

When Claude and Codex expose the same semantic feature, Skillset should provide one portable source key for that meaning. Exact matches do not deserve parallel `claude_*` and `codex_*` vocabulary just because the target manifests spell them differently.

Provider-native aliases can be accepted when they are safe and unambiguous. The resolver should normalize aliases into the canonical Skillset concept before rendering target output.

### Lower intent, not filenames

Close matches should be designed from the author's intent, not from whichever target file shape appeared first. The question is not "how do we copy a Claude subagent into Codex?" but "what outcome is the author trying to create, and what is the faithful Codex-native way to create a similar outcome?"

This applies to agents, subagents, hooks, instructions, resources, app/MCP manifests, and any future runtime surface. If Skillset cannot lower an intent faithfully for a target, it should say so through target-specific support, diagnostics, or explicit opt-out rather than pretending the outputs are equivalent.

### Target truth beats fake portability

Portable source keys are for behavior that is actually portable. Root provider selection is a compile concern, not target-native semantics: a root `compile.targets` list may say which provider projections to build, while `claude` and `codex` blocks stay reserved for target-specific options, explicit target toggles, and visible target-native escape hatches.

It is better for a feature to be honestly target-specific than falsely unified. Skillset should not introduce a separate `agents` abstraction in v1 when `codex` is the practical Codex skill/plugin/agent-ish target.

### Derive by default, override when wrong

Authors should write information only they know. Skillset should derive what it already knows: names from directories when appropriate, manifest values from source metadata, target output paths from defaults, generated version fallbacks from the nearest source version, and generated descriptions from the source fields that already exist.

Overrides are healthy when derivation is wrong. They should be scoped, explicit, and visible in resolved output or lock provenance. If authors routinely override everything, the derivation rules are probably wrong.

### Builds do not imply trust

`skillset build`, `skillset lint`, `skillset check`, and `skillset import` are local source-management tools. They should not publish plugins, mutate registries, install into global runtime locations, symlink into user config, trust hooks, or enable generated artifacts.

Build output may define hooks, app manifests, MCP manifests, plugins, skills, and instructions. Activation is a separate workflow.

### Codify the craft

Skillset should learn what goes into excellent skills, agents, hooks, instructions, resources, and plugins, then turn that knowledge into tooling. The compiler should help authors keep versions current, declare minimum required metadata, link resources safely, avoid unsupported target features, and keep Claude and Codex projections in sync.

Internal tooling is part of the product: scaffolds, lint rules, explain commands, fixtures, import helpers, review prompts, and self-hosted development skills should all make better loadout authoring easier.

## Promises

These are guarantees authors and agents should be able to rely on.

### Generated output is reproducible

Generated output should be deterministic, disposable, and reviewable. Rebuilding from the same source should produce the same target files and lock provenance.

### Target output stays native

Claude output should look like Claude. Codex output should look like Codex. Skillset can normalize source authoring without forcing targets into an unnatural shared shape.

### Lockfiles carry heavy provenance

Generated skill frontmatter should stay lightweight. Product-facing generated fields such as `metadata.version` and `metadata.generated` belong in the skill itself; heavier source hashes, source paths, target state, skipped target information, and drift evidence belong in nearby `.skillset.lock` files.

### Compatibility is kind, ambiguity is not

Compatibility aliases and import helpers should reduce migration pain. They should not silently choose between ambiguous meanings or hide lossy lowering. Unknown portable keys should fail unless the author uses a clearly target-native escape hatch.

### Drift should become visible early

Stale generated output, unsupported target features, unsafe resource mappings, unmanaged generated destinations, malformed locks, and target-incompatible hooks should fail before they become quiet runtime surprises.

Unsupported lowering policy should be explicit. The default should fail when authored source cannot lower faithfully to an enabled target. Softer modes such as warn, skip, or force are escape hatches for migration and provider drift; they must record what happened in warnings, doctor output, or lock provenance rather than making unsupported source look synchronized.

## Patterns

These are recurring design shapes that operationalize the principles and promises.

### Normalize exact matches

When a Claude and Codex feature is semantically the same, define a portable source key and lower it to target-native syntax. `implicit_invocation`, skill version metadata, source descriptions, and target enablement are examples of this pattern.

### Model near matches by intent

When features are similar but not identical, name the intent first and design the lowering second. Instructions that lower to Claude rules and Codex `AGENTS.md` files, agent roles that may lower differently per target, and hook definitions that stay definitions rather than activation are examples of this pattern.

### Prefer defaults and scoped overrides

The default posture is to compile for both Claude and Codex when source is portable. Root `compile.targets` can narrow that provider set, and lower levels can opt out or back in with `claude` and `codex` toggles where the resolver supports it. Boolean target settings should use defaults; objects should exist for real overrides.

### Keep escape hatches visible

Target-native escape hatches should be obvious in source. Underscore-prefixed keys such as `_allow` and `_deny` signal that the author is intentionally leaving the portable layer. Escape hatches should still be validated for file safety, locked for provenance, and rendered only where the target can accept them.

### Treat tooling as authoring surface

`skillset lint`, `skillset check`, `skillset import`, and future explain/scaffold tools are not secondary conveniences. They are how Skillset codifies good loadout authoring, keeps target behavior honest, and teaches the next author what to fix.

## Current Doctrine Implications

These are not a replacement for the schema reference. They are examples of how the tenets should guide near-term design.

- Prefer `tool_intent` for portable tool-policy meaning, with target-native `_` escape hatches for provider-specific vocabulary.
- Prefer `instructions` as the source concept for repo guidance, even if Claude output still uses rules and Codex output still uses `AGENTS.md`.
- Use `skillset.schema` for the version of the source contract or compiler schema, while generated skill product versions stay simple through fields like `metadata.version`.
- Do not require a source name that is distinct from the real plugin or skill name unless there is a concrete identity problem that derivation cannot solve.
- Use root `compile.targets` for provider selection. Keep bare top-level `targets:` out of the source contract, default to both targets for portable source, and keep `claude` / `codex` blocks for target-specific options and lower-level opt-outs.
- Treat root `compile.unsupported` as visible lowering policy. The default is `error`; `warn` and `skip` must surface skipped source in diagnostics or lock provenance, and `force` must only emit through an explicit target-native destination rather than pretending unsupported behavior became portable.

## Posture

Skillset is opinionated about source authoring and conservative about target activation. It should give authors a small, clear, source-first contract while preserving the native expectations of Claude and Codex.

It should grow deliberately. A new portable key is valuable when it removes repetition, prevents drift, and lowers faithfully. A new target-specific escape hatch is valuable when it keeps target truth explicit. A new abstraction is justified only when it makes authoring easier without making the system less honest.
