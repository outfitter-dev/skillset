# Command Map

> Detailed guidance follows the current compiler source. The router's exact CLI qualification covers only [entry previews](preflight-and-recovery.md); check command-specific help before using deeper operations.

| Task | Commands |
| --- | --- |
| Start a workspace | `skillset init`, `skillset create <name>` |
| Add source | `skillset new skill\|plugin\|agent\|rule\|hook`, `skillset import <path> [--from <provider>] [--name <name>]` |
| Reorganize source | `skillset draft`, `skillset promote`, `skillset move`, `skillset rename` |
| Build output | `skillset build` (preview), `skillset build --yes`, `skillset dev [--write]`, `skillset update` |
| Verify | `skillset check`, `skillset check --only outputs`, `skillset check --ci [--fix] [--report <path>]`, `skillset test` |
| Inspect | `skillset diff`, `skillset explain <path>`, `skillset list`, `skillset status`, `skillset lookup [features\|hooks\|...]` |
| Repair output | `skillset build --repair`, `skillset resolve`, `skillset restore --list`, `skillset restore <backup-id>`, `skillset reconcile` |
| Record changes | `skillset change add\|list\|show\|status\|check\|refresh` |
| Release | `skillset release plan\|apply\|audit` |
| Distribute | `skillset distribute plan`, `skillset marketplace check\|update` |
| Hooks | `skillset hooks print\|run\|context` |

Every command that writes previews first and writes only with `--yes`. Run `skillset <command> --help` for the exact flags.

## Repair Generated Output

Generated files are derived from source. Never hand-edit or hand-merge them; fix the source and rebuild.

1. Check whether a path is generated: `skillset explain <path>` labels it `(generated)` and names its source.
2. Outside a rebase or merge, preview a repair with `skillset build --repair [path...]`. It reports a verdict per path: `clean`, `output-missing`, `source-ahead`, `output-obsolete`, `output-edited`, `lock-untrusted`, or `diverged`. When every verdict is one of the first four, rerun with `--yes` to restore, regenerate, and remove.
3. `output-edited` means someone edited the generated file and not its source. Capture the edit with `git diff -- <path>`, apply it to the source `explain` names, then rebuild. Use `--discard-edits` only once the edit is in source or confirmed unwanted.
4. `lock-untrusted` means `skillset.lock` failed its integrity check, not that the output is wrong. Rebuild with `skillset build --yes`, then repeat the repair preview.
5. `diverged` means both the generated file and its source changed. Stop and report the paths; do not pick a side.
6. Branches that change different source units merge without conflicts: each `skillset.lock` line belongs to one unit, and change commands record ledger events in new write-once files under `.skillset/changes/events/` (never edit or delete those by hand; `skillset release apply` folds them). When a rebase or merge does conflict in generated output, run `skillset resolve` to see which conflicts are generated, authored, or hand-edited. Resolve authored files yourself, then run `skillset resolve --yes` to repair and stage only the generated paths, and continue the rebase or merge.
7. Confirmed builds back up files they replace. `skillset restore --list` shows those backups and `skillset restore <backup-id> --yes` restores one.
8. Finish with `skillset check --only outputs`; it must pass.

## Build And Check

```bash
skillset build --root .
skillset check --root .
skillset check --only outputs --root .
skillset diff --root .            # pending generated changes, no writes
skillset explain <path> --root .  # rendering + lock provenance; add --activation for matching local evidence
skillset lookup                   # guided schema/compatibility lookup in a TTY; subject list otherwise
skillset lookup hooks --events --compat codex
skillset lookup activation mcp --compat codex # static provider observability and supported claims
skillset marketplace update       # choose a catalog when needed, preview, and confirm
skillset marketplace update outfitter # explicit catalog; still confirms in a TTY
skillset restore <backup> --root . # preview restore; add --yes to write
skillset status --root .          # deterministic health, drift, warnings, and rendering advisories
skillset status --activation --root . # add bounded local provider evidence; use --json for records
skillset hooks print --runner lefthook --pre-commit --pre-push
skillset hooks print --target codex --agent-runtime
skillset hooks run post-tool-use  # advisory runtime guardrail, source-gated
skillset hooks run stop           # blocking runtime guardrail, source-gated
```

`skillset check` is the comprehensive readiness command. Run it before writing generated output when you changed skills, hooks, resources, tool policy, or portability-sensitive content. Use `skillset change check` for focused pending-entry coverage and `skillset status` for a broader human health view.

When `skillset change check --since <ref>` reports stale or missing evidence, preview `skillset change refresh --since <ref>` with the exact same baseline, then rerun it with `--yes` to append the planned evidence. Reusing the baseline matters for removed scopes and renames; the default release-state or trunk baseline can select a different historical source hash.

`skillset check --only outputs` is generated-output freshness. Run it after `skillset build --yes`, before handoff, and whenever you need to prove managed outputs still match source. It reports missing or stale managed files and version drift; it is not a source-authoring linter.

Skillset diagnostics carry a stable scope, severity, and rule id. Scopes are `source`, `workspace`, `provider`, `resource`, `runtime`, `generated`, and `release`. Parser and schema checks cover YAML, TOML, JSON, Markdown frontmatter, workspace config, skills, agents, and hook definitions. Resource, runtime, and provider diagnostics only report facts; they never install hooks, trust plugins, execute scripts, or change provider settings.

`diff`, `explain`, `lookup`, and `status` are read-only authoring aids. They never write generated outputs, install, trust, publish, or mutate user-level config. Bare `status` and `explain` launch no provider process; `--activation` explicitly adds bounded, sanitized local observations and never changes the ordinary status exit contract. `explain <path> --activation` filters requirements and observations by source provenance. `lookup activation` remains static and Core-derived from Skillset policy joined to Registry provider evidence. Bare `skillset lookup` guides TTY users through canonical subjects, applicable views, compatibility targets, and searchable schema fields, then renders one ordinary report. Explicit lookup arguments, JSON, pipes, and non-TTY execution remain prompt-free. `explain --json` and `status --json` include full render-result records for agents and automation. `status` exits non-zero on source issues, drift, or a build error, and summarizes notable rendering advisories such as degraded or unsupported render results.

Use `skillset report show <id-or-path>` to inspect a completed immutable operational report from Skillset's user-global XDG state store. Prefer the full report UUID; an owned completed bundle directory or its exact `report.json` or `report.md` path is also accepted. The reader validates the closed `skillset.report@1` envelope and its deterministic Markdown view, rejects paths outside the store, and emits the shared finite result envelope with `--json`. Existing test, eval, CI, adoption, and fixture reports keep their producer-specific cache paths and readers until explicitly migrated; `report show` is not an arbitrary-file or legacy-report viewer.

Use `skillset reconcile [generated-path]` for an intentional managed-output conflict. In a TTY, a missing path is collected before the canonical report is rendered; source-wins and output-wins availability comes directly from that report, refused directions stay disabled with their existing reason, and confirmation defaults to No before the same operation writes. `--use source` or `--use output` skips direction selection but still previews and confirms in a TTY unless paired with `--yes`. JSON, pipes, and non-TTY execution never prompt. Decline and cancellation leave source and generated bytes unchanged; confirmed source-wins retains output backup/restore guidance, and output-wins retains source rollback.

Use `skillset marketplace update [catalog]` to preview the existing marketplace readiness/update report and then confirm a Core-owned transaction. A TTY derives catalog names cheaply from the local build graph and prompts only when multiple catalogs exist and none was supplied; opening the picker does not resolve external repositories. Core binds confirmation to the complete provider-output and lock plan, refusing without writes if a floating ref or local input changes after preview. An explicit catalog skips selection, while `--yes`, JSON, pipes, and non-TTY execution skip all prompts. Decline, cancellation, and changed-plan refusal leave provider output and `skillset.lock` byte-identical.

Across interactive routes, prompts collect only missing intent. Canonical setup/source/test/lookup/reconcile/marketplace reports and registries own facts, disabled reasons, diagnostics, plans, and writes. Prompt eligibility requires TTY input and output outside CI and machine modes; Ctrl-C exits 130, rendering follows the active terminal width, and mutation confirmation defaults to No.

`hooks print` emits copy/paste snippets for existing hook runners or reviewed project-local provider runtime hook configuration. It does not install hooks, overwrite `.git/hooks`, mutate target runtime settings, or trust generated hook code. Pre-commit snippets call `skillset change check --staged`; pre-push snippets call `skillset change check --since origin/main` followed by the comprehensive `skillset check`. Runtime snippets call `skillset hooks run post-tool-use` and `skillset hooks run stop`; both first inspect only Skillset source/change-entry paths, including untracked files. `post-tool-use` is advisory and never blocks on `change status`; `stop` runs `change check` and the comprehensive `check` only when relevant Skillset source changed. Set `SKILLSET_HOOK_COMMAND` in reviewed runtime config only when the default local/installable CLI resolution needs an explicit override.

Generated plugins use one package at `plugins/<plugin-name>/` with shared provenance under `plugins/skillset.lock`. The portable root manifest, provider manifest directories, immediate-child skill tree, and package assets are siblings. Custom package placement is not yet supported. Standalone generated skills default to provider-native skill roots such as `.claude/skills`, `.agents/skills`, and `.cursor/skills`; plugin-owned standard skills stay inside their Agent Plugins package. Generated roots include `skillset.lock` files for deterministic provenance, including each item's `standard`, `project-use`, or `bundle` role.

Release and change state own generated artifact versions. Existing plugin `skillset.version` and skill top-level `version` fields remain semantic-version compatibility baselines during migration; new source should not add them for ordinary content edits. `skillset check --only outputs` reports version drift when a generated plugin manifest version or skill `metadata.version` is stale. Plugin lock entries include included and skipped skill versions so target-specific skips are visible without changing unrelated generated skill files.
