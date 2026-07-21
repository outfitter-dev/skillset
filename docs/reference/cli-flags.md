# CLI Flag Contract

Status: accepted implementation input for SET-275 and the SET-284 structured-output ADR.

The [workflow-oriented CLI ADR](../adrs/drafts/20260712-workflow-oriented-cli.md) fixes the top-level commands. This document fixes the flag vocabulary those command-family implementations consume. The machine-readable planning contract is `scripts/cli-contract.ts`; implementation slices move its facts into the owned CLI modules instead of creating a second runtime registry.

## Rules

- `--root <path>` is the only public workspace-location override. `--source` and `--dist` are removed because canonical source and output roots come from `skillset.yaml` and `.skillset/`.
- Preview is the default for plan-first mutations. `--dry-run` is removed as redundant.
- `--yes` confirms a fully specified plan-first mutation without prompting. It never selects what the mutation should do.
- `--write` enables deterministic ordinary output writes for comprehensive or continuous workflows: `check` and `dev`.
- `--fix` exists only with `check --ci`; it performs the same narrow repair as local `check --write`.
- `--use source|output` selects reconciliation direction. Reconcile still requires `--yes` to apply the selected plan non-interactively.
- `--scope` selects source units or generated destination groups owned by the route. It never redirects workspace roots.
- `--from` selects a provider origin for local import. Init uses its existing-directory positional argument and `--adopt`; public Git URL acquisition is unsupported.
- `--json` always selects one finite versioned result document. `--jsonl` always selects a versioned event stream. Protocol commands may retain route-specific `--format` where the value changes protocol encoding.
- Removed flags fail as unknown. There are no aliases for `--apply`, `--dist`, `--dry-run`, `--global`, `--layout`, `--source`, or `--watch`.

## Canonical families

| Family | Purpose | Examples |
| --- | --- | --- |
| Context | Select repository context without rewriting config | `--root` |
| Input | Supply authored or acquired input | `--from`, `--prompt`, `--reason-file` |
| Selection | Narrow subjects, targets, scopes, or views | `--scope`, `--target`, `--only`, `--field` |
| Mode | Select an execution mode without confirming a write | `--ci`, `--isolated`, `--background`, `--use` |
| Mutation | Confirm or enable an explicitly bounded write | `--yes`, `--write`, `--fix` |
| Output | Select or write a representation/report | `--json`, `--jsonl`, `--report` |

## Command matrix

The entries below are the complete final public flag set. Positional arguments and domain subcommands are omitted unless needed to distinguish routes.

| Route | Flags | Notes |
| --- | --- | --- |
| `create [name]` | `--root`, `--targets`, `--include`, `--yes`, `--json` | Creates a normalized named child under the current directory or `--root` parent. A TTY asks for missing name, parent, provider, and integration intent, previews the child path and Git initialization, then confirms with No as the default. |
| `init [directory]` | `--root`, `--adopt`, `--targets`, `--include`, `--yes`, `--json` | Initializes an existing directory. `--adopt all` or repeated stable candidate ids import detected repo-local sources; `init --from` is unsupported. |
| `import` | `--root`, `--from`, `--kind`, `--name`, `--json` | Repeated-use local asset conversion from a positional path or provider-default root; `--from` selects the provider origin, not an external path or Git URL. |
| `new` | `--root`, `--id`, `--name`, `--in`, `--scope`, `--preset`, `--event`, `--command`, `--script`, `--attach`, `--provider`, `--yes`, `--json` | Creates skills, project agents, instructions, and schema-valid adaptive hooks. Hook events and compatible providers are registry-derived; attachment selectors resolve existing source units. Preview is the default and no build runs implicitly. |
| `check` | `--root`, `--only`, `--write`, `--ci`, `--fix`, `--since`, `--report`, `--json` | `--fix` requires `--ci`; `--since` and `--report` are CI-only. |
| `dev` | `--root`, `--write`, `--jsonl` | Watching is the command's default; `--watch` and `--apply` disappear. |
| `reconcile <path>` | `--root`, `--use source` or `--use output`, `--yes`, `--json` | Diagnosis is default; direction can be previewed before confirmation. |
| `build` | `--root`, `--updated`, `--all`, `--isolated`, `--scope`, `--yes`, `--json` | Plan-first explicit compilation. |
| `update` | `--root`, `--yes`, `--json` | Whole-workspace registered provider/compiler format migrations only. |
| `diff` | `--root`, `--updated`, `--all`, `--isolated`, `--scope`, `--json` | Always read-only. |
| `restore <backup-id>` or `restore --list` | `--root`, `--yes`, `--json`, `--list` | Preview a selected backup by default, or list integrity-checked backups without writing. `--list` cannot be combined with an id or `--yes`. |
| `status` | `--root`, `--json` | Read-only human health/advisory view. |
| `list` | `--root`, `--scope`, `--json` | Inventory, not build-mode selection. |
| `explain <path>` | `--root`, `--scope`, `--json` | Workspace-specific provenance. |
| `lookup` | `--frontmatter`, `--fields`, `--field`, `--values`, `--events`, `--compat`, `--examples`, `--schema`, `--json` | Workspace-independent reference lookup; `--root` is rejected. Provider aliases become values of `--compat`, not separate `--claude`/`--codex`/`--cursor` flags. |
| `test [name]` | `--root`, `--target`, `--prompt`, `--prompt-file`, `--plugin`, `--name`, `--timeout-ms`, `--claude-setting-sources`, `--background`, `--json` | Runtime flags select ad hoc execution; named declarations remain positional. A bare TTY uses one chooser for all canonical declarations, one declaration, or an ad hoc prompt; retained `list`/`status`/`tail` history stays outside the picker. |
| `test status` or `test list` | `--root`, `--json` | Retained-run lifecycle. |
| `test tail` | `--root`, `--lines`, `--json` | Bounded retained output; a future `--follow` uses `--jsonl`. |
| `change status` | `--root`, `--since`, `--staged`, `--json` | Read-only ledger status. |
| `change check` | `--root`, `--since`, `--staged`, `--ref`, `--json` | Read-only ledger gate. |
| `change add` | `--root`, `--since`, `--scope`, `--bump`, `--group`, `--reason`, `--reason-file`, `--json` | The subcommand is already an explicit write; no generic write-mode flag. |
| `change refresh` | `--root`, `--since`, `--ref`, `--yes`, `--json` | Preview stale or missing pending evidence by default; use the same `--since <ref>` as the failing check, then `--yes` to append evidence for that exact baseline. |
| `change ignore` | `--root`, `--ref`, `--yes`, `--json` | Preview an intentional ignore by default; `--yes` appends an audit disposition while preserving the pending reason and existing coverage evidence. Frontmatter compatibility entries must migrate first. |
| `change reason` | `--root`, `--ref`, `--reason`, `--reason-file`, `--append`, `--json` | Explicit pending-reason edit. |
| `change amend` | `--root`, `--ref`, `--reason`, `--reason-file`, `--json` | Explicit applied-history correction. |
| `change migrate` | `--root`, `--yes`, `--json` | Plan-first migration. |
| `change show` | `--root`, `--ref`, `--json` | Read-only pending or history lookup. |
| `change history` | `--root`, `--ref`, `--json` | Read-only applied history. |
| `change list` | `--root`, `--group`, `--json` | Read-only pending-entry inventory. |
| `release audit` or `release plan` | `--root`, `--json` | Read-only. |
| `release apply` | `--root`, `--yes`, `--json` | Plan-first ledger application. |
| `release amend` | `--root`, `--ref`, `--reason`, `--reason-file`, `--json` | Explicit corrective record. |
| `marketplace check` | `--root`, `--json` | Read-only catalog readiness. |
| `marketplace update` | `--root`, `--yes`, `--json` | Plan-first provider index update. |
| `distribute plan` | `--root`, `--json` | Read-only; no destination override. |
| `hooks print` | `--runner`, `--pre-commit`, `--pre-push`, `--target`, `--agent-runtime` | Prints reviewed integration material. |
| `hooks run` | `--root` | Event stays positional. |
| `hooks context` | `--root`, `--event`, `--format`, `--context-fields` | Protocol output values remain a SET-284 exception surface. |

## Reserved combinations

- `check --fix` without `--ci` fails.
- `check --ci --write` fails; CI uses `--fix` so automation intent is visible.
- `check --since` and `--report` without `--ci` fail.
- `--updated` and `--all` are mutually exclusive.
- `--prompt` and `--prompt-file` are mutually exclusive and imply ad hoc `test`.
- `--use` accepts exactly `source` or `output`; `--yes` without `--use` cannot apply reconcile.
- `restore --list` is read-only and cannot be combined with a backup id or `--yes`.
- `--json` and `--jsonl` are mutually exclusive. Leaf-route support follows the [structured-output ADR](../adrs/drafts/20260712-versioned-structured-output-for-cli-automation.md), not a permissive global parser.

## Hard-cut inventory

| Current surface | Final treatment |
| --- | --- |
| `--source <dir>` | Removed; canonical `.skillset/` source is configured by the workspace. |
| `--dist <dir>` | Removed; output roots are workspace configuration. |
| `--layout root` or `--layout nested` | Removed; retired layout compatibility is not public. |
| `--global` | Removed; `create [name]` owns local named child repositories only. |
| `--dry-run` | Removed; preview is already the default. |
| `dev --watch --apply` | Becomes bare `dev` and explicit `dev --write`. |
| `check --fix` | Becomes local `check --write`; `--fix` remains CI-only. |
| `--claude`, `--codex`, `--cursor` lookup aliases | Removed; use `--compat <providers>`. |
| command-local `--json` | Standardized as one finite versioned result document by SET-284. |

## Structured-output migration coverage

SET-287 moved finite read-only routes onto `skillset.cli.result@1`: `check`, `diff`, `list`, `status`, `explain`, `lookup`, `change status|check|show|list|history`, `marketplace check`, and `distribute plan`.

SET-288 applied the same versioned result contract to finite plan and mutation routes. SET-289 added versioned JSONL events for continuous `dev` output and kept retained runtime-test evidence as an explicit raw-protocol exception.

## Environment contract

Environment overrides exist only for explicit runtime-test and installed-hook integration boundaries. Ordinary source, check, build, update, and reconcile behavior has no environment-variable compatibility layer.

| Variable | Contract |
| --- | --- |
| `SKILLSET_TEST_CLAUDE_BIN` | Override the Claude executable used by an explicit test. |
| `SKILLSET_TEST_CODEX_BIN` | Override the Codex executable used by an explicit test. |
| `SKILLSET_TEST_CURSOR_BIN` | Override the Cursor executable used by an explicit test. |
| `SKILLSET_TEST_CLAUDE_SETTING_SOURCES` | Default Claude-native setting-source isolation for an explicit test. |
| `SKILLSET_HOOK_COMMAND` | Override the Skillset command used by an explicitly installed hook integration. |
| `SKILLSET_PROVIDER` | Normalized provider context carried into an explicit hook command. |
| `SKILLSET_HOOK_EVENT` | Normalized event context carried into an explicit hook command. |
| `SKILLSET_SESSION_ID` | Normalized provider session id carried into an explicit hook command. |

The former `SKILLSET_TRY_*` variables are removed without fallback. Standard `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` behavior remains platform context rather than Skillset CLI vocabulary.

Every implementation issue must update `CLI_ROUTE_FLAGS` with any evidence-backed divergence before changing parser behavior. SET-285 closes the loop by asserting root help, route help, and parser acceptance against this contract.
