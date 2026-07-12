---
slug: versioned-structured-output-for-cli-automation
title: Versioned Structured Output For CLI Automation
status: draft
created: 2026-07-12
updated: 2026-07-12
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, workflow-oriented-cli, core-library-boundary, deterministic-projection-and-adapter-conformance, lowering-outcomes-and-loss-ledger]
---

# ADR: Versioned Structured Output For CLI Automation

## Context

Skillset already has command-local `--json` output for `doctor`, `explain`, `features`, `lookup`, marketplace operations, and runtime tries. Those payloads expose useful facts, but they are not one automation contract:

- payload shapes are command-owned and unversioned;
- some commands print human progress before or beside JSON;
- parsing and setup failures can occur before the command reaches its JSON renderer;
- finite reports, retained event tails, watch streams, raw hook snippets, and protocol encodings do not have the same output shape;
- old command identity can leak into payloads even after the public command is consolidated;
- tests often prove JSON is parseable without proving the same envelope, diagnostics, exit class, and stdout rules across commands.

Adding `--json` mechanically to every command would make this worse. Automation needs a stable distinction between one result document, a stream of events, an intentionally raw artifact, and a protocol command whose encoding is already part of its interface.

## Decision

Skillset defines a versioned structured-output protocol with explicit finite, streaming, raw-artifact, and protocol command classes. `--json` always emits one finite result document. `--jsonl` always emits a newline-delimited event stream. Commands that cannot honestly satisfy either contract reject the flag and document their exception.

### Machine mode is selected before normal parsing

The CLI pre-scans raw arguments for `--json` and `--jsonl` before resolving the command route. This lets usage, unknown-command, invalid-flag, and setup failures use the requested machine representation instead of falling back to human prose.

The flags are mutually exclusive. A route that supports neither rejects them through the requested structured failure when possible. Human mode remains the default.

### JSON is one finite result envelope

Every successful or controlled failed `--json` invocation emits exactly one JSON object followed by one newline:

```json
{
  "schemaVersion": "skillset.cli.result@1",
  "command": "check",
  "ok": false,
  "exitCode": 1,
  "kind": "diagnostics",
  "data": {},
  "diagnostics": [
    {
      "code": "output.stale",
      "severity": "error",
      "message": "Generated output is stale.",
      "path": "plugins/example/codex/skillset.lock"
    }
  ],
  "changes": [],
  "meta": {
    "schema": "https://schemas.skillset.dev/cli/result/v1.json"
  }
}
```

Required fields have one meaning:

| Field | Contract |
| --- | --- |
| `schemaVersion` | Exact envelope vocabulary version. Major changes require a new value and schema path. |
| `command` | Canonical final leaf identity such as `check`, `test.tail`, or `marketplace.update`; never a retired alias. |
| `ok` | Whether the requested operation satisfied its contract. |
| `exitCode` | The process exit code, repeated so retained results are self-describing. |
| `kind` | One of `data`, `diagnostics`, `plan`, or `mutation`. |
| `data` | Command-owned versioned payload. Empty object when no data exists. |
| `diagnostics` | Stable diagnostic objects, not rendered prose. Empty array when none exist. |
| `changes` | Planned or completed write facts. Empty array for read-only commands. |
| `meta.schema` | Schema artifact for this envelope version. |

Optional metadata may include duration, selected target, or a portable report id. It must not expose absolute host paths, credentials, prompts that may contain secrets, environment dumps, or unstable timestamps as identity.

### Command data is namespaced and versioned with the envelope

The envelope is shared; `data` remains command-owned. Each supported leaf command has a JSON Schema that composes the envelope and fixes its `command`, `kind`, data shape, diagnostic codes, and change records.

The schema source belongs in `@skillset/schema`. Generated JSON Schema artifacts live under the existing versioned schema reference. TypeScript result types derive from or stay mechanically checked against that source; command renderers do not maintain parallel field lists.

### Diagnostics and changes are common facts

Diagnostics use the existing Workbench/core vocabulary where possible:

```ts
type CliDiagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
  line?: number;
  column?: number;
  help?: string;
};
```

`message` is stable enough for humans but is not the automation key; consumers switch on `code`. Paths are repository-relative or logical operational paths.

Changes distinguish intent from outcome:

```ts
type CliChange = {
  action: "create" | "update" | "delete" | "move";
  path: string;
  state: "planned" | "written" | "skipped" | "refused";
  reason?: string;
};
```

Plans emit `state: planned` without writing. Confirmed mutations report only actual outcomes. A refused update or reconcile direction is a diagnostic plus a `refused` change, never a human-only sentence.

### JSONL is an event protocol

Continuous commands use `--jsonl`, never `--json`. Each line is one complete event object:

```json
{"schemaVersion":"skillset.cli.event@1","command":"dev","sequence":1,"event":"started","data":{}}
{"schemaVersion":"skillset.cli.event@1","command":"dev","sequence":2,"event":"diagnostic","data":{"code":"output.stale","severity":"error"}}
{"schemaVersion":"skillset.cli.event@1","command":"dev","sequence":3,"event":"completed","data":{"ok":false,"exitCode":1}}
```

Every stream:

- starts sequence numbers at 1 and increases them monotonically;
- uses canonical command identity on every line;
- emits a `started` event before operation events;
- emits exactly one terminal `completed` or `failed` event when the process can shut down normally;
- flushes each newline-delimited event promptly;
- never embeds human progress lines in stdout.

`test tail` is a bounded event projection by default and may use finite `--json`. A future `--follow` mode is continuous and therefore requires `--jsonl`. `dev` is continuous and supports `--jsonl`, not finite `--json`.

### Stdout purity is absolute in machine mode

With `--json` or `--jsonl`:

- stdout contains only the selected JSON representation;
- controlled diagnostics, usage failures, and operation failures stay inside that representation;
- human headings, spinners, progress, hints, and subprocess chatter do not enter stdout;
- stderr stays empty for controlled Skillset outcomes;
- unexpected runtime failures may write a concise fallback to stderr only if serialization itself is unavailable.

Provider subprocess stdout/stderr is captured into command data or retained artifacts. It is never passed through to the machine-mode stdout stream.

### Exit codes classify outcomes

| Code | Class | Examples |
| --- | --- | --- |
| `0` | Success | clean check, completed plan, successful mutation, passing test |
| `1` | Completed negative result | readiness failure, test assertion failure, drift/conflict refusal |
| `2` | Usage or input error | unknown command/flag, invalid combination, malformed source/config |
| `3` | Operational dependency failure | unavailable provider binary, authentication, network/cache acquisition failure |
| `4` | Internal failure | invariant violation or unexpected unclassified exception |

Human and machine modes return the same code for the same outcome. A structured renderer cannot turn a failed operation into exit zero merely because it produced valid JSON.

### Every final command has an output class

| Command or leaf family | Class | Machine contract |
| --- | --- | --- |
| `init`, `new` | finite plan/mutation | `--json` |
| `import` | finite mutation | `--json` |
| `check` | finite diagnostics/mutation | `--json` |
| `dev` | continuous events | `--jsonl` |
| `reconcile` | finite diagnostics/plan/mutation | `--json` |
| `build`, `update`, `restore` | finite plan/mutation | `--json` |
| `diff` | finite data | `--json` |
| `status`, `list`, `explain`, `lookup` | finite data/diagnostics | `--json` |
| `test [name]`, ad hoc `test`, `test status`, `test list` | finite data/diagnostics | `--json` |
| `test tail` | finite retained events; continuous only with future `--follow` | `--json`; future `--jsonl` with `--follow` |
| `change *`, `release *` | finite data/plan/mutation | `--json` |
| `marketplace check|update` | finite diagnostics/plan/mutation | `--json` |
| `distribute plan` | finite plan | `--json` |
| `hooks print` | raw artifact | no envelope; rejects `--json` and `--jsonl` |
| `hooks run` | protocol exit contract | no envelope; invoked by hook runners |
| `hooks context` | protocol encoding | existing `--format env|json`; JSON is not the CLI result envelope |

Raw and protocol exceptions are deliberate. Wrapping a shell snippet or environment assignment protocol in a result envelope would make it unusable by its consumer.

### Help declares machine support per leaf route

Root help does not imply every route supports every machine flag. Leaf help lists its output class and supported structured flags. Unknown or misplaced machine flags fail with exit 2 and a structured diagnostic when a machine flag was requested.

### Contract tests use schemas, not prose snapshots

Every supported finite leaf command has tests that assert:

1. stdout parses as exactly one JSON value and ends with one newline;
2. stderr is empty for controlled success and failure;
3. the result validates against its generated command schema;
4. `command`, `kind`, `ok`, and `exitCode` agree with process behavior;
5. diagnostics use stable codes and relative/logical paths;
6. human prose is absent.

Every streaming leaf has equivalent line-by-line schema validation, monotonic sequence checks, terminal-event checks, and a test proving no partial or human line appears. Raw/protocol exceptions have tests proving machine flags are rejected and their native contract remains byte-stable.

## Non-Goals

- No promise that all command data has one universal shape.
- No envelope around raw hook snippets or protocol environment output.
- No backward compatibility for current unversioned JSON payloads before 1.0.
- No telemetry, remote reporting, or automatic upload of structured results.
- No streaming mode for commands that already complete with one bounded result.

## Consequences

### Positive

- Agents can parse success and controlled failure without scraping prose or guessing which stream contains JSON.
- Finite and continuous commands cannot silently overload one flag with incompatible framing.
- Canonical command identity survives the hard cut without aliases leaking into automation.
- Common diagnostics, changes, and exit classes make cross-command orchestration predictable.
- Explicit exceptions keep raw and protocol commands useful instead of forcing dishonest uniformity.

### Tradeoffs

- Existing unversioned JSON consumers must cut over before 1.0.
- Parser setup must identify machine mode before it can validate the rest of the command.
- Each leaf command needs a schema and both success/failure contract tests.
- Capturing subprocess chatter requires command adapters to return facts instead of printing directly.

### Risks

- A shared envelope could become a dumping ground. Command-owned data schemas and the four finite `kind` values limit that pressure.
- Exit-code classification can drift between commands. One shared classifier and cross-route tests must own it.
- JSONL processes can terminate without a terminal event after signals or hard crashes. Consumers must treat EOF without a terminal event as interrupted.
- Absolute paths or prompt content can leak into automation artifacts. Host-leak checks and explicit redaction tests apply to schemas and fixtures.

## Implementation Slices

1. **Envelope and schema kernel** - add result/event contracts, exit classification, early machine-mode selection, and reusable stdout-pure rendering.
2. **Finite read-only routes** - migrate status/list/explain/lookup/diff/check and finite ledger/catalog reports.
3. **Plan and mutation routes** - migrate init/new/import/build/update/reconcile/restore/release/marketplace writes with common change facts.
4. **Runtime and continuous routes** - migrate test results, retained events, and dev JSONL while preserving provider-output capture.
5. **Exceptions and closure** - prove hooks raw/protocol behavior, generate every schema artifact, and add full route-coverage guards under SET-285.

The command-family issues own their route migrations. SET-285 owns the final coverage inventory and rejects any supported leaf route without a schema-backed contract test.

## References

- [Tenets](../../tenets.md) - deterministic output, source truth, no activation, and visible diagnostics.
- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source and rendered output authority.
- [Workflow-Oriented CLI With A Flat Loop And Explicit Domains](20260712-workflow-oriented-cli.md) - canonical command names and hard-cut policy.
- [Core Library and CLI Boundary](20260612-core-library-boundary.md) - core returns facts while the CLI owns rendering.
- [Deterministic Projection and Adapter Conformance](20260613-deterministic-projection-and-adapter-conformance.md) - stable structured result evidence and host normalization.
- [Lowering Outcomes and Loss Ledger](20260614-lowering-outcomes-and-loss-ledger.md) - existing structured diagnostic and outcome vocabulary.
- [CLI Flag Contract](../../reference/cli-flags.md) - canonical flag families and explicit SET-284 boundary.
- [SET-284](https://linear.app/outfitter/issue/SET-284) - structured-output contract and implementation slicing.
- [SET-285](https://linear.app/outfitter/issue/SET-285) - final docs, fixtures, generated guidance, and coverage closure.
