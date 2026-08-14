---
description: Records the product decisions and directives governing Skillset's beta release and controlled evaluation.
---

# Skillset Beta Release Decision Record

This is the canonical product decision record for Skillset's beta release and
controlled evaluation. It was reconstructed locally on 2026-08-13 from the
coordinating task's retained discussion, then amended on 2026-08-14 to reflect
the beta scope and execution contract.

This record owns the coherent product narrative, rationale, and durable
directives. The
[Skillset beta release Linear project](https://linear.app/outfitter/project/skillset-beta-release-ce62b966b1c0)
is the sole authority for work status, sequencing, dependencies, detailed
implementation briefs, and acceptance evidence. Nothing here claims that a
decision is implemented merely because it is recorded.

Keep this as one canonical record with stable numbered sections. Write a
selective supporting design document only when a consequential decision needs
durable detail beyond its implementation brief; use an ADR when the decision
changes an accepted architecture or public contract. Do not split this record
automatically into one file per section.

The governing doctrine is [Skillset Design Tenets](../tenets.md). In particular,
this record applies source-first ownership, one meaning per key, provider truth,
explicit authority boundaries, deterministic output, and inspectable
provenance.

## Reading the Record

Sections 01–17 describe the release as a whole: fidelity and product entry,
consumer and contributor guidance, authoring and build semantics, provenance,
reports, first-contact clarity, distribution metadata, external evidence, and
the owner-controlled evaluation threshold. Each section states a decision,
plus the rationale and implementation constraints needed to understand it.
Linear carries the corresponding work breakdown without being duplicated here.

---

## 01 — Provider-valid, high-fidelity projection

### Decision

Skillset canonical source preserves the highest useful semantic fidelity. The
compiler owns explicit, evidence-backed derivation and rendering into
provider-native shapes;
authors should not have to pre-flatten canonical data to the narrowest provider
contract.

For author metadata, accept convenient shorthand and structured canonical data,
then render Claude's native author object using the supported `name`, `email`,
and `url` fields. Other providers may receive their genuinely native shape.
Unsupported canonical information remains in source and receives an honest
render result; it is not silently discarded or poured into generic
`metadata.*`. Provider-specific overrides remain available for genuinely
provider-specific semantics.

Repair the Claude renderer and conformance contract globally rather than fixing
only the self-hosted fixture. Remove unsupported marketplace provenance and
require exact-pinned strict provider validation in hosted CI while keeping
ordinary builds offline.

Cursor is part of the beta fidelity scope rather than a distant follow-up. Bring
its claimed shared surfaces to near parity while keeping any provider-specific
gap explicit; “near parity” must not become a claim of identical capabilities.

### Rationale

Rich source can be rendered into a narrower provider representation, but lost
meaning cannot be reconstructed later. Provider metadata is useful only when a
named, provider-supported mapping preserves actual semantics or round-trip
value. This is foundational doctrine, not a one-off Claude workaround.

### Implementation directives

1. Encode “preserve meaning before representation” in project and contributor
   doctrine.
2. Route shared structural metadata through `@skillset/schema`.
3. Define explicit provider rendering and omission evidence.
4. Correct Claude author rendering and offline conformance.
5. Remove provider-unsupported marketplace provenance.
6. Validate generated Claude plugin and marketplace artifacts with an
   exact-pinned provider validator in hosted CI.
7. Validate the claimed Cursor surface and report remaining differences rather
   than silently omitting or approximating them.

## 02 — Product front doors and MCP sequencing

### Decision

Skillset has multiple first-class entry channels chosen by context:

- A persistent global CLI is the preferred local, system-wide path.
- Provider plugins are first-class agent-facing discovery and managed-update
  paths.
- Prefer a provider-managed plugin when a provider offers a suitable channel;
  keep Skillset-owned direct copy as a first-class installation channel rather
  than a degraded fallback.
- Exact-pinned ephemeral npm execution is a supported path when persistent
  installation is unavailable or undesirable.
- All channels must converge on the same application operations, diagnostics,
  provenance, and safety model.

Direct-copy installation is ledger-owned, reversible, and copy-based. Symlinks
are not a supported installation mechanism. Entering through a plugin, a
persistent CLI, or ephemeral execution must not change the meaning of the
underlying operation.

The initial CLI and provider plugins may ship without an MCP server. A local
stdio MCP adapter over shared application APIs is the next MCP direction.
Cloudflare-hosted Streamable HTTP remains a later, separately designed option
when a hosted capability has a concrete consumer.

### Rationale

No provider installation mechanism is universal. A user should not need a
global install solely because they entered through a plugin, nor a plugin solely
because they prefer the CLI. MCP is strategically useful, but it is not a
prerequisite for the first useful CLI and plugin experience.

### Implementation directives

1. Document capability-based entry and fallback behavior.
2. Keep the application core reusable by CLI, plugin, and future MCP adapters.
3. Verify exact-pinned ephemeral npm operation.
4. Design local stdio MCP before considering hosted transport.

## 03 — High-fidelity distribution value proposition

### Decision

Position Skillset as a source-first authoring and distribution toolchain for
agent capabilities. Its primary promise is to compile high-fidelity canonical
source into independently usable, provider-native artifacts without flattening
the source model to the lowest common denominator or relying on symlinks.

Adopted standards are the portability floor, not the capability ceiling.
Provider renderers preserve representable semantics, apply defined relocations,
permit genuine provider-specific refinement and fallback, and report
unavoidable incompatibility. Single-provider use remains first-class when
validation, reproducibility, lifecycle management, or future portability is
valuable; trivial one-off native files need not use Skillset.

### Rationale

Distribution authors need maximum compatibility and provider-native fidelity,
not merely a shared file format. Skillset creates value by accepting the hard
projection and maintenance work once while keeping each distribution native.

### Implementation directives

1. Teach “standards are the floor, not the ceiling” before the detailed support
   matrix.
2. Add a conceptual source-to-provider projection chart.
3. Keep the generated support matrix as evidence, not as the entire explanation.
4. Add distributor-oriented examples and link the explanation from product,
   authoring, and provider documentation.

## 04 — Consumer installation and machine lifecycle

### Decision

CLI-first and provider-plugin-first are separate but equal adoption paths, with
provider-managed plugins preferred where they provide the complete experience.

The primary public local command is:

```sh
npm i -g skillset
```

A planned Skillset-native command family owns installation, upgrade, and
diagnostics for the machine lifecycle. Installation manages explicit, previewed,
confirmed, version-matched companion integration through a provider plugin or a
Skillset-owned direct copy. Upgrade owns Skillset and companion-tooling lifecycle
changes. Diagnostics inspect machine-level availability, compatibility, and
ownership without becoming a second workspace-readiness gate.

Only this machine-lifecycle family may mutate provider discovery and
companion-integration locations. Provider-managed installation commands may
perform provider-owned writes, so Skillset must show the exact command and
expected effects before confirmation and record the result. Direct copies are
ledger-owned and reversible; symlinks are excluded. Repository `update` remains
the verb for managed objects and provider/compiler migrations, not for upgrading
Skillset itself.

The next repository experience is `skillset init` for new work or
adoption/import for existing material. `init`, build, provider trust, and runtime
activation remain separate authority steps from machine installation.

The provider-plugin path retains marketplace discovery and provider-managed
upgrades while converging on the same Skillset operations. Plugin installation,
plugin loading, CLI availability, repository initialization, generated output,
and runtime activation are distinct states and must be described separately.

These commands change the accepted public CLI roster and self-upgrade contract.
Their implementation therefore requires an accepted amendment or successor to
the governing workflow and native-distribution ADRs, plus revision or
supersession of the stale global-XDG install-and-sync draft. Planning prose
cannot silently override those records.

### Rationale

The global CLI makes `skillset` commands available as a reflex anywhere on a
personal machine. Plugins remove agent-guidance maintenance and create an equal
provider-native entrance. A direct-copy channel preserves a usable path when a
provider plugin is unavailable. None of these states proves another, and
compilation does not imply activation or trust.

### Implementation directives

1. Create one canonical installation journey with provider-specific branches.
2. Reconcile the lifecycle vocabulary and authority boundary through accepted
   decision records before exposing the new routes.
3. Document preview, ownership ledger, repair, collisions, upgrade, and removal
   behavior for provider-managed and direct-copy channels.
4. Make the installed companion and CLI compatibility relationship explicit.
5. Keep repository build and provider activation as separate authority steps.

## 05 — End-user trigger boundary

### Decision

Make Skillset awareness bold. The consumer router or appropriate specialist
should trigger whenever a user or agent creates, changes, reviews, imports,
builds, checks, reconciles, evaluates, or distributes Skillset-managed source or
a compatible agent artifact that is a credible Skillset candidate. Concrete
cues include `skillset.yaml`, `.skillset/`, skills, agents, rules/instructions,
hooks, plugins, provider projections, drift, and cross-provider distribution
intent.

Triggering does not predetermine adoption. The skill may conclude that direct
provider-native authoring is simpler for a disposable one-off artifact. Verify
the boundary with positive, negative, and ambiguous trigger cases across
supported providers.

### Rationale

Users should not need to know Skillset's name before its guidance becomes
useful. At the same time, the router must not claim every generic provider
configuration task or force Skillset where its maintenance cost is unjustified.

### Implementation directives

1. Rename the primary public skill to `skillset`.
2. Write a concise cue-rich description with explicit negative boundaries.
3. Route deep work to specialists so broad recognition does not consume broad
   context.
4. Add provider-spanning trigger evaluation.

## 06 — Router skill and missing-CLI recovery

### Decision

The primary `skillset` artifact is a small routing skill, not a workflow
specialist. It explains the capability map, performs a tiny dependency-free,
read-only platform probe, establishes CLI/runtime/workspace availability, and
hands the task to the smallest applicable specialist.

A missing CLI is an expected branch, especially for plugin-first entry. The
router can still recognize and inventory relevant material. It offers the
persistent global install, an exact-compatible ephemeral invocation where
permitted, or the shortest native alternative. It never silently installs
globally or weakens confirmation requirements. Installed guidance declares a
compatible CLI range so a stale executable cannot masquerade as sufficient.

### Rationale

The router must work before Skillset is installed and avoid loading a full
manual into context. Availability, compatibility, and workspace evidence are
more useful than a simple command-exists test.

### Implementation directives

1. Ship a small dependency-free availability probe with the router.
2. Define the guidance-to-CLI compatibility contract.
3. Reuse one preflight and reference set across specialists.
4. Route missing or incompatible tooling to explicit user-controlled recovery.

## 07 — End-user Skillset skill family

### Decision

Replace the comprehensive `use-skillset` skill with an action-oriented public
family:

- `skillset` — sentinel, capability map, preflight, and router.
- `skillset-init` — first-time creation and adoption of existing material.
- `skillset-maintain` — routine build, check, inspect, reconcile, and recovery.
- `skillset-design` — create or reshape a capability or complete agent toolbag.
- `skillset-config` — canonical configuration, schemas, resolution, rendering,
  and provider-specific fallback.
- `skillset-provider-capabilities` — explain and compare provider terminology,
  semantic equivalents, Skillset representations, rendering behavior, explicit
  overrides, and fidelity limits across providers and standards.
- `skillset-eval` — evidence design, deterministic tests, runtime evaluation,
  comparison, and interpretation.
- `skillset-review` — contextual review from one changed source unit through a
  complete system; it should trigger whenever Skillset-owned source changes.
- `skillset-audit` — formal, scoped, reproducible assessment of one capability,
  capability set, or explicitly selected collection.
- `skillset-publish` — packaging, release readiness, and authorized publication.

Each specialist owns one user outcome, uses progressive disclosure, and hands
off explicitly across lifecycle boundaries. The family may ship through both
CLI companion installation and provider plugins.

The beta slice starts with `skillset`, `skillset-init`, and
`skillset-maintain`. Those three must provide a coherent route, first-time or
adoption path, and ordinary maintenance loop before the broader specialist
family is required. The remaining specialists stay part of the decided product
shape without all becoming prerequisites for controlled evaluation.

### Rationale

One large skill makes every trigger expensive and blurs ownership. A small
router plus action-oriented specialists creates strong trigger descriptions,
lower context cost, and room for distinct workflows without making users learn
implementation topology.

`skillset-provider-capabilities` is the public interpreter of a shared Provider
Capability Crosswalk, not a hand-maintained provider encyclopedia. The same
typed, evidence-backed facts should serve compiler rendering, CLI lookup,
generated reference, documentation, and the skill. Provider-only capabilities
remain legitimate outcomes; portable support is a floor rather than a reason to
erase provider-native fidelity.

### Implementation directives

1. Define an ownership and handoff table for the public family.
2. Keep each skill lean; put provider matrices, schemas, examples, and recovery
   detail in shallow references or deterministic scripts.
3. Add trigger and cross-skill handoff tests.
4. Retire the separate legacy toolkit command surface and keep docs aligned
   with the unified product vocabulary.
5. Define one shared provider capability crosswalk and fidelity model before
   shipping the public specialist that interprets it.
6. Keep the public specialist independent of contributor-only material.

## 08 — Consumer/contributor boundary and capability craft

### Decision

Draw a bright, one-way dependency boundary:

```text
consumer product (skillset*) <- contributor system (skillset-dev*)
```

Contributor material may know, invoke, test, and extend the consumer product.
The public plugin must not import, reference, route to, or assume contributor
skills, internal repository paths, development docs, fixtures, release
machinery, or private scripts.

Public craft guidance broadens from “writing skills” to designing effective
agent capabilities: choosing among skills, agents, rules, hooks, configuration,
scripts, plugins, MCP, and no new artifact. A public guide owns durable judgment;
`skillset-design` applies it; `skillset-review` consumes it during changes;
repeatable rules should graduate into schemas, scaffolds, diagnostics, provider
evidence, and evals.

Contributor guidance uses a visible `skillset-dev-*` namespace. A
provider-neutral `skillset-dev` router begins with the tenets and relevant ADRs
and routes to focused schema, compiler, provider-adapter, provider-watch,
testing, fixtures, documentation, release, and ADR specialists. Provider watch
is designed for recurring automated sessions that monitor official provider and
agent-standard changes without automatically mutating contracts.

Bring the `skillset-dev` family forward as an early beta foundation so
contributors receive the same routing and progressive-disclosure benefits while
the public family is being built. Early availability does not weaken the
one-way dependency boundary: contributor guidance may consume the public
product, but public artifacts may never discover contributor internals.

### Rationale

Consumers need product knowledge, not compiler-repository topology.
Contributors should dogfood the public product, so the boundary is intentionally
one-way rather than mutual isolation. Naming makes the ownership visible;
dependency-closure checks make it enforceable.

### Implementation directives

1. Record the one-way boundary in doctrine and contributor guidance.
2. Add a generated-public-closure guard.
3. Create the capability-design guide and connect it to public skills.
4. Introduce the provider-neutral contributor router and focused specialists in
   small verified migrations.
5. Add tests proving public tasks cannot route into contributor-only material.

## 09 — Capability readiness and effectiveness scoring

### Decision

Score behaviorally coherent **capabilities** or explicitly bounded **capability
sets**, never repositories as a single subject. A repository audit inventories
and decomposes the subjects it contains.

Keep two independent score families:

1. **Capability Readiness** assesses source structure, semantics, provider
   fidelity, composition, lifecycle, safety, provenance, reproducibility, and
   available evidence under a versioned rubric.
2. **Capability Effectiveness** reports runtime results from a named eval suite
   under pinned provider, model, tools, version, environment, and repetition
   conditions.

Do not blend the two scores. Set readiness uses a system-level rubric and
required-component caps rather than an average of component scores. Provider
projections normally remain evidence for one canonical capability. Profiles
prevent a deliberately single-provider capability from being penalized for
irrelevant providers. Merely using Skillset earns no points; Skillset-managed
systems should score better only when they prove the desired properties.

### Rationale

A repository is a storage boundary, not necessarily one agent system. Blended
or averaged scores hide weak required components and make comparisons easy to
game. Separate readiness and effectiveness preserve the difference between
“well designed and maintainable” and “observably works under this runtime
matrix.”

### Implementation directives

1. Define capability and capability-set identity and confirmation rules.
2. Version readiness profiles, dimensions, caps, evidence, and confidence.
3. Keep effectiveness tied to comparable eval-suite/runtime matrices.
4. Start audits privately and experimentally before naming a public index or
   leaderboard.

## 10 — Scaffolds, templates, exemplars, and exclusion

### Decision

Keep three nouns distinct:

- A **scaffold** creates mechanical source shape.
- A **template** is an explicitly selected authoring aid embodying a known
  pattern.
- An **exemplar** is completed executable material for learning and verification.

Given only an identifier, `skillset new` must not invent a trigger, description,
title, workflow, body headings, resources, evals, or placeholder prose. The bare
scaffold is intentionally excluded from ordinary build/distribution until the
author has supplied meaningful active source.

Templates are opt-in and may later encode evidence-backed pattern families such
as workflow/checklist, reference/router, deterministic tool-backed, guarded, or
eval-backed capabilities. They must not present provider accidents or subjective
taste as universal structure. Reserved machine-owned placeholder sentinels may
exist only in excluded source; active-source validation rejects them, and they
can never reach a renderer. Do not infer exclusion from `TODO`s, empty headings,
or prose heuristics.

`examples/minimal` is the smallest completed, active exemplar demonstrating
source, preview, build, and check. Richer examples are named for the capability
they implement, such as `examples/decision-brief`.

The exact source key that expresses build exclusion is deliberately deferred
until the complete schema-surface map is reviewed. The behavior is decided; a
new `lifecycle`, `participation`, `status`, or `build` namespace must not be
invented before checking existing schema ownership and vocabulary.

The beta authoring slice is deliberately minimal and unopinionated: create a
mechanically valid identity-only source stub, keep it excluded until meaningful
source exists, and provide the completed `minimal` exemplar. Opinionated
templates are not required for controlled evaluation and must not be smuggled
into the default scaffold.

### Rationale

Useful capabilities come from real intent and expertise. Fabricated generic
content creates false confidence and can escape into generated output. Explicit
templates and completed exemplars can teach craft without making the default
scaffold opinionated.

### Implementation directives

1. Change bare scaffold generation to identity plus an explicit source-only
   exclusion mechanism once its canonical key is decided.
2. Add structural sentinel validation before any opt-in template ships.
3. Rename and document `examples/minimal` as the smallest completed example.
4. Add richer templates and exemplars only after provider and corpus evidence
   supports a distinct family.

## 11 — First build and output-state semantics

### Decision

Keep initialization and build as separate authority boundaries. `init` creates
canonical source and workspace configuration; `build` previews and authorizes
writes into provider-native destinations.

All relevant commands use one evidence classifier with at least these output
states:

- **No output baseline:** no trustworthy generated ownership baseline exists.
  This does not prove that the workspace has literally never been built.
- **Current:** source and managed output agree with the recorded baseline.
- **Source ahead:** active source would change established managed output, and
  the recorded output itself has not diverged.
- **Output diverged:** a managed output differs from the recorded baseline.
- **Blocked:** invalid source, ambiguous ownership, an unmanaged collision, an
  unsupported destination, or another safety condition prevents an ordinary
  write.

The phrase “not built yet” is appropriate only when the current operation has
direct evidence, such as immediately after `init`. Later commands use the more
honest “no output baseline.” Missing managed output after a previous build and
unmanaged files at intended destinations must not be misclassified as a first
build.

The normal transcript is:

```text
skillset init --yes
skillset build
skillset build --yes
skillset check
```

`check` validates source and output separately, remains nonzero while expected
active output is absent, and does not attempt per-path reconciliation for
prospective additions. `check --write` may remain a maintenance surface, but a
no-baseline case must use the same atomic whole-plan writer and print one clean
result; it is not the first-author path.

Next-action guidance is source-readiness aware:

- A fresh, minimally authored workspace should recommend creating or importing
  meaningful source, not building empty scaffolding.
- A migrated or already-authored workspace with credible active source should
  recommend previewing the first build.
- Draft/excluded source does not make the active output graph stale, but active
  references to excluded source fail validation.

### Rationale

No baseline, source changes, target-side edits, and ownership conflicts require
different operations. Treating them all as drift exposes recovery machinery
during an ordinary first run and can recommend unsafe authority choices.

### Implementation directives

1. Share one classifier across `status`, `diff`, `check`, and `build`.
2. Make initialization end with source-aware next guidance.
3. Keep whole-plan writes atomic with ownership/provenance.
4. Reserve reconciliation for actual output divergence.
5. Align README, quickstart, first-author, import/adopt, installation output, and
   generated guidance on the same transcript and vocabulary.

## 12 — Generated metadata and provenance

### Decision

For rendered skills, keep the artifact's own resolved version as:

```yaml
metadata:
  version: "0.1.1"
  skillset.schema: "1"
```

`metadata.version` remains the skill or capability version. The dotted
string-valued `metadata["skillset.schema"]` identifies and versions Skillset's
lightweight rendered-metadata contract while remaining compatible with the
portable Agent Skills metadata map.

Remove misleading `metadata.generated`. Do not put the Skillset CLI version,
timestamp, Git SHA, or content hashes into every rendered skill. Do not inject
undocumented generic Skillset metadata into rendered agent definitions.

Keep format-specific compatibility where it belongs: lock `schemaVersion` for
lock structure and sidecar schema fields for their own formats. Locks retain
ownership and deterministic hashes. Detailed operation provenance—including
exact CLI version, time, repository identity or commit when available, and run
evidence—belongs in retained reports or another central operational receipt,
not repeated throughout deterministic provider output.

### Rationale

The existing frozen `skillset@0.1.0` looks like a stale CLI version but is not
used as one. Replacing it with every product release would churn all generated
bytes without changing their semantics. The proposed split gives each version
one meaning and avoids turning provider artifacts into build logs.

### Implementation directives

1. Migrate rendered skill metadata to `metadata.version` plus
   `metadata["skillset.schema"]`.
2. Remove `metadata.generated` and undocumented agent metadata.
3. Audit rule comments, changelogs, sidecars, locks, backups, and marketplaces
   separately according to their real ownership or compatibility consumer.
4. Put exact operation provenance in the report contract from Section 13.

## 13 — Globally retained reports

### Decision

Reports are retained global state, not workspace cache. Store each report bundle
under one user-global Skillset state root:

```text
$XDG_STATE_HOME/skillset/reports/<report-id>/
  report.json
  report.md
```

Treat this store as an early shared foundation rather than rebuilding report
identity and retention inside each producer. Adoption, external-fixture,
evaluation, and gate evidence should integrate through the same secure producer
contract.

Each report receives one immutable, globally unique, directory-safe identifier
that is also recorded in its structured manifest. The ID is the primary durable
reference; the resolved physical path remains available for normal filesystem
access.

Provide:

```sh
skillset report show <id-or-path>
```

The command resolves a valid report ID, report bundle directory, structured
report path, or human-readable report path and validates the report envelope
rather than becoming an arbitrary file reader. Human mode displays the Markdown
view; `--json` emits the canonical structured report.

Report-producing commands print the ID, the retrieval command, and the resolved
path. Report manifests may include report schema, kind, creation time, exact
Skillset version, workspace/repository identity, optional commit evidence, and
result status.

The report contract must allowlist retained fields rather than persisting raw
arguments or environment data, reject credential-shaped leaks, use private
directory and file modes, and prevent traversal or symlink escape during write
and retrieval. Reports are inspectable evidence, not a reason to retain every
byte an operation observed.

Operational caches, external fixture clones, repository-local recovery
snapshots, compiler scratch files, and deterministic generated provider output
remain separate. Do not add automatic report expiry in the first pass; retention
and explicit pruning can be designed when real volume warrants it.

### Rationale

An ID makes reports globally addressable without lying about repository-relative
paths. Reports describe particular operations, so timestamps and exact tool
versions are useful there and do not damage deterministic provider output.

### Implementation directives

1. Define the report ID and `skillset.report@1` envelope.
2. Introduce the global report store through the platform/XDG abstraction.
3. Add ID-or-path retrieval and structured output.
4. Migrate report-class artifacts while retaining read compatibility for
   legacy references where practical.

## 14 — Status hierarchy and first-contact clarity

### Decision

`status` is informational. A completed inspection exits zero and, in structured
mode, returns a successful command envelope even when its readiness conclusion
is negative; readiness lives in a distinct conclusion field. Usage,
operational, and internal failures remain nonzero. `check` is the sole
workspace-readiness gate, not the only command with meaningful failure
semantics.

1. Lead every status response with the workspace conclusion, then source/output/
   release evidence, one appropriate next action, and optional detail.
2. Use the Section 11 output states consistently, including **no output baseline**
   and **output diverged**.
3. Remove global product-registry statistics from default workspace status;
   leave full coverage under `skillset lookup features`.
4. Make next actions readiness-aware: author/import when no meaningful source is
   active, build when credible active source is ready, reconcile only for actual
   divergence, and explain blockers without proposing an ordinary write.
5. Keep the first milestone's `diff` path-level, but call it an output-plan
   summary and classify each path by authority: new output, source ahead, output
   changed, or unmanaged collision.
6. Explain once that `.agents/skills/` is portable Agent Skills-compatible output
   consumed by Codex, while `.codex/` owns Codex-native repository components.
   Keep the source families explicit: `.skillset/skills/` lowers into skill
   roots, while `.skillset/agents/` contains project-agent/subagent profiles and
   lowers into provider agent destinations. It never maps to `.agents/`.
7. Add glossary entries for output baseline, output state, reconcile, recovery
   snapshot, release state, and report.
8. Defer content-level diff unless controlled-evaluation evidence makes it urgent.

## 15 — Plugin README and marketplace consistency

### Decision

Do not inject a Skillset-branded consumer guide into every generated plugin.
Keep three surfaces distinct:

1. `.skillset/plugins/<plugin>/README.md` is the plugin author's canonical,
   provider-neutral consumer README. When present, project it into each plugin
   bundle using the existing preprocessing, variables, and partial affordances.
   It may describe the plugin's use, configuration, prerequisites, and support,
   but it need not mention Skillset at all.
2. The generated top-level `plugins/README.md` remains a concise mechanical
   inventory of generated artifacts rather than a consumer guide.
3. Provider manifests and marketplace entries remain the authoritative
   discovery and installation surfaces. Lower canonical metadata only into
   fields supported by that provider, and do not invent provider-specific
   installation claims without declared distribution evidence.

The flagship Skillset plugin may mention Skillset because its author-owned
README is about Skillset. That is content authored for this plugin, not generic
compiler boilerplate. When a plugin has no canonical README, emit none unless a
provider contract requires one; do not fabricate prose.

### Rationale

Generated bundles belong to their plugin authors and users. Compiler branding
would conflate implementation provenance with the plugin's public identity and
would make ordinary generated output unnecessarily Skillset-centric. Locks and
operation reports carry compiler ownership and provenance without putting that
material into user-facing prose.

### Implementation directives

1. Define the canonical plugin README projection and its supported variables and
   partial behavior using existing preprocessing machinery.
2. Replace the flagship plugin's fixture-flavored README in canonical source.
3. Keep generated artifact inventory separate from the consumer README.
4. Reconcile Claude, Codex, and Cursor manifest and marketplace rendering against
   current provider contracts, including current Codex marketplace support and
   Cursor's manifest-versus-marketplace field split.

## 16 — Reproducible adoption-audit environment

### Decision

Make external adoption and fidelity testing bounded, repeatable release
evidence. The active external-fixture and guided-adoption workstream owns the
implementation and Linear breakdown; do not create a parallel audit system from
this plan.

The evidence must record the exact Skillset source/version, isolated HOME and
XDG roots, pinned external repository commits, selected targets, command output
and exit codes, provider-validator evidence, generated projections, and
semantic expectations. Passing init, import, lint, and build is necessary but
does not prove runtime dependency closure, curated scope, provider validity, or
semantic fidelity.

Import and adoption are part of the claimed beta journey, so their semantic
fidelity evidence is release-critical. A fixture run that passes mechanically
while concealing a meaningful omission, scope expansion, broken dependency, or
provider behavior does not satisfy the beta threshold. If the product later
removes import/adoption from the advertised journey, that scope change must be
explicit rather than inferred from schedule pressure.

Keep immutable report summaries in the global report store decided in Section 13.
Large reproducible fixture material such as clones, projections, and detailed
diff bundles may remain delete-safe XDG cache artifacts linked from the report.
Qualitative human and agent review remains part of the process, grounded in that
controlled evidence.

## 17 — Controlled-evaluation threshold

### Decision

Controlled evaluation is an invited, deliberately narrow phase, not an
automatic release state. The evidence gate may conclude that the documented
criteria are satisfied and recommend owner review; it may not share, publish,
broaden visibility, or approve the beta. Matt makes the explicit owner decision
to begin controlled evaluation, hold it, or narrow the advertised scope.

Before that owner decision, the evidence packet requires:

- At least one complete advertised entry path supports installation, use,
  upgrade, and removal.
- There are no known silent correctness failures on that path. Explicit
  unsupported, preserved-native, or review-required outcomes are acceptable;
  silently changing meaning is not.
- Every provider and distribution included in the round passes its applicable
  provider validation.
- The public Skillset plugin is coherent, triggers appropriately, and remains
  independent of contributor-only material.
- First-run CLI states and next actions are truthful for empty source, imported
  source, no output baseline, source-ahead output, divergence, and blockers.
- Relevant external fixtures prove semantic expectations, including important
  runtime dependencies, curated membership, references, and provider behavior;
  init/import/lint/build success alone is insufficient.
- Known limitations are disclosed, and failures produce inspectable report
  evidence.

Installation, upgrade, and removal evidence may use the advertised channel's
documented provider- or package-native lifecycle. The planned Skillset-native
machine-lifecycle commands from Section 04 are not beta prerequisites unless the
beta explicitly advertises them, and they remain subject to the required ADR
reconciliation before implementation.

Stop or withhold controlled evaluation for unauthorized or destructive writes,
silent semantic corruption, provider-invalid output on a claimed path, broken
install/upgrade/removal, consumer dependence on contributor-only capabilities,
sensitive data in outputs or reports, or a passed result that conceals
unverified important behavior.

MCP, hosted transport, scoring and leaderboards, a complete template library,
every specialist skill, every marketplace/provider, content-level diff polish,
and broad marketing polish may remain fast follows.

The npm distribution directories are ignored and untracked. Package and release
packing paths build them fresh. Contributors should run the source entry point
or a build-on-demand entry rather than invoke an ignored local build directly.
The remaining beta concern is evidence and developer experience: make that path
obvious and guarded, prevent a stale ignored local build or stale global
installation from masquerading as the current source, keep rebuilding trivial,
and prove that packaged artifacts came from a fresh build. This is evidence for
the owner's decision, not an independent sharing authority.

Broader promotion additionally requires:

- Every publicly advertised provider and channel has validated install, upgrade,
  and removal evidence.
- The public skill family and documentation stand without maintainer
  explanation.
- Serious adoption-fidelity findings are fixed, disabled, or converted into
  explicit review-required outcomes.
- The scaffold, template, and exemplar contract is implemented.
- Plugin README and marketplace rendering are current for every claimed provider.
- A representative external matrix passes semantic expectations.
- Controlled-evaluation feedback is incorporated or explicitly dispositioned.
- No P0 or P1 issue remains open in an advertised user journey.

The governing distinction is: owner-approved controlled evaluation requires
safety, honesty, and one genuinely usable path; broad promotion requires
completeness across every path Skillset publicly claims.

---

## Decision Log

- **2026-08-13 — Section 01:** Preserve high-fidelity canonical source; make the
  compiler own explicit provider rendering; correct Claude plugin validation
  globally; do not use provider metadata as an overflow channel.
- **2026-08-13 — Section 02:** Support persistent CLI, provider plugin, and exact-
  pinned ephemeral npm entry; ship CLI and plugins before MCP; pursue local
  stdio MCP before any hosted transport.
- **2026-08-13 — Section 03:** Make faithful provider-native distribution the
  primary product promise; standards are the floor, not the ceiling; preserve a
  first-class single-provider path.
- **2026-08-13 — Section 04:** Make CLI-first and plugin-first separate but equal;
  lead local installation with `npm i -g skillset`; make installation explicit,
  reversible, provider-native, and separate from build and activation.
- **2026-08-13 — Section 05:** Trigger boldly on Skillset evidence and compatible
  capability work while allowing the router to recommend direct native
  authoring when simpler.
- **2026-08-13 — Section 06:** Make `skillset` a small router with a dependency-free
  preflight, compatibility contract, and explicit missing-CLI recovery.
- **2026-08-13 — Section 07:** Adopt the public `skillset*` specialist family with
  `skillset-publish` as the distribution/release specialist,
  `skillset-review` as the change-triggered review lane, and
  `skillset-provider-capabilities` as the evidence-backed interpreter of
  provider concepts, equivalents, and fidelity.
- **2026-08-13 — Section 08:** Enforce the one-way consumer/contributor boundary;
  make capability design public product guidance; route internal work through
  `skillset-dev*`, tenets, ADRs, and recurring provider-watch evidence.
- **2026-08-13 — Section 09:** Score capabilities or explicit capability sets, not
  repositories; keep readiness and effectiveness separate; award proved
  properties rather than a Skillset brand bonus.
- **2026-08-13 — Section 10:** Keep bare scaffolds mechanical and build-excluded;
  make templates opt-in; prevent placeholder sentinels from rendering; reserve
  `minimal` for a completed exemplar; defer exact exclusion-key spelling until
  the schema map is reviewed.
- **2026-08-13 — Section 11:** Separate init from build; use one evidence classifier
  with no-output-baseline and output-diverged states; make next actions depend on
  meaningful source readiness.
- **2026-08-13 — Section 12:** Keep rendered skill artifact version at
  `metadata.version`; add `metadata["skillset.schema"]`; remove misleading
  generated stamps and undocumented agent metadata; retain detailed operation
  provenance in locks and reports.
- **2026-08-13 — Section 13:** Store reports globally under immutable unique IDs;
  make them retrievable through `skillset report show <id-or-path>`; keep caches,
  snapshots, and deterministic outputs separate.
- **2026-08-13 — Section 14:** Lead status with the workspace conclusion and an
  evidence-derived next action; distinguish Skillset source kinds, standards
  projections, provider consumers, and physical output paths.
- **2026-08-13 — Section 15:** Keep plugin-authored consumer READMEs, mechanical
  generated inventories, and provider marketplace metadata separate; do not
  inject Skillset branding into arbitrary generated plugins.
- **2026-08-13 — Section 16:** Treat external adoption and fidelity testing as
  repeatable release evidence; retain immutable reports globally, keep bulky
  reproducible fixture artifacts in cache, and use the active adoption project
  as the implementation owner.
- **2026-08-13 — Section 17:** Allow controlled evaluation once one advertised
  path is safe, honest, validated, usable, and inspectable; require cross-channel
  completeness and dispositioned feedback before broader promotion.
- **2026-08-14 — Beta framing and ownership:** Reframe readiness work as a beta
  release decision record; keep one canonical numbered record; let Linear alone
  own implementation status, sequencing, and evidence; create selective design
  documents and ADRs only when their subject warrants durable detail.
- **2026-08-14 — Lifecycle and channels:** Prefer provider plugins while keeping
  direct copy first-class and rejecting symlinks; reserve `install`, `upgrade`,
  and `doctor` for the machine lifecycle and provider-integration boundary; keep
  `update` for managed objects; reconcile accepted CLI and distribution ADRs
  before exposing the new commands.
- **2026-08-14 — Beta capability slice:** Bring Cursor toward honest near parity;
  start the public family with `skillset`, `skillset-init`, and
  `skillset-maintain`; bring the contributor-only `skillset-dev` family forward;
  keep default new-object authoring minimal and unopinionated.
- **2026-08-14 — Reports and status:** Establish the global immutable report
  store early; make `status` an informational zero-exit inspection with its
  readiness conclusion in data; keep `check` as the sole workspace-readiness
  gate.
- **2026-08-14 — Beta evidence and authority:** Keep import/adoption semantic
  fidelity on the claimed beta path; treat ignored distribution builds and
  installed-version freshness as evidence and developer experience; let the
  evidence gate recommend owner review without ever authorizing sharing or
  publication; reserve the final controlled-evaluation decision for Matt.
