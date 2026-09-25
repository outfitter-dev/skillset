---
id: 37
slug: rules-name-authored-guidance-source
title: Rules Name Authored Guidance Source
status: accepted
created: 2026-09-24
updated: 2026-09-24
owners: ['[galligan](https://github.com/galligan)']
depends_on: [15, 18, 28, 33, 35]
amends: [28, 33]
---

# ADR-0037: Rules Name Authored Guidance Source

## Context

In June 2026, SET-5 renamed authored repository guidance from "rules" to "instructions". It had two reasons: to avoid confusing source with Claude's `.claude/rules` output, and to avoid confusing it with Codex `.rules` command-policy files.

[ADR-0033](0033-workspace-authoring-model.md#decision) and [ADR-0035](0035-rule-scope-and-provenanced-instruction-sections.md#decision) moved authored source back to `.skillset/RULES.md` and `.skillset/rules/**/*.md`, and they talk about "a rule's location". Everything around that source still says "instruction":

- the frontmatter schema is `instruction-frontmatter`;
- the source-unit selector is `instruction:<id>`;
- the feature is `project-instructions`;
- the CLI scaffolds with `skillset new instruction`;
- target defaults accept `defaults.instructions`;
- the reference pages are `instructions.md`.

`skillset list` already groups the same files under `Rules` with `rule:` keys. One authored unit therefore carries two names, and "instruction" also names the Agent Instructions standard. An author can't tell from vocabulary alone whether `instruction` means their source or the standard projection.

Both of SET-5's reasons have lapsed:

- Claude's destination is `.claude/rules/`, so matching it now helps.
- Codex `.rules` command policy lives only in the provider-native island `.skillset/_codex/rules/**/*.rules`, which mirrors to `.codex/rules/**/*.rules`. That island is documented as command policy, not guidance prose.

## Decision

"Rule" names the authored guidance unit and every Skillset-owned identity derived from it. "Instructions" is reserved for vocabulary Skillset does not own.

### Rule is the Skillset vocabulary

Source, schema, config, CLI, provenance, and documentation use one spelling:

| Surface | Retired | Current |
| --- | --- | --- |
| Frontmatter schema contract and file | `instruction-frontmatter` | `rule-frontmatter` |
| Source-unit kind and selector | `instruction`, `instruction:<id>` | `rule`, `rule:<id>` |
| Feature ID | `project-instructions` | `project-rules` |
| Render-result and lock `destination` | `instruction` | `rule` |
| Authoring role reported by `explain` | `source-instruction` | `source-rule` |
| Target defaults surface | `<target>.defaults.instructions` | `<target>.defaults.rules` |
| CLI kinds | `skillset new instruction`, `skillset lookup instruction` | `skillset new rule`, `skillset lookup rule` |
| Adoption import kind and report ID | `instructions`, `instructions:<path>` | `rules`, `rules:<path>` |

The feature ID lands last. The adopted Agent Instructions profile names `project-instructions` in its support envelope, and its checked-in adoption receipt pins the profile's content hash. So that rename ships with freshly recorded Agent Instructions evidence (SET-658) instead of an edited receipt.

### Instructions stay where another owner defines them

These keep their names because Skillset does not own the word:

- **Agent Instructions.** The adopted standard profile keeps its name, its `agent-instructions` identity, and its `instructions` projection family ([ADR-0028](0028-open-standards-are-the-portability-floor.md), [ADR-0032](0032-standards-compilation-is-inherent.md)).
- **Provider-native terms.** Codex `developer_instructions`, `AGENTS.md` size diagnostics, and registry provider-format labels for `codex-agents-md` and `cursor-rules` describe provider files, not Skillset source.
- **Codex command policy.** The `.skillset/_codex/rules/**/*.rules` island keeps its provider name. It is command policy, not a rule in this ADR's sense.
- **`compile.instruction_front_page`.** This key names the rendered `CLAUDE.md` placement, a provider instruction file. It is outside this decision, so a separate configuration design can revisit it.

The test: if the word names something an author writes under `.skillset/RULES.md` or `.skillset/rules/`, it is "rule". If it names a standard or a provider file, it keeps that owner's word.

### Retired spellings fail with their rewrite

The cutover follows [ADR-0033](0033-workspace-authoring-model.md#context): Skillset has only internal consumers, so retired spellings get no aliases or dual readers.

Where Skillset parses author input, each retired spelling fails with a diagnostic that names its exact replacement. That covers:

- the target defaults key;
- CLI kinds and lookup subjects;
- source-unit selectors given as command arguments or in pending change entries.

The generated schema is renamed to `docs/reference/schemas/0.1.0/rule-frontmatter.schema.json`. No copy remains at the old path. Skillset never writes a reference to that schema into authored files, so the release note and schema index name the URL rewrite rather than a check.

### Provenance history keeps its meaning

Stored change history is not rewritten. The change ledger, applied history, release records, and derived state are append-only evidence ([ADR-0015](0015-reason-only-change-ledger-derived-state.md)).

Readers translate a recorded `instruction:<id>` selector to `rule:<id>`, the same read-time translation used for the earlier SET-53 selector cutover. Newly authored scopes accept only `rule:<id>`.

The source-hash domain for rules remains the literal `instruction`. The hash input is a fixed marker, not vocabulary. Renaming it would change every rule's source hash and report unchanged rules as edited against their recorded baselines.

### Superseded statements

These historical statements remain in their original ADRs as evidence. This ADR replaces their vocabulary as current guidance:

- `docs/adrs/0033-workspace-authoring-model.md`: "`.skillset/RULES.md` is the unscoped instruction source." It is now the unscoped rule source.
- `docs/adrs/0028-open-standards-are-the-portability-floor.md`: "`compile.agents.instructions` applies to every adaptive instruction." The Agent Instructions projection applies to every applicable rule.

## Consequences

### Positive

- Authors meet one word for one concept in the directory, the scaffold command, the schema, `list`, `explain`, and the lock. That word matches Claude's and Cursor's destinations.
- "Instructions" becomes unambiguous. It names the Agent Instructions standard or a provider's instruction file, never Skillset source.
- `bun run terminology:guard` can ban the retired spellings without banning the English word. Agent Instructions and provider fields need no exemption.

### Tradeoffs

- Anyone who hand-associated an editor with the old `instruction-frontmatter.schema.json` URL must update it; that URL stops resolving.
- Change-history readers carry one more legacy selector translation, and the source-hash domain keeps a string that no longer matches the kind name.
- Rendered locks and reports change `destination` and `sourceUnit` values with this cutover, then `featureId` with SET-658.

### What This Does NOT Decide

- It does not rename `compile.instruction_front_page`. A separate configuration design owns that key.
- It does not rename the parallel project-agent vocabulary (`agent-frontmatter`, `agent:` selectors, `project-agents`) left in place by the `subagents/` cutover. That is the same class of gap and needs its own decision.
- It does not change rule scope, rendering, or destinations. [ADR-0035](0035-rule-scope-and-provenanced-instruction-sections.md) still governs them.

## References

- [Tenets](../project/tenets.md) - one meaning, one key; migration is explicit.
- [ADR-0015: Reason-Only Change Ledger and Derived State](0015-reason-only-change-ledger-derived-state.md) - append-only history that readers translate instead of rewriting.
- [ADR-0018: Render Results](0018-render-results.md) - render-result `destination` vocabulary renamed here.
- [ADR-0028: Open Standards Are the Default Portability Floor](0028-open-standards-are-the-portability-floor.md) - Agent Instructions keeps its standard name.
- [ADR-0033: Workspace Authoring Model](0033-workspace-authoring-model.md) - `RULES.md` and `rules/` source topology and the no-alias cutover rule.
- [ADR-0035: Rule Scope and Provenanced Instruction Sections](0035-rule-scope-and-provenanced-instruction-sections.md) - rule scope and rendered `AGENTS.md` sections.
- [SET-657](https://linear.app/outfitter/issue/SET-657/make-rules-the-one-name-for-authored-rule-source-across-schema-config) - implementation owner.
- [SET-658](https://linear.app/outfitter/issue/SET-658/rename-feature-project-instructions-to-project-rules-with-re-recorded) - feature ID rename with re-recorded Agent Instructions evidence.
