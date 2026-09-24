---
description: Configure provider-specific output and behavior without duplicating shared source intent.
---

# Target Overrides

A [target](../glossary.md#target) is a provider selected for a compiler run. `compile.targets` establishes the root plan; target overrides refine that plan or, at supported lower-level scopes, explicitly opt a provider back in.

Agent standards are not targets. Applicable adaptive source produces each adopted standard profile inherently. No `agents` target, root `agents`, plugin field, or frontmatter field enables or disables that floor; `.skillset/subagents/` and `defaults.<provider>.agents` keep their project-agent meanings.

## Distinguish Selection from Configuration

These layers have different jobs:

1. `compile.targets` establishes the root provider plan.
2. Root `claude`, `codex`, and `cursor` blocks configure provider output and inherit that plan unless explicitly enabled or disabled.
3. Target defaults fill omitted values for `agents`, `plugins`, `rules`, or `skills`.
4. Plugin and [source-unit](../glossary.md#source-unit) provider toggles refine one scope and may opt a provider back in.
5. A [target-native island](../glossary.md#target-native-island) preserves a native file whose meaning is not portable.

These layers can change provider participation or a provider delta, but they do not suppress an applicable adopted Agent Instructions, Agent Skills, or Agent Plugins projection.

Do not add a bare top-level `targets` key. Keep root selection in `compile.targets`, and use lower-level provider toggles only for deliberate scoped divergence.

## Configure Output Roots

Boolean output settings use Skillset's default roots. An array includes named
plugins or skills. Plugin objects can select `include` or `enabled: false`;
skill objects also accept only selection fields. A nondefault plugin `path`
is rejected while shared packages have fixed placement, until SET-561:

```yaml
compile:
  targets: [claude, codex]

claude:
  skills: true

codex:
  plugins:
    include: [review]
  skills:
    include: [review]
```

The fixed roots are `.claude/skills`, `.agents/skills`, and `.cursor/skills`.
`<target>.skills.path` and `skillset.outputs.skills.<target>` are rejected.
Shared plugin packages currently stay at `plugins/<name>`; custom placement
through `<target>.plugins.path` or root `plugins.output` is deferred
to SET-561.

When `compile.targets` is present, a root provider object without `enabled` inherits that target set; an output-path object does not silently re-enable a provider. See the [workspace schema](../reference/schemas/README.md) for every accepted shape.

## Set Reusable Defaults

The target-local form is canonical:

```yaml
codex:
  defaults:
    skills:
      model: gpt-5
```

`defaults.codex.skills` is shorthand for the same layer. Defaults are supported for `agents`, `plugins`, `rules`, and `skills`; misspelled or unknown surfaces fail validation, and the retired `instructions` surface fails with its `rules` rewrite. Plugin defaults override workspace defaults, file-level target fields override plugin defaults, and provider fields override shared fields during the [cascade](../glossary.md#cascade).

## Prefer Shared Intent

Start with a portable field whenever providers can preserve the same meaning. Add a provider field only for genuine divergence. Use [provider source](../reference/features/target-native-islands.md) for [provider-native](../glossary.md#provider-native) files that should pass through to one provider rather than masquerade as portable configuration.

Tool allow and deny overlays have their own rules; configure them through [tools policy](tools-policy.md).

## Inspect the Result

Use [`skillset lookup`](../reference/cli/lookup.md) to inspect provider and compatibility facts, [`skillset explain`](../reference/cli/explain.md) to trace one source unit, and [`skillset diff`](../reference/cli/diff.md) to preview generated changes. The [support matrix](../reference/support-matrix.md) is the current summary of cross-provider behavior.
