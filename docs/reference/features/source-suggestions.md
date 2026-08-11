---
description: Skillset reconciliation safely resolves managed generated edits against their canonical source projection.
---

# Reconcile Generated Edits

Cross-command workflow reference; no registry feature id.

Reconciliation resolves a conflict between [canonical source](../../glossary.md#canonical-source) and a managed [generated output](../../glossary.md#generated-output). It uses `skillset.lock` and the current [render](../../glossary.md#render) to identify ownership, preview a direction, and refuse reverse mappings that could lose meaning.

There is no source key for reconciliation. The existing source file, lock, expected rendering, change ledger, and release history remain authoritative.

## Choose a Direction

```bash
skillset reconcile .claude/skills/review/SKILL.md --use output
skillset reconcile .claude/skills/review/SKILL.md --use output --yes

skillset reconcile .claude/skills/review/SKILL.md --use source
skillset reconcile .claude/skills/review/SKILL.md --use source --yes
```

`--use output` accepts an eligible generated Markdown body edit into its single owning source file, then rebuilds the affected generated [projection](../../glossary.md#projection). `--use source` discards the generated edit and restores the current source projection. Both preview by default and require confirmation or `--yes` to write.

Omitting the path or direction can prompt in an eligible interactive terminal. Automation must supply both. The generated [`reconcile` reference](../cli/reconcile.md) owns exact syntax.

## Eligibility

Output-wins is implemented only for a clean managed skill Markdown body that maps to one source path. Skillset renders the exact managed path from current source and compares the generated frontmatter block with the on-disk frontmatter after line-ending normalization. Any frontmatter difference, including formatting or comments, blocks reverse mapping because provider rendering can strip, derive, or transform source fields.

| Case | `--use output` result | Recovery |
| --- | --- | --- |
| Clean single-source skill body edit | Eligible source replacement plan | Review and confirm |
| Generated frontmatter or metadata differs | Refused | Edit canonical source fields directly |
| Lock is stale, corrupt, remapped, or absent | Refused | Restore trustworthy ownership first |
| Path is unmanaged | Refused | Decide ownership manually; Skillset cannot claim it |
| Output combines partials, shared resources, or multiple sources | Refused | Apply the intent to the owning source files manually |
| [Provider-native](../../glossary.md#provider-native) output has no adaptive round trip | Refused | Edit the provider-native source island |
| Other managed output or sibling [drift](../../glossary.md#drift) would be affected | Refused | Resolve the wider drift and rerun preview |
| Generated changelog changed | Refused | Use the change/release correction commands below |
| Current source no longer renders the path | Refused | Inspect `skillset explain <path>` and current configuration |

Source-wins still validates ownership and the current plan; it never overwrites an unmanaged path by pretending it is generated.

## Changelog Corrections

Generated `CHANGELOG.md` files project source-side history and are never reverse-patched:

- before release, use `skillset change reason <@ref>`;
- after release, use `skillset change amend <@ref>` for source-change wording;
- use `skillset release amend <@ref>` for release-event notes.

Then rebuild to refresh the projection. See [Changes](changes.md) and [Releases and Changelogs](releases.md).

## Writes, Errors, and Exit Behavior

Preview mode writes nothing. A confirmed output-wins operation updates the real source and rebuilds affected managed output and locks. A confirmed source-wins operation rebuilds from unchanged source. Failed safety classification, stale input, or conflicting sibling drift produces a nonzero refusal with the generated path, owning source when known, reason, and next manual action.

Reconciliation never mutates `~/.claude`, `~/.codex`, runtime trust, marketplace [activation](../../glossary.md#activation), or user/project provider settings. Reviewed settings suggestions are a distinct future feature because those files are not Skillset-owned generated output.

## CI Boundary

`skillset check --ci` can report the same ownership and output-wins eligibility for added or changed generated paths. It never chooses a direction automatically. `--fix` remains source-wins mechanical repair; automated CI source writeback is not implemented.

## Provenance

Reconciliation creates no second source of truth. Accepted output-wins changes canonical source, then ordinary build machinery updates generated files and locks. Source-wins changes only the managed projection. Run `skillset check --only outputs` afterward to confirm that source, output, and lock agree.

See [Output Safety](output-safety.md) for backups and restore, and [Troubleshooting](../../troubleshooting.md) for symptom-first recovery.
