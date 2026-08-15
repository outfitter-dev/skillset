---
description: Operational reports are immutable, globally retained Skillset receipts that can be retrieved by UUID or owned store path.
---

# Operational Reports

Operational reports are durable receipts for completed Skillset operations.
Each report has a globally unique UUIDv4 identity and lives in a private,
create-only bundle under the user's XDG state directory:

```text
$XDG_STATE_HOME/skillset/reports/<report-id>/
  report.json
  report.md
```

The report ID is the durable reference. The physical path is a local
convenience, not part of report identity or the structured receipt. Reports are
user-global state rather than [workspace](../../glossary.md#workspace) cache,
[generated output](../../glossary.md#generated-output), or recovery snapshots.
The [workspace layout](../source/workspace-layout.md#operational-storage-and-lifetimes)
compares those lifetimes and ownership boundaries.

## Inspect a Report

Use the full UUID when possible:

```bash
skillset report show 6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5
skillset report show 6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5 --json
```

The command also accepts the completed bundle directory or its exact
`report.json` or `report.md` path. A path must remain inside Skillset's report
store. Prefix IDs, traversal, symlinks, staged bundles, arbitrary filenames,
and report-shaped files elsewhere on disk are rejected.

Human output is regenerated from the validated structured receipt. JSON mode
uses the shared `skillset.cli.result@1` envelope with the receipt at
`data.report` and its local bundle path at `data.resolvedPath`; it never emits a
bare report object. Exact command syntax belongs to the generated
[`report` CLI reference](../cli/report.md).

## Bundle Contract

`report.json` is the authoritative closed `skillset.report@1` envelope. It
records:

- the report UUID, kind, and canonical creation time;
- the exact Skillset version that created it;
- an opaque workspace identity and sanitized repository facts when available;
- the canonical producer command and outcome; and
- one closed, kind-specific payload.

The closed union includes an empty `operation` payload plus bounded `adoption`,
`import`, and `external-fixture` payloads. Each typed payload retains only
relative identities, finite vocabularies, counts, hashes, and logical evidence
descriptors appropriate to that operation. New producers require another
explicit closed kind rather than turning the envelope into an arbitrary data
bag. See the generated
[`report` schema](../schemas/0.1.0/report.schema.json) and schema-valid
[`report` example](../examples/report.json) for the exhaustive shape.

Logical identity fields accept colon-free relative paths plus the explicit
`instructions:<relative-path>`, `plugin:.` or `plugin:<relative-path>`,
`plugins:<relative-path>`, `skills:<relative-path>`, and
`skill:<source-id>` forms. No other colon-bearing form is valid, so
drive-relative paths and URI-like values cannot be mistaken for retained
logical identities.

`external-fixture` receipts use the envelope workspace as the Skillset checkout
and therefore require its sanitized repository identity, exact commit, and dirty
state. Their payload adds only fixture facts and the Bun version; it does not
duplicate envelope-owned Skillset or checkout facts.

The fixture pipeline is one fixed phase map, ordered as `acquire`, `init`,
`import`, `lint`, `build`, `purity`, and `compare`. A phase records only its
status and exit class. Repeated work within a phase, including importing more
than one source unit, is aggregated into that single phase outcome; detailed
per-unit evidence remains in the producer-owned cache. After an early failure,
later phases remain present and use `not-run` or `skipped` with the `not-run`
exit class. `pipelinePassed` is true exactly when all seven phases passed with a
successful exit class. This invariant is enforced by both the runtime validator
and the generated JSON Schema, independently of the outer command result.

`report.md` is a deterministic human projection of `report.json`. Retrieval
rejects a bundle when the JSON is invalid, the directory and receipt IDs differ,
the Markdown no longer matches, or the bundle contains anything other than the
two expected regular files.

## Retention and Privacy

Completed reports are retained until a future explicit pruning contract is
introduced. There is currently no mutable index, `latest` pointer, deletion,
expiry, or garbage-collection command. Immutable means create-only identity and
tamper-detecting retrieval; it is not a claim of cryptographic immutability.

Report producers must pass allowlisted structured facts. The report layer does
not retain raw argv, environment, subprocess streams, provider output, prompts,
arbitrary observed files, or absolute home and workspace paths. It redacts
recognized credential-shaped values and caller-provided sensitive sentinels,
then scans both completed files before publishing the bundle. On POSIX systems,
the store and bundle directories are `0700` and the two files are `0600`.

## Current Producer Boundary

The first release establishes the store, structured contract, secure
child-to-parent export primitive, and `report show` reader. It does not expose a
generic public command for constructing arbitrary reports.

Existing producer-specific evidence keeps its current path and reader until
that producer receives an explicit migration:

| Existing evidence | Current owner | Current reader |
| --- | --- | --- |
| Deterministic and ad hoc test runs | Logical `.skillset/cache/tests/` in the repo's XDG cache bucket | `skillset test status`, `test tail`, and `test list` |
| Ungraded eval runs | Logical `.skillset/cache/evals/` in the repo's XDG cache bucket | `skillset eval status` and `eval tail` |
| CI readiness Markdown | Caller-selected `skillset check --ci --report <path>` | The caller or CI artifact surface |
| Adoption, import, and external-fixture evidence | Their existing logical cache paths and command output | Their current producer-specific workflows |

`skillset report show` deliberately does not infer a legacy report kind, wrap an
old file on demand, or read arbitrary filesystem content. Defining the typed
payload does not migrate a producer by itself. Producer migrations must project
only into their assigned closed kind and preserve any detailed cache evidence
under its existing lifecycle.

## Failure Behavior

| Condition | Exit | Diagnostic |
| --- | ---: | --- |
| Full UUID is not found | `1` | `report.not_found` |
| Reference is invalid, outside the store, or unsafe | `2` | `report.invalid_reference` |
| Owned bundle is malformed or has been edited | `2` | `report.invalid_bundle` |
| Owned bundle cannot be read | `3` | `report.read_failed` |
| Internal invariant or serialization failure | `4` | Unexpected-failure handling |

Human and JSON modes use the same exit class for the same result. Controlled
JSON failures preserve one finite result envelope and keep stdout machine-pure.

The design and security rationale live in the draft
[Global Immutable Operational Reports ADR](../../adrs/drafts/20260814-global-immutable-operational-reports.md).
