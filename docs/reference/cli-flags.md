---
description: Explains Skillset's shared CLI flag rules and projects the complete contract-owned flag and environment vocabulary.
---

# CLI Flag Conventions

The [CLI command reference](./cli/README.md) documents which options each public route accepts. This page owns the cross-command rules and projects the exhaustive flag vocabulary from `CLI_FLAGS`; it does not duplicate route assignments by hand.

## Rules

- `--root <path>` is the only public workspace-location override. Canonical source and output roots come from `skillset.yaml` and `.skillset/`.
- Preview is the default for plan-first mutations. `--yes` confirms a fully specified mutation without selecting what it should do.
- `--write` enables deterministic ordinary writes for comprehensive or continuous workflows. `--fix` is the CI-specific repair flag for `check --ci`.
- `--use source|output` selects reconciliation direction. Reconcile still requires `--yes` to apply the selected plan non-interactively.
- `--scope` narrows source units or generated destination groups; it never redirects workspace roots.
- `--json` selects one finite versioned result document. `--jsonl` selects a versioned event stream. Protocol commands may retain route-specific `--format` when the value changes protocol encoding.
- Removed flags fail as unknown; compatibility aliases are not retained.

## Contract-owned flag vocabulary

<!-- skillset:generated:start cli-flag-vocabulary -->
| Flag | Family | Value | Meaning |
| --- | --- | --- | --- |
| `--activation` | `output` | `boolean` | Inspect bounded provider activation evidence for status or explain. |
| `--adopt <value>...` | `mode` | `repeatable-value` | Select detected adoption candidates by stable id, or all. |
| `--agent-runtime` | `mode` | `boolean` | Render provider agent-runtime hook guidance. |
| `--all` | `selection` | `boolean` | Select every configured generated output rather than updated output. |
| `--append` | `mutation` | `boolean` | Append to an existing pending change reason. |
| `--attach <value>` | `selection` | `value` | Attach a new adaptive hook to an existing source-unit selector. |
| `--background` | `mode` | `boolean` | Queue an ad hoc test and return after recording it. |
| `--bump <value>` | `input` | `value` | Set the release impact of a change entry. |
| `--ci` | `mode` | `boolean` | Run check with strict non-interactive CI policy and reporting. |
| `--claude-setting-sources <value>` | `input` | `value` | Select Claude-native setting sources for an explicit Claude ad hoc test. |
| `--compat [value...]` | `selection` | `optional-value` | Filter lookup facts by one or more providers. |
| `--command <value>` | `input` | `value` | Set the command action for a new adaptive hook. |
| `--context-fields <value>` | `selection` | `value` | Select normalized hook runtime context fields. |
| `--details` | `output` | `boolean` | Show projection-level source and output paths. |
| `--event <value>...` | `input` | `repeatable-value` | Select a hook event; repeat where the route permits. |
| `--events` | `selection` | `boolean` | Show lookup event facts. |
| `--examples` | `selection` | `boolean` | Show lookup examples. |
| `--field <value>` | `selection` | `value` | Select one lookup field path. |
| `--fields` | `selection` | `boolean` | Show lookup field facts. |
| `--fix` | `mutation` | `boolean` | With check --ci, repair the ordinary drift allowed by local check --write. |
| `--format <value>` | `output` | `value` | Select a protocol command encoding such as hook context env or json. |
| `--from <value>` | `input` | `value` | Select the provider origin for local import. |
| `--frontmatter` | `selection` | `boolean` | Show lookup frontmatter facts. |
| `--group <value>` | `selection` | `value` | Select or assign a change group. |
| `--help` | `output` | `boolean` | Print help for the selected command route. |
| `--id <value>` | `input` | `value` | Set an explicit stable source-unit id. |
| `--in <value>` | `selection` | `value` | Select the containing plugin for a new source unit. |
| `--include <value>...` | `selection` | `repeatable-value` | Include an optional init scaffold component. |
| `--isolated` | `mode` | `boolean` | Use the isolated generated-output mirror instead of live output roots. |
| `--json` | `output` | `boolean` | Emit exactly one versioned finite JSON result document. |
| `--jsonl` | `output` | `boolean` | Emit a versioned newline-delimited event stream. |
| `--kind <value>` | `selection` | `value` | Select the import source kind. |
| `--lines <value>` | `selection` | `value` | Limit retained test output lines. |
| `--list` | `output` | `boolean` | List integrity-checked generated-output backups without restoring them. |
| `--name <value>` | `input` | `value` | Set a route-specific human or stable name where the route permits it. |
| `--only <value>` | `selection` | `value` | Restrict check to one named readiness component. |
| `--plugin <value>...` | `selection` | `repeatable-value` | Select plugins for an ad hoc test rendering. |
| `--pre-commit` | `selection` | `boolean` | Select the pre-commit hook snippet. |
| `--pre-push` | `selection` | `boolean` | Select the pre-push hook snippet. |
| `--preset <value>...` | `input` | `repeatable-value` | Apply a named new-source preset. |
| `--prompt <value>` | `input` | `value` | Provide an inline ad hoc test prompt. |
| `--prompt-file <value>` | `input` | `value` | Provide a source-local ad hoc test prompt file. |
| `--provider <value>...` | `selection` | `repeatable-value` | Constrain a new adaptive hook to a compatible provider. |
| `--reason <value>` | `input` | `value` | Provide change or release reason text, with '-' meaning stdin. |
| `--reason-file <value>` | `input` | `value` | Read change or release reason text from a file. |
| `--ref <value>` | `selection` | `value` | Select a change or release record by reference. |
| `--report <value>` | `output` | `value` | Write an additional command-owned report artifact without changing source truth. |
| `--root <value>` | `context` | `value` | Select the repository root; defaults to cwd or Git root according to the route. |
| `--runner <value>` | `selection` | `value` | Select the hook runner syntax to print. |
| `--schema` | `selection` | `boolean` | Show lookup schema facts. |
| `--scope <value>...` | `selection` | `repeatable-value` | Select a route-owned source unit or generated destination scope; never changes workspace roots. |
| `--script <value>` | `input` | `value` | Set the script action for a new adaptive hook. |
| `--since <value>` | `selection` | `value` | Select the Git baseline for change-aware checks or ledgers. |
| `--staged` | `selection` | `boolean` | Restrict a change check or status read to staged changes. |
| `--target <value>` | `selection` | `value` | Select one provider target for a route. |
| `--targets <value>` | `selection` | `value` | Select the initial provider set written by init. |
| `--timeout-ms <value>` | `mode` | `value` | Set the explicit ad hoc provider test timeout in milliseconds. |
| `--updated` | `selection` | `boolean` | Select only generated output affected by current source, the default build mode. |
| `--use <value>` | `mode` | `value` | Select source or output as the authority for a reconciliation plan. |
| `--values` | `selection` | `boolean` | Show lookup finite-value facts. |
| `--write` | `mutation` | `boolean` | Enable deterministic ordinary output writes for a route whose default is continuous or comprehensive preview. |
| `--yes` | `mutation` | `boolean` | Confirm a fully specified plan-first mutation without prompting. |
<!-- skillset:generated:end cli-flag-vocabulary -->

## Reserved combinations

- `check --fix` without `--ci` fails.
- `check --ci --write` fails; CI uses `--fix` so automation intent is visible.
- `check --since` and `--report` without `--ci` fail.
- `--updated` and `--all` are mutually exclusive.
- `--prompt` and `--prompt-file` are mutually exclusive and imply an ad hoc `test`.
- `--use` accepts exactly `source` or `output`; `--yes` without `--use` cannot apply reconcile.
- `restore --list` is read-only and cannot be combined with a backup id or `--yes`.
- `--json` and `--jsonl` are mutually exclusive. Leaf-route support follows the [structured-output ADR](../adrs/0023-versioned-structured-output-for-cli-automation.md), not a permissive global parser.

These combinations remain authored policy because the CLI flag registry does not encode cross-flag constraints. Parser tests verify their runtime behavior.

## Environment contract

Environment overrides exist only for explicit runtime-test and installed-hook integration boundaries. Ordinary source, check, build, update, and reconcile behavior has no environment-variable compatibility layer.

<!-- skillset:generated:start cli-environment -->
| Variable | Contract |
| --- | --- |
| `SKILLSET_HOOK_COMMAND` | Override the Skillset executable used by an explicitly installed hook integration. |
| `SKILLSET_HOOK_EVENT` | Carry the normalized hook event into an explicit hook command. |
| `SKILLSET_PROVIDER` | Carry the selected provider into an explicit hook command. |
| `SKILLSET_SESSION_ID` | Carry the provider session id into an explicit hook command. |
| `SKILLSET_TEST_CLAUDE_BIN` | Override the Claude executable for an explicit ad hoc or declared runtime test. |
| `SKILLSET_TEST_CLAUDE_SETTING_SOURCES` | Set the default Claude setting-source isolation for an explicit runtime test. |
| `SKILLSET_TEST_CODEX_BIN` | Override the Codex executable for an explicit ad hoc or declared runtime test. |
| `SKILLSET_TEST_CURSOR_BIN` | Override the Cursor executable for an explicit ad hoc or declared runtime test. |
<!-- skillset:generated:end cli-environment -->

Standard `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` behavior remains platform context rather than Skillset CLI vocabulary.
