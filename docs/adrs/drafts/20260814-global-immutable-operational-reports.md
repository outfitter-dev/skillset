---
slug: global-immutable-operational-reports
title: Global Immutable Operational Reports
status: draft
created: 2026-08-14
updated: 2026-08-14
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 4, 19, 22, 23]
amends: [19, 22]
---

# ADR: Global Immutable Operational Reports

## Context

Skillset needs durable evidence for operations such as adoption and external
fixture conformance. That evidence cannot live only at a caller-selected path:
paths collide, move, and mean different things on different machines. It also
cannot live in generated provider output. An operation receipt has a creation
time, an exact Skillset version, and a unique run identity, while generated
output must remain deterministic.

The current decisions leave three contracts to reconcile:

- [ADR-0019](../0019-deterministic-projection-and-adapter-conformance.md#projection-comparison)
  treats Skillset-owned reports as deterministic comparison material and places
  external-conformance reports under a logical workspace cache path;
- [ADR-0022](../0022-workflow-oriented-cli.md#final-command-roster)
  freezes a 21-command public roster without a report domain;
- [ADR-0023](../0023-versioned-structured-output-for-cli-automation.md#json-is-one-finite-result-envelope)
  requires every finite `--json` route to emit one shared CLI result envelope,
  not a command-specific object on stdout.

Without one report contract, each producer will invent its own ID, path,
retention, redaction, and retrieval behavior. A report can then appear durable
while leaking a token, following a symlink outside its store, or disappearing
with a rebuildable cache.

## Decision

Skillset retains immutable operational report bundles as user-global XDG state
under UUIDv4 identities and retrieves them through the finite
`skillset report show <id-or-path>` command.

### Operational reports are global state

Every completed bundle lives under one Skillset-owned state root:

```text
$XDG_STATE_HOME/skillset/reports/<report-id>/
  report.json
  report.md
```

Skillset resolves this root through its existing platform/XDG abstraction.
Reports do not use the repository-bucketed operational cache, a workspace
`.skillset/` path, or generated provider output.

The report ID is the durable reference. The resolved physical path remains a
local convenience returned to the caller, but it is not report identity and is
never persisted inside the report.

IDs are canonical lowercase RFC 4122 UUIDv4 strings. Writers use random UUIDs,
not a timestamp, shared counter, workspace prefix, truncated value, or
content-derived name. A report directory and its manifest must carry the exact
same ID.

Reports remain retained until a later explicit pruning decision. The first
contract has no expiry, deletion, mutable index, or `latest` pointer.

### The structured envelope is authoritative

`report.json` is one closed `skillset.report@1` object:

```json
{
  "schemaVersion": "skillset.report@1",
  "id": "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5",
  "kind": "operation",
  "createdAt": "2026-08-14T21:30:00.000Z",
  "skillset": {
    "version": "0.1.1"
  },
  "workspace": {
    "id": "skillset--local-12hexchars",
    "name": "skillset",
    "repository": {
      "identity": "github.com/outfitter-dev/skillset",
      "commit": "64618a42a23300b5cbbd308ed3fec0e64bae1a4e",
      "dirty": false
    }
  },
  "result": {
    "command": "check",
    "ok": true,
    "exitCode": 0
  },
  "payload": {}
}
```

The fields have one meaning:

| Field | Contract |
| --- | --- |
| `schemaVersion` | Exact report-envelope vocabulary, initially `skillset.report@1`. |
| `id` | Canonical UUIDv4 and exact bundle-directory name. |
| `kind` | Registered report kind selecting one closed payload contract. |
| `createdAt` | Canonical UTC ISO timestamp for this operation receipt. |
| `skillset.version` | Exact product version that created the receipt. |
| `workspace.id` | Required opaque, directory-safe workspace identity; never an absolute root path. |
| `workspace.name` | Optional bounded display name, not a path. |
| `workspace.repository.identity` | Optional sanitized host/path identity without credentials, userinfo, query, fragment, or a local path. |
| `workspace.repository.commit` | Optional full commit object ID. |
| `workspace.repository.dirty` | Optional observed dirty state; absence means unobserved, not clean. |
| `result.command` | Canonical producer leaf identity, never raw argv or a retired alias. |
| `result.ok` | Whether the producer command satisfied its contract; true exactly when `exitCode` is zero. |
| `result.exitCode` | Producer command outcome using the public CLI exit classes where the producer is a CLI route. |
| `payload` | Closed kind-specific facts after allowlisting and redaction. |

The shared schema package owns the envelope version, UUID shape, exported kind
vocabulary, structural types, validator, examples, and generated JSON Schema.
All envelope objects reject additional properties.

The initial `operation` kind has an empty payload. It lets the store and a
synthetic producer prove the contract without guessing adoption or evaluation
fields. Each later producer adds a named kind with its own closed payload rather
than widening `operation` into a generic data bag.

`report.md` is a deterministic human rendering of the validated structured
report. It cannot contain additional producer-owned prose. Retrieval verifies
that the Markdown bytes equal a fresh rendering of `report.json`, so an edited
Markdown view cannot masquerade as the receipt.

### Producers retain approved facts only

A central kind registry owns each payload's validator, sanitizer, and Markdown
projection. The generic producer accepts explicit structured input; it never
spreads a command options object or process result into the report.

Reports never persist raw argv, environment, subprocess streams, provider
output, prompts, arbitrary observed files, or absolute home/workspace paths.
Producers convert approved paths to logical workspace or cache identities
before calling the report layer.

Allowlisting is the primary sensitive-content control. The report layer also
redacts recognized credential-shaped strings and explicit caller-provided
sentinels before serialization, then scans both final serialized files. A
remaining sentinel refuses completion without echoing the sensitive value in a
diagnostic.

Large fixture clones, projections, detailed diffs, and raw test or evaluation
evidence stay in their owning XDG cache. A report payload may retain a logical
identity for that material; it does not copy arbitrary cache bytes or absolute
cache paths into the bundle.

### Bundles complete atomically

The writer creates the report root, staging directory, and completed directory
with private `0700` modes and creates `report.json` and `report.md` with private
`0600` modes where the platform supports POSIX permissions. It verifies modes
after writing rather than relying only on process umask.

The writer then:

1. creates a uniquely named staged directory inside the report root;
2. creates both files exclusively;
3. validates the full report, deterministic Markdown view, file types, and
   sensitive-content scan;
4. closes both files;
5. refuses a pre-existing final UUID path; and
6. renames the staged directory to the final UUID directory on the same
   filesystem.

Retrieval recognizes only completed UUID directories. It never exposes a
staged bundle. Writes are create-only: there is no supported update, append, or
overwrite operation. A duplicate ID fails closed.

Portable filesystem APIs do not guarantee a no-replace directory rename on
every platform. Private ownership of the report root plus random UUIDv4 IDs
makes an ordinary final-name race infeasible. Injected duplicate-ID tests must
still prove that an existing final bundle is refused and never overwritten.

Failure cleanup removes only the exact owned staged directory. It never
recursively removes a derived root or unresolved caller path.

### Retrieval is contained and validates the bundle

`skillset report show` accepts:

- a complete report UUID;
- its completed bundle directory; or
- the exact `report.json` or `report.md` inside that directory.

A UUID resolves only to the direct child with that name; prefix lookup is not
supported. A path must resolve inside the report root. Every component from the
root through the target is inspected without following symlinks. Symlinked
roots, directories, or files; traversal; special files; staged directories;
arbitrary filenames; and report-shaped files elsewhere on disk all fail.

The reader requires exactly two regular bundle files, validates
`report.json`, requires the manifest and directory IDs to agree, and checks the
stored Markdown against a fresh rendering. Human mode prints only that
validated Markdown view.

### Legacy report paths keep their existing readers until migration

Read compatibility does not widen `report show`. The command remains closed to
owned, completed, validated `skillset.report@1` bundles under the global report
root. It does not inspect an arbitrary outside-root path, infer a legacy report
kind from a filename, wrap old JSON or Markdown on demand, or introduce a
general compatibility adapter.

Existing producer-specific report paths continue through their current readers
until a named migration owner converts that producer to the global contract:

| Existing evidence | Current path and reader | Disposition and owner |
| --- | --- | --- |
| Adoption, import, and external-fixture evidence | Logical adoption/fixture paths under `.skillset/cache/...` and their current producer output | SET-445 owns conversion to completed global bundles after SET-453. Until that lands, the existing producer-specific paths remain legacy evidence and are not accepted by `report show`. |
| Deterministic and ad hoc test evidence | `.skillset/cache/tests/`, inspected through `skillset test status`, `test tail`, and `test list` | ADR-0012 and SET-180 own the current retained-test layout and readers. This decision does not migrate them; a later explicit test-report migration must add a report kind and preserve the test lifecycle contract. |
| Ungraded evaluation evidence | `.skillset/cache/evals/`, inspected through `skillset eval status` and `eval tail` | The ungraded-eval draft and SET-387 own the current retained-eval layout and readers. This decision does not migrate them; a later explicit eval-report migration must preserve isolated run evidence and its non-grading boundary. |
| CI readiness Markdown | The caller-selected `skillset check --ci --report <path>`, including runner-temp job-summary and PR-comment files | ADR-0022's readiness family and SET-278 own the current CI report behavior. The selected Markdown file remains a command-owned export, not an immutable global report. Any future conversion needs its own producer migration and must preserve CI artifact export rather than assuming runner-global state persists. |

This is the v1 compatibility promise: old producers keep functioning through
their established commands and paths, while every newly integrated global
producer writes the new envelope. Compatibility never means that the new
retrieval command trusts legacy or arbitrary filesystem content.

### JSON retrieval applies the shared CLI protocol

`skillset report show <id-or-path> --json` emits exactly one
`skillset.cli.result@1` envelope:

```json
{
  "schemaVersion": "skillset.cli.result@1",
  "command": "report.show",
  "ok": true,
  "exitCode": 0,
  "kind": "data",
  "data": {
    "report": {
      "schemaVersion": "skillset.report@1",
      "id": "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5",
      "kind": "operation",
      "createdAt": "2026-08-14T21:30:00.000Z",
      "skillset": { "version": "0.1.1" },
      "workspace": { "id": "skillset--local-12hexchars" },
      "result": { "command": "check", "ok": true, "exitCode": 0 },
      "payload": {}
    },
    "resolvedPath": "/absolute/local/path/to/the/report-bundle"
  },
  "diagnostics": [],
  "changes": [],
  "meta": {
    "schema": "https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/cli-result.schema.json"
  }
}
```

The validated report is nested at `data.report`; Skillset never emits a bare
report envelope. `data.resolvedPath` is optional route-owned local data. It may
be absolute because the user explicitly asked for the physical receipt, but it
never enters `report.json`, report identity, CLI `meta`, diagnostics, or
generated output.

Controlled failures use the same CLI result framing with
`command: "report.show"`, `kind: "diagnostics"`, and `data: {}`:

| Condition | Exit | Diagnostic |
| --- | ---: | --- |
| Valid full UUID not found | `1` | `report.not_found` |
| Invalid or outside-root reference, traversal, symlink, staged bundle, special file, or arbitrary filename | `2` | `report.invalid_reference` |
| Invalid envelope, ID mismatch, or Markdown mismatch in a caller-selected bundle | `2` | `report.invalid_bundle` |
| Operational filesystem read failure for an owned bundle | `3` | `report.read_failed` |
| Invariant or serialization defect | `4` | Existing unexpected-failure handling |

Human and machine modes return the same exit for the same outcome. Controlled
machine failures keep stdout pure and stderr empty under ADR-0023.

### Hermetic execution exports through the parent

Verification children receive runner-owned XDG roots, so Skillset resolves a
child report only inside the child's isolated XDG state. The current runner may
preserve `HOME` and the operating-system user; this is routing and authority
isolation, not proof of OS-level filesystem confinement. The export protocol
therefore withholds the parent destination and host report path rather than
claiming that the child process cannot inspect arbitrary host files.

An owning parent may import a completed child bundle through one explicit
export operation. The child does not choose or learn the host destination. The
parent:

1. proves that the source is a completed, symlink-free bundle inside the
   validated child sandbox;
2. reads exactly the two regular report files;
3. validates and sanitizes the structured report;
4. regenerates Markdown rather than trusting child Markdown bytes; and
5. completes the bundle through the same create-only parent store while
   preserving the report ID.

A parent ID collision refuses the export. The child never receives direct host
state authority.

### Operational receipts are outside projection determinism

This decision amends ADR-0019's broad “Reports owned by Skillset” comparison
language. Deterministic projection compares only runner-owned deterministic
reports and summaries. Global operational receipts intentionally contain a
UUID, UTC creation time, and exact Skillset version, so their bytes are not
compiler-projection evidence and are not normalized into equality.

The evidence boundary is:

| Evidence | Store | Determinism and identity |
| --- | --- | --- |
| Generated provider output, locks, Render Results, and deterministic comparison summaries | Workspace output or isolated comparison root | Byte or canonical-JSON deterministic after the narrow approved normalization. |
| Immutable operational summary | Global XDG state report store | UUID is durable identity; creation time and exact tool version are receipt evidence. |
| External fixture clones, staged projections, detailed diffs, and raw test/eval evidence | Owning XDG cache | Rebuildable or rerunnable material linked by logical identity from a report. |
| Recovery snapshots | Existing repository-local ignored snapshot store | Restore safety evidence with its existing lifecycle, not report state. |

For external conformance, the immutable summary moves to the global report
store. Logical `.skillset/cache/fixtures/...` references describe only linked,
bulky cache material. The external lane remains opt-in and outside ordinary CI;
this decision changes retention, not provider execution or semantic grading.

### Report is an explicit CLI domain

This decision amends ADR-0022's accepted base roster with one public domain.
The initial and only leaf is:

```sh
skillset report show <id-or-path>
```

`report` owns inspection of immutable global receipts. Workspace `status`,
`list`, and `explain` keep their current ownership and do not acquire global
report lookup. `report` without a leaf displays domain help; it is not a
retrieval alias.

ADR-0022's accepted base roster therefore changes from 21 to 22 top-level
commands and gains the area row `Reports | report`. Its hard-cut mapping gains
`report | report show`, and only the canonical `report` / `report.show` names
appear in help, diagnostics, structured output, and retained results.

The count is an amendment to ADR-0022's accepted base roster, not a claim that
this record reconciles every separately implemented command. The current
`eval` and `rename` routes and their draft decisions remain outside this
amendment. SET-474 separately owns the future `install`, `upgrade`, and
machine-scope `doctor` family and must compose with this accepted report delta
without changing report ownership.

## Non-Goals

- No `report list`, prefix search, mutable index, aliases, latest pointer,
  deletion, pruning, expiry, garbage collection, remote upload, or telemetry.
- No signing, encryption, content-addressed identity, shared counter, or
  repository-local report mirror.
- No arbitrary-file viewer and no import of report-shaped JSON outside the
  owned global root.
- No raw attachment store. Large fixture, test, and evaluation material stays
  in its owning cache.
- No adoption, external-fixture, evaluation, or gate producer migration in
  this decision. Those producers integrate through separately owned work.
- No change to generated provider artifacts, locks, source frontmatter, or
  rendered Skillset metadata.
- No machine installation, upgrade, diagnosis, activation, trust, publication,
  release, or provider-configuration mutation.
- No claim that file permissions make user-owned files cryptographically
  immutable. Immutable means create-only identity with no supported mutation
  API; retrieval validation detects structural and Markdown tampering.

## Consequences

### Positive

- Every report-producing operation can use one secure ID, envelope, store, and
  retrieval contract instead of inventing local retention behavior.
- Humans can keep using filesystem paths while automation uses a durable UUID
  and one versioned CLI result protocol.
- Detailed operation provenance leaves deterministic provider output without
  becoming disposable workspace cache.
- Positive field allowlists, private modes, contained resolution, and
  hermetic-parent export make sensitive evidence handling reviewable in one
  place.

### Tradeoffs

- Reports consume user-global state until an explicit future pruning workflow
  exists.
- Every new report kind needs a closed schema, sanitizer, Markdown projection,
  and tests before it can write.
- UUIDs, timestamps, and exact versions make report receipts intentionally
  nondeterministic; deterministic verification must compare the evidence they
  reference rather than the receipt bytes.
- Private POSIX modes and atomic directory rename have platform-specific
  limits that require explicit tests and honest capability claims.

### Risks

- A producer could leak sensitive data before the generic layer sees it.
  Positive kind-specific projection, forbidden raw invocation fields, and
  final serialized sentinel scans keep the failure visible.
- Path validation could follow a symlink or accept an arbitrary report-shaped
  file. Fixed depth, fixed filenames, component-by-component `lstat`, and
  root containment make retrieval fail closed.
- A crash could leave staged data. Staged names are never retrievable and
  cleanup removes only the owned stage; later maintenance may safely remove
  abandoned stages without treating them as reports.
- The command roster may drift while separate draft decisions remain
  unresolved. This amendment records only the report delta, and later CLI
  reconciliation must compose with it explicitly.

## References

- [Tenets](../../project/tenets.md) - generated-output determinism, inspectable provenance, explicit authority, and visible drift.
- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source and generated-output authority remain unchanged.
- [ADR-0004: Core Library and CLI Boundary](../0004-core-library-boundary.md) - Core owns explicit-input report facts and plans while the app owns argv, terminal rendering, and exit policy.
- [ADR-0019: Deterministic Projection and Adapter Conformance](../0019-deterministic-projection-and-adapter-conformance.md) - amended to distinguish deterministic projection evidence from retained operational receipts.
- [ADR-0022: Workflow-Oriented CLI With A Flat Loop And Explicit Domains](../0022-workflow-oriented-cli.md) - amended with the report domain and 21-to-22 accepted base-roster delta.
- [ADR-0023: Versioned Structured Output For CLI Automation](../0023-versioned-structured-output-for-cli-automation.md) - finite report retrieval applies its shared result framing without amendment.
- [ADR-0012: Fixtures, Tests, Dogfooding, and Evals](../0012-fixtures-tests-dogfooding-and-evals.md) - current retained test/eval evidence boundaries remain producer-owned until explicit migration.
- [Skillset beta release record](../../project/plans/beta-release.md#13--globally-retained-reports) - owner-approved global report product decision.
- [Schema contracts](../../development/schema-contracts.md) - shared structural fields and generated artifacts remain schema-first.
- [Tests and evals](../../reference/features/tests-and-evals.md) - current `.skillset/cache/tests` and `.skillset/cache/evals` layouts and reader commands.
- [Skillset CI](../../reference/features/ci.md) - current caller-selected CI Markdown export contract.
- [SET-453](https://linear.app/outfitter/issue/SET-453) - secure report-store implementation and acceptance owner.
- [SET-445](https://linear.app/outfitter/issue/SET-445) - adoption and external-fixture producer integration owner.
- [SET-180](https://linear.app/outfitter/issue/SET-180) - current retained-test path and lifecycle owner.
- [SET-387](https://linear.app/outfitter/issue/SET-387) - current retained-eval path and lifecycle owner.
- [SET-278](https://linear.app/outfitter/issue/SET-278) - current check/CI readiness report owner.
- [SET-474](https://linear.app/outfitter/issue/SET-474) - separate machine-scope CLI and ADR reconciliation owner.
