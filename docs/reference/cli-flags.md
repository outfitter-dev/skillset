# CLI Flag Contract

Status: accepted implementation input for SET-275; structured output values remain owned by SET-284.

The [workflow-oriented CLI ADR](../adrs/drafts/20260712-workflow-oriented-cli.md) fixes the top-level commands. This document fixes the flag vocabulary those command-family implementations consume. The machine-readable planning contract is `scripts/cli-contract.ts`; implementation slices move its facts into the owned CLI modules instead of creating a second runtime registry.

## Rules

- `--root <path>` is the only public workspace-location override. `--source` and `--dist` are removed because canonical source and output roots come from `skillset.yaml` and `.skillset/`.
- Preview is the default for plan-first mutations. `--dry-run` is removed as redundant.
- `--yes` confirms a fully specified plan-first mutation without prompting. It never selects what the mutation should do.
- `--write` enables deterministic ordinary output writes for comprehensive or continuous workflows: `check` and `dev`.
- `--fix` exists only with `check --ci`; it performs the same narrow repair as local `check --write`.
- `--use source|output` selects reconciliation direction. Reconcile still requires `--yes` to apply the selected plan non-interactively.
- `--scope` selects source units or generated destination groups owned by the route. It never redirects workspace roots.
- `--from` always identifies input origin. Init accepts a path or Git URL; import accepts a provider origin.
- General structured output remains entirely owned by SET-284. SET-275 neither removes `--json` nor replaces it with a guessed global flag. Protocol commands may retain a route-specific `--format` where the value changes protocol encoding.
- Removed flags fail as unknown. There are no aliases for `--apply`, `--dist`, `--dry-run`, `--global`, `--layout`, `--source`, or `--watch`.

## Canonical families

| Family | Purpose | Examples |
| --- | --- | --- |
| Context | Select repository context without rewriting config | `--root` |
| Input | Supply authored or acquired input | `--from`, `--prompt`, `--reason-file` |
| Selection | Narrow subjects, targets, scopes, or views | `--scope`, `--target`, `--only`, `--field` |
| Mode | Select an execution mode without confirming a write | `--ci`, `--isolated`, `--background`, `--use` |
| Mutation | Confirm or enable an explicitly bounded write | `--yes`, `--write`, `--fix` |
| Output | Select or write a representation/report | `--report`; general structured output deferred to SET-284 |

## Command matrix

The entries below are the complete final public flag set. Positional arguments and domain subcommands are omitted unless needed to distinguish routes.

| Route | Flags | Notes |
| --- | --- | --- |
| `init [destination]` | `--root`, `--from`, `--adopt`, `--targets`, `--include`, `--name`, `--yes` | `--adopt all` or repeat stable candidate ids. A TTY may select candidates interactively. |
| `import` | `--root`, `--from`, `--kind`, `--name` | Repeated-use asset conversion; import itself remains explicit. |
| `new` | `--root`, `--id`, `--name`, `--in`, `--scope`, `--preset`, `--yes` | Preview by default. |
| `check` | `--root`, `--only`, `--write`, `--ci`, `--fix`, `--since`, `--report` | `--fix` requires `--ci`; `--since` and `--report` are CI-only. |
| `dev` | `--root`, `--write` | Watching is the command's default; `--watch` and `--apply` disappear. |
| `reconcile <path>` | `--root`, `--use source` or `--use output`, `--yes` | Diagnosis is default; direction can be previewed before confirmation. |
| `build` | `--root`, `--updated`, `--all`, `--isolated`, `--scope`, `--yes` | Plan-first explicit compilation. |
| `update` | `--root`, `--yes` | Whole-workspace registered provider/compiler format migrations only. |
| `diff` | `--root`, `--updated`, `--all`, `--isolated`, `--scope` | Always read-only. |
| `restore <backup-id>` | `--root`, `--yes` | Preview by default. |
| `status` | `--root`; structured output deferred | Read-only human health/advisory view. |
| `list` | `--root`, `--scope`; structured output deferred | Inventory, not build-mode selection. |
| `explain <path>` | `--root`, `--scope`; structured output deferred | Workspace-specific provenance. |
| `lookup` | `--root`, `--frontmatter`, `--fields`, `--field`, `--values`, `--events`, `--compat`, `--examples`, `--schema`; structured output deferred | Provider aliases become values of `--compat`, not separate `--claude`/`--codex`/`--cursor` flags. |
| `test [name]` | `--root`, `--target`, `--prompt`, `--prompt-file`, `--plugin`, `--name`, `--timeout-ms`, `--claude-setting-sources`, `--background`; structured output deferred | Runtime flags select ad hoc execution; named declarations remain positional. |
| `test status` or `test list` | `--root`; structured output deferred | Retained-run lifecycle. |
| `test tail` | `--root`, `--lines`; structured output deferred | Retained output view. |
| `change status` | `--root`, `--since`, `--staged` | Read-only ledger status. |
| `change check` | `--root`, `--ref`, `--since`, `--staged` | Read-only ledger gate. |
| `change add` | `--root`, `--scope`, `--bump`, `--group`, `--reason`, `--reason-file`, `--since` | The subcommand is already an explicit write; no generic write-mode flag. |
| `change reason` | `--root`, `--ref`, `--append`, `--reason`, `--reason-file` | Explicit ledger edit. |
| `change amend` | `--root`, `--ref`, `--reason`, `--reason-file` | Explicit corrective record. |
| `change migrate` | `--root`, `--yes` | Plan-first migration. |
| `change show` or `change history` | `--root`, `--ref` | Read-only. |
| `change list` | `--root`, `--group` | Read-only. |
| `release audit` or `release plan` | `--root` | Read-only. |
| `release apply` | `--root`, `--yes` | Plan-first ledger application. |
| `release amend` | `--root`, `--ref`, `--reason`, `--reason-file` | Explicit corrective record. |
| `marketplace check` | `--root`; structured output deferred | Read-only catalog readiness. |
| `marketplace update` | `--root`, `--yes`; structured output deferred | Plan-first provider index update. |
| `distribute plan` | `--root` | Read-only; no destination override. |
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
- General structured-output support, including the fate and semantics of `--json`, is defined by SET-284 and not silently accepted globally.

## Hard-cut inventory

| Current surface | Final treatment |
| --- | --- |
| `--source <dir>` | Removed; canonical `.skillset/` source is configured by the workspace. |
| `--dist <dir>` | Removed; output roots are workspace configuration. |
| `--layout root` or `--layout nested` | Removed; retired layout compatibility is not public. |
| `--global` | Removed with top-level `create`; external destination uses `init [destination]`. |
| `--dry-run` | Removed; preview is already the default. |
| `dev --watch --apply` | Becomes bare `dev` and explicit `dev --write`. |
| `suggest-source --write --yes` | Becomes `reconcile --use output --yes`. |
| `check --fix` | Becomes local `check --write`; `--fix` remains CI-only. |
| `--claude`, `--codex`, `--cursor` lookup aliases | Removed; use `--compat <providers>`. |
| command-local `--json` | Preserved as an explicit open contract for SET-284; SET-275 does not rename or spread it. |

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

`SKILLSET_TRY_CLAUDE_BIN`, `SKILLSET_TRY_CODEX_BIN`, `SKILLSET_TRY_CURSOR_BIN`, and `SKILLSET_TRY_CLAUDE_SETTING_SOURCES` are removed without fallback. Standard `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` behavior remains platform context rather than Skillset CLI vocabulary.

Every implementation issue must update `CLI_ROUTE_FLAGS` with any evidence-backed divergence before changing parser behavior. SET-285 closes the loop by asserting root help, route help, and parser acceptance against this contract.
