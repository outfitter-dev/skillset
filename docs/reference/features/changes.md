---
description: Skillset change records capture source-change reasons, verify coverage, and preserve evidence for releases.
---

# Changes

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `changes` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Changes record why [source units](../../glossary.md#source-unit) changed. They provide committed coverage, changelog text, and release-planning evidence; they are neither generated provider output nor npm package Changesets.

## Record a Change

Pending reasons live as Markdown under `.skillset/changes/`. Let the command create the stable id and evidence:

```bash
skillset change add \
  --scope skill:review-notes \
  --bump patch \
  --reason "Clarify the review checklist."
```

The Markdown body is the authored reason. Readable directives such as `Bump:`, `Group:`, and `Scope:` preserve the chosen release impact and selection. Skillset derives ids, source hashes, and coverage into `.skillset/changes/ledger.jsonl` instead of requiring hand-authored frontmatter.

Ids are twelve lowercase hexadecimal characters. CLI references use `@<prefix>` with a minimum of six characters and must be unambiguous. A group is a filtering/reporting aid, not a release boundary.

The generated [`change` reference](../cli/change.md) owns exact options. The [publishing guide](../../guides/publishing.md) shows the normal change-to-release workflow.

## Check Coverage

```bash
skillset change status
skillset change status --since origin/main
skillset change check --since origin/main
```

`status` reports changed source units and [generated-output](../../glossary.md#generated-output) [drift](../../glossary.md#drift) separately. `check` validates the reason body, scopes, ids, current source-hash evidence, and coverage. Both are read-only.

The baseline is selected in this order: an explicit `--since`; ledger-derived release state; compatibility `state.json`; source-inventory locks; then the Git merge base. If a failed check used `--since`, use the same baseline when refreshing evidence:

```bash
skillset change refresh @a1b2c3 --since origin/main
skillset change refresh @a1b2c3 --since origin/main --yes
```

Refresh previews by default and appends coverage events only with `--yes`. It does not edit the reason.

## Correct or Disposition a Reason

| Intent | Command | Write behavior |
| --- | --- | --- |
| Edit a pending reason | `skillset change reason @a1b2c3 --reason "…"` | Updates reason evidence while preserving the id |
| Append to a pending reason | `skillset change reason @a1b2c3 --append --reason "…"` | Appends after validation |
| Intentionally exclude a pending reason from release | `skillset change ignore @a1b2c3` | Previews; appends ignore evidence with `--yes` |
| Correct applied change wording | `skillset change amend @a1b2c3 --reason "…"` | Appends an amendment; original history remains |
| Correct release-event notes | `skillset release amend @a1b2c3 --reason "…"` | Appends release amendment evidence |

An ignored reason remains visible but contributes no bump or changelog entry. Applying a release records its current source hash so status does not repeatedly report the intentionally ignored edit.

## Legacy Pending Entries

Older YAML-frontmatter entries remain readable for recovery. They are not the current authoring shape:

```bash
skillset change migrate
skillset change migrate --yes
```

The first command previews conversion to reason-only Markdown and equivalent ledger events. The second writes it. Valid legacy entries produce a cleanup warning until migrated.

## Errors and Recovery

| Problem | Result | Recovery |
| --- | --- | --- |
| Missing or stale source evidence | `change check` fails | Run `change refresh` with the same baseline, review, then confirm |
| Unknown scope or empty reason | Validation fails | Correct the source-unit selector or reason body |
| Ambiguous short ref | Command lists candidates and fails | Supply a longer `@` prefix |
| Two stacked reasons cover one current hash | Both remain valid and a stacked-evidence note is shown | Keep both when attribution is intentional |
| One stacked reason has an old hash | That reason remains stale | Refresh it; evidence is never borrowed from another reason |
| `bump: none` covers a structural or severity-bearing change | Check warns | Choose the intended bump or explicitly review the warning |
| Generated file was edited | Change commands do not reverse-map it | Use [reconciliation](source-suggestions.md) |

Build `--scope` is rejected for change status/check because a [destination](../../glossary.md#destination) filter cannot safely limit source coverage.

## Writes and Exit Behavior

Read commands (`status`, `check`, `list`, `show`, and `history`) write nothing. `add`, `reason`, and amendments write their named source-side records. `refresh`, `ignore`, and migration are plan-first and require `--yes` to apply. Validation or uncovered changes produce a nonzero check result.

Package-facing edits can require both ledgers: `.skillset/changes/` records [workspace](../../glossary.md#workspace) source intent, while `.changeset/*.md` records npm release intent. Generated schemas and examples are evidence, not substitutes for either source record.

## Provenance

`ledger.jsonl` is the schema-versioned event stream for reason lifecycle, coverage, ignores, and release [projection](../../glossary.md#projection). Applied reasons remain in `history.jsonl`; release records remain in `releases.jsonl`; corrections append to amendment files. Nearby `skillset.lock` files continue to own generated paths and hashes.

See [Source Change, Release, and Dependency Provenance](../../adrs/0014-source-change-release-provenance.md) and [Reason-Only Change Ledger and Derived State](../../adrs/0015-reason-only-change-ledger-derived-state.md) for the durable design.

## Merging Change Streams

These streams only gain records at the end, so parallel branches conflict on every merge even though both sides are compatible. Declare the built-in `union` merge strategy for them in `.gitattributes`:

```gitattributes
.skillset/changes/*.jsonl merge=union
```

`union` keeps both sides' appended records without a conflict, and being built in it needs no per-clone `git config` registration, so it applies the same way in CI, fresh clones, and worktrees.

Union is line-level and cannot validate the result. Two invariants still need checking after a merge: record ids stay unique, and no record lands above an older one. Record order is load-bearing because derived state folds events in file order and later records win. Global chronological order is not an invariant — inversions already committed stay valid — so verify only that a merge introduced no new one.
