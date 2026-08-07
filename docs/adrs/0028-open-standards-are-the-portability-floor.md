---
id: 28
slug: open-standards-are-the-portability-floor
title: Open Standards Are the Default Portability Floor
status: accepted
created: 2026-08-06
updated: 2026-08-07
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 3, 5, 6, 9, 18, 19]
amends: [1, 5, 18]
---

# ADR-0028: Open Standards Are the Default Portability Floor

## Context

Skillset currently describes portable source primarily in relation to provider
targets. Authors write adaptive source, `compile.targets` selects Claude,
Codex, and Cursor projections, and target adapters render provider-native
artifacts. That model correctly preserves provider truth, but it leaves a
missing layer between authored intent and provider output: a public standard
may define the minimum interoperable meaning before any provider-specific
adaptation begins.

Agent Skills already demonstrates that shape. A skill can have a standard
directory and `SKILL.md` contract while individual clients add supported
frontmatter, installation behavior, discovery rules, or other native details.
The shared contract is neither a fourth provider nor merely whichever subset
the current providers happen to share. It is the floor against which portable
skill claims can be validated.

The Agent Plugins specification extends the same idea to plugin packages. Its
1.0 working draft defines a root `plugin.json`, standard `skills/`, root
`mcp.json`, path-containment rules, and reverse-domain extension points. It is
currently narrower than the plugin models Skillset targets: it does not make
hooks, agents, rules, commands, apps, or every provider-native companion
portable. It is nevertheless a real package contract consumed by multiple
clients, including Codex, and it gives Skillset a useful standards-native
projection that is independent of any one provider.

AGENTS.md supplies the instruction counterpart. The project presents
`AGENTS.md` as a simple open format for coding-agent guidance, uses ordinary
Markdown, and defines nested files as increasingly local instruction scope.
Codex consumes that shared baseline while adding native discovery behavior for
global files, `AGENTS.override.md`, fallback filenames, merge order, and byte
limits. That is the same floor-and-delta pattern as skills and plugins: the
portable artifact is broader than Codex, while Codex remains a concrete native
consumer with additional behavior.

Treating that projection as just another provider would overload
`compile.targets`, confuse package conformance with runtime behavior, and imply
that standards compete with Claude, Codex, or Cursor. Treating standards only
as optional export formats would undersell them: portable source could drift
outside the common contract while every provider renderer continued to pass
its own tests.

There are therefore two separate defaults to decide:

1. whether adopted standards govern the portable meaning of applicable source;
2. whether Skillset materializes an independent standards-native artifact in
   addition to provider-native outputs.

The word "agent" already has another meaning in Skillset. Project agents are
authored roles under `.skillset/agents/` and render to provider-native agent
files. The workspace schema also admits a bare root `agents:` object in its
maximal example, although the compiler does not consume the example's
`agents.defaults.skillsPrompt` value. Reusing `agents` for a standards family
without qualifying these meanings would preserve an ambiguity the source
contract should remove.

## Decision

The keeper sentence is: **adopted open standards are Skillset's default
portability floor, and provider renderers are explicit deltas from that
floor.**

Skillset treats standards as a first-class compile dimension, distinct from
providers, runtimes, and distribution destinations.

| Concept | Responsibility |
| --- | --- |
| Adaptive source | Captures author intent once in the Skillset source graph. |
| Adopted standard profile | Defines the minimum portable semantics and structural conformance for an applicable source kind. |
| Agent standards family | Groups the adopted AGENTS.md, Agent Skills, and Agent Plugins profiles under `compile.agents`. |
| Project agent | Defines a reusable project-scoped role under `.skillset/agents/`; it is a source entity, not a standard profile. |
| Provider target | Renders the source graph for a provider's native files, extensions, limitations, and activation model. |
| Runtime adapter | Proves how a generated artifact is discovered, installed, trusted, or exercised by a concrete client. |
| Distribution destination | Moves an already generated artifact without changing its semantic contract. |

### Standard Adoption

An external specification does not become part of the floor merely because it
exists. `@skillset/registry` records standards as `candidate`, `adopted`, or
`retired` and owns the pinned specification/schema evidence used by the
compiler. A standard can become `adopted` only when Skillset has:

- a public contract with an identifiable owner and stable source, plus either
  an upstream version or a Skillset-pinned immutable snapshot identity;
- a faithful mapping from a defined part of adaptive source;
- deterministic, offline structural validation and rendering;
- fixtures that cover both conforming output and known boundaries;
- conformance evidence against at least one real consuming client; and
- an explicit drift, version-upgrade, and retirement policy.

Ordinary builds never float to the latest upstream specification. The registry
pins the supported standard version when one exists; unversioned formats use a
content hash, observed date, and stable source URL. Generated lock provenance
records the standard profile and pinned evidence identity, projection
coverage, and any excluded, transformed, lossy, or unsupported source
features.

The initial standards are:

- **Agent Instructions:** Skillset's name for the adopted instruction floor
  defined by the open AGENTS.md format. Its standard profile covers plain
  Markdown, repository and nested placement, and increasingly local scope.
  Client-specific discovery files, precedence, fallback names, and byte limits
  remain provider deltas.
- **Agent Skills:** the adopted component floor for portable skills. Skillset
  validates the standard meaning before adding provider-supported deltas.
- **Agent Plugins 1.0:** the first package-standard profile selected for
  adoption. It moves from candidate to adopted, and therefore defaults on,
  only after the gates above pass against the working-draft version Skillset
  pins. The working-draft label raises the drift bar; it does not reduce the
  standard to a provider format.

### Agent Standards and Project Agents Use Qualified Names

`compile.agents` is the user-facing namespace for the capital-A Agent
standards family. Its children name the adopted artifact kinds rather than
providers or source entities:

| Path | Meaning |
| --- | --- |
| `compile.agents` | Enable or disable every adopted Agent standards projection, or configure them individually. |
| `compile.agents.instructions` | Materialize the standalone Agent Instructions projection as `AGENTS.md`. |
| `compile.agents.skills` | Materialize the standalone Agent Skills projection. |
| `compile.agents.plugins` | Materialize the standalone Agent Plugins projection. |
| `.skillset/agents/` | Author project-agent source. |
| `defaults.<provider>.agents` | Configure provider-native project-agent defaults. |

Documentation must use **Agent Instructions**, **Agent Skills**, **Agent
Plugins**, or **Agent standards** for the public standards family. It must use
**project agent** for the adaptive role source kind. A bare "agent output" is
insufficient when the distinction affects configuration, rendering, or
provenance.

The existing bare root `agents:` workspace object is not retained as a second
configuration home. Its currently admitted shape is structurally open and its
documented `skillsPrompt` example has no compiler behavior. The implementation
of this ADR removes that placeholder from every configuration surface that
admits it, including the workspace and plugin config key allowlists and the
generated example.
Project-agent source stays under `.skillset/agents/`, and provider-native
project-agent defaults stay under `defaults.<provider>.agents`. Unknown bare
root `agents:` configuration fails instead of being silently accepted.

Internal code keeps the same distinction: standard-profile types use an
`AgentStandard` or `AgentProfile` name, while role-source types use
`ProjectAgent`. The standards namespace must not introduce a generic `Agent`
type that erases which concept a value represents.

### The Standards Floor Is Default, Not Mandatory

When an adopted standard profile is selected, applicable adaptive source must
satisfy that standard's semantics before Skillset materializes the standards
projection or claims conformance. Omitted configuration selects every adopted
Agent standard by default.

`compile.agents: false` is the explicit provider-only escape hatch. It removes
all Agent standards projections, standard-specific conformance checks, and
independent standards claims from the build plan. Enabled provider targets
still render from the same Skillset-owned adaptive semantic graph and keep
their native validation, diagnostics, and unsupported-destination behavior.
There is no parallel no-standards source language.

Turning standards compilation off does not give shared source keys a second
meaning. Source that intentionally requires provider-only semantics still
belongs in an explicit provider-native island rather than overloading an
adaptive key.

Skillset may impose narrower rules when required for deterministic generation,
safe paths, or honest cross-client behavior. It must not reuse a standard field
with a different meaning or call a provider-specific behavior portable.

The floor is not the whole adaptive ceiling. Skillset may define portable
semantics above a standard when equivalent destinations and conformance
evidence exist across providers. Those remain explicitly Skillset-owned
portable extensions; they do not silently enlarge the external standard or
make a standards-native package claim coverage it does not have.

When a standard profile is selected, each provider adapter classifies its
relationship to that baseline as one of:

- conforming standard output;
- a standard-permitted extension;
- a provider-native transformation or extension with visible provenance; or
- lossy or unsupported output governed by the existing destination policy.

This is a floor, not a lowest-common-denominator ceiling. Providers can expose
more capability, but the extra capability stays named and testable as a delta.

### Agent Standards Outputs Default On

`compile.agents` uses the standard Skillset boolean-or-object shape. Omitting it
or setting it to `true` enables every adopted Agent standards projection
applicable to the workspace. The expanded default is:

```yaml
compile:
  agents:
    instructions: true
    skills: true
    plugins: true
```

Authors normally omit that block. Boolean `false` values are narrow output
opt-outs. The family-level opt-out is:

```yaml
compile:
  agents: false
  targets:
    - claude
```

That build produces only the selected provider projections. It does not
materialize standalone `AGENTS.md`, Agent Skills, or Agent Plugins output and
does not claim those independent standards projections.

An object keeps the standards family enabled and permits narrow opt-outs.
The three child values are booleans in the initial schema; they do not carry
path overrides or provider options. Omitted child keys inherit `true`:

```yaml
compile:
  agents:
    instructions: false
  targets:
    - claude
```

This example still builds the Agent Skills and Agent Plugins projections. It
is useful when a Claude-focused workspace wants those standard artifacts but
wants durable guidance only as Claude rules. A fully provider-only workspace
uses the simpler family-level `false` form.

`compile.agents.skills` controls a separately addressable standalone Agent
Skills projection. It does not remove skills from an Agent Plugins package;
those components are required by that package profile and are controlled by
`compile.agents.plugins`.

`compile.agents.plugins` controls the standalone Agent Plugins projection,
including its conforming skill and MCP components. It does not control
provider-native plugin bundles.

`compile.agents.instructions` controls standalone `AGENTS.md` output derived
from adaptive `.skillset/rules/**/*.md` source. It does not control Claude
rules, Cursor rules, or another provider's native instruction rendering.
Codex-native global guidance, override files, fallback filenames, and byte
limits are not part of this standard output profile.

Each child setting disables its standards projection and its
projection-specific conformance claim. It does not change adaptive source
meaning, provider validation, or provider output selection. Setting all three
children to `false` normalizes to the same standards plan as
`compile.agents: false`.

`compile.targets` remains provider selection and continues to accept only
provider targets. Standards do not appear in that list. Provider-specific
blocks remain the home for native configuration and opt-outs. This narrowly
amends ADR-0001 by adding a default standard-output axis without redefining its
provider-target axis.

When their profiles are selected, Agent Skills governs skill components
generated from adaptive source wherever they render, including inside Agent
Plugins packages and provider bundles. Island and pass-through files remain
opaque target-native output: they receive no standard validation and mint no
standard claim. Within a provider bundle, governance means classifying each
adaptive-source component against the baseline-relationship categories above;
nonconformance follows the classification test in
[Invalid Standard Components Never Get Written](#invalid-standard-components-never-get-written)
instead of blocking provider output. Agent Instructions likewise governs conforming
`AGENTS.md` files wherever a selected standards projection emits them. When
the family is disabled, provider outputs use their provider contracts and do
not gain an independent standard claim from matching a standard-shaped file.

### Logical Projections Coalesce Into One Physical Artifact

Standards and providers are logical projections, not competing file writers.
When an Agent standard and a provider target resolve to the same destination,
the build graph creates one physical destination plan with ordered provenance:
the adopted standard baseline first, followed by any provider-native delta.
The writer emits the file once, and the lock records the standard profile,
provider target, applied delta, and logical consumers. The physical owner is
deterministic: the standard profile owns a coalesced path whenever it is a
logical consumer; otherwise the sole provider consumer owns it. Ownership
transitions caused by configuration changes are ordinary lock rebuilds and
never delete a path that a remaining consumer still owns.

For example, enabling both `compile.agents.instructions` and the Codex target
does not schedule two writes to the same `AGENTS.md`. It produces one file that
conforms to the Agent Instructions profile and records Codex discovery evidence
as a provider delta. If the standard and provider projections require
incompatible bytes or ownership, planning fails instead of choosing a winner.

The `compile.agents` family selects independent standards projections; it is
not a global filename suppressor. If `compile.agents: false` or
`compile.agents.instructions: false` while Codex remains enabled, Codex may
still require and render its native `AGENTS.md`. The lock records only the
provider projection; a deselected standards projection never produces an
independent standard claim. The same rule applies when a provider bundle natively
contains standard-shaped skills or plugin material.

### Output Topology Is Part of the Contract

The initial standards destinations are fixed conventions, not configurable
path guesses.

| Standards projection | Applicable source | Default output |
| --- | --- | --- |
| Agent Instructions | `.skillset/rules/**/*.md` | root and nested `AGENTS.md` files using the existing directory-scoped instruction mapping |
| Agent Skills | standalone `.skillset/skills/<skill>/` | `.agents/skills/<skill>/` |
| Agent Plugins | each `.skillset/plugins/<plugin>/` | `plugins/<plugin>/agents/` |

`agents` in `plugins/<plugin>/agents/` names the standards-family bundle. It
is a sibling of the existing `claude`, `codex`, and `cursor` provider bundles,
not a provider target. Its package root contains `plugin.json`, optional
`skills/`, optional `mcp.json`, ordinary package support files, and no
provider metadata directory.

The `.agents/skills/` path follows the cross-client Agent Skills convention.
The Agent Skills specification defines the skill directory itself rather than
an installation root, so Skillset pins this repository convention as part of
its own output topology. When Codex also selects `.agents/skills`, the standard
skill supplies the baseline and the Codex renderer may add only its proven
delta, such as `agents/openai.yaml`. A standards-only build does not synthesize
that Codex sidecar.

The initial contract does not add per-standard path overrides. Existing build
scopes apply without a new scope vocabulary: `project` owns Agent Instructions,
`repo` owns standalone Agent Skills, and `plugins` owns Agent Plugins packages.
`--isolated`, build/diff/check, output ownership, stale-file cleanup, atomic
writes, and collision checks apply to the new destinations exactly as they do
to provider outputs. A later path override is an additive output-topology
decision, not an implementation choice left open by this ADR.

The standard plugin bundle participates in the existing shared
`plugins/skillset.lock`. The default plugin repository README lists `agents/`
beside provider bundles. A standards projection does not gain a marketplace,
installation root, or distribution destination merely because the package is
rendered.

### Standards Selection Is Independent of Source Target Toggles

The standards plan is resolved independently from provider target settings.

Provider blocks on a skill, rule, or plugin continue to select and configure
provider renderings. They do not opt portable source out of an enabled
standards projection. In particular:

- `compile.agents.skills` applies to every standalone adaptive skill;
- `compile.agents.plugins` applies to every adaptive plugin and governs the
  standard skills inside that package; and
- `compile.agents.instructions` applies to every adaptive instruction.

The initial source contract has no nested `agents: false` escape hatch. A
workspace uses the three compile settings for standards selection. Source that
is intentionally provider-only belongs in `_claude`, `_codex`, or `_cursor`
rather than in an adaptive source unit with a standards opt-out. This keeps
source meaning independent from output selection and avoids a third meaning
for `agents` in nested source.

### Agent Skills Has a Dedicated Baseline Renderer

The Agent Skills renderer emits the standard field set and then lets provider
renderers add their native deltas.

The standard `SKILL.md` mapping is:

| Agent Skills field | Skillset source |
| --- | --- |
| `name` | resolved skill identity; it must equal the generated parent directory |
| `description` | existing resolved description fallback chain |
| `license` | resolved skill, plugin, or workspace license |
| `compatibility` | a new optional top-level adaptive `compatibility` string; authored only, never derived from `supports` |
| `metadata` | authored string-to-string `metadata`, plus string-valued `generated` and `version` when `compile.skillset.metadata` is enabled |
| `allowed-tools` | explicit `allowed_tools.agents`, serialized in the standard space-separated form |

The standard renderer permits only the standard frontmatter keys above. It
strips Skillset-only source fields and does not pass provider-native fields or
unknown frontmatter through merely because a provider accepts them. Existing
`tools` intent does not lower to the experimental `allowed-tools` field:
provider enforcement and Agent Skills advisory metadata are different
contracts. Authors must opt into the standards field explicitly through
`allowed_tools.agents`. The bare `allowed_tools` value form continues to
address providers only; it never feeds the standard field, and `agents` joins
that map as an output-family member, not a provider target.

The schema adds `compatibility` and the `agents` member of the existing
`allowed_tools` target map. It also tightens standard-output validation so
`metadata` values are strings, `name` and `description` meet their length and
shape constraints, `compatibility` stays within its 1-500 character bound,
names contain no consecutive hyphens, and every name matches its directory.
Violations on valid Skillset source follow the classification test in
[Invalid Standard Components Never Get Written](#invalid-standard-components-never-get-written):
they become `unsupported` results for the affected standards projection, not
build-wide failures. Existing declared resources and files under the skill
directory continue to render inside the skill root, with real-path containment
and output-collision checks.

Plugin-bound skills are rendered through the same baseline renderer under
`plugins/<plugin>/agents/skills/<skill>/`. Agent Plugins discovers only
immediate children of `skills/`, so Skillset rejects a source layout that would
place a second skill below a deeper descendant instead of flattening or
silently hiding it.

### Agent Plugins Is Derived From Existing Plugin Source

Agent Plugins support does not introduce a second authored plugin manifest.
Skillset derives the standard package from the existing plugin source graph.

The generated `plugin.json` contains only the closed Agent Plugins 1.0 schema:

| Agent Plugins field | Skillset source |
| --- | --- |
| `$schema` | fixed `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` |
| `name` | plugin id; a standard-invalid name is never renamed and classifies the package `unsupported` under the classification test |
| `version` | existing resolved plugin version |
| `description` | existing plugin description fallback chain |
| `author` | filtered `{name, email, url}` from plugin metadata, then workspace metadata |
| `homepage`, `repository`, `license`, `keywords` | existing resolved portable metadata when present |
| `extensions` | omitted in the initial profile |

The renderer does not merge `skillset.manifest`, a provider manifest override,
or provider component paths into the standard manifest. Agent Plugins uses
fixed component discovery, so `plugin.json` never declares `skills`, MCP,
hooks, commands, agents, rules, or apps.

A plugin with neither standard skills nor MCP still emits a valid minimal
`plugin.json`. Plugin dependencies and provider-only hooks, plugin agents,
commands, rules, apps, LSP, settings, themes, monitors, and output styles are
excluded from the standard package and reported as uncovered source features;
they do not make the minimal standard package invalid.

The renderer includes the plugin `README.md`, the source-owned `CHANGELOG.md`
(new to generated bundles; provider bundles do not copy it today), the
resolved license file, and neutral companion directories under `assets/`,
`scripts/`, and `src/`. A declared `bin/` is included only when a standard
component references it, such as an MCP command or working directory; an
unreferenced `bin/` is excluded and `plugin-bin` is reported as uncovered so
the package never implies executable behavior no standard client provides. It
does not recursively copy other plugin-root entries. Those files remain package support data: only skills and MCP servers
are Agent Plugins 1.0 components. Provider-native directories and islands
never leak into the standards package.

The initial profile emits no client extension data or reverse-domain extension
directory. An extension becomes renderable only after the registry adopts its
owner, namespace, schema or structural contract, source mapping, and client
evidence. This is a closed initial-scope decision, not permission for the
renderer to invent a private namespace.

### MCP Source Is Normalized, Not Copied

Existing `.skillset/plugins/<plugin>/.mcp.json` and `mcp.source` remain the
single adaptive MCP inputs, and the standard vocabulary becomes their canonical
spelling: `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` placeholders and the `stdio`,
`streamable-http`, and `sse` transport types. Skillset parses the `mcpServers`
map into a typed portable MCP model once; the Agent Plugins renderer emits a
separate root `mcp.json` from it, and provider renderers lower the same model
to each provider's documented native dialect, with those dialect facts pinned
as registry evidence. This replaces the current verbatim copy: provider MCP
bytes change once at this reviewed cutover and are deterministic afterward.
Provider-dialect spellings in source, such as a provider-specific plugin-root
placeholder, fail with a fix-it diagnostic rather than being aliased;
`skillset import` and adopt rewrite them into the canonical vocabulary.

The standard output always contains only `$schema` and `mcpServers`, with
`$schema` fixed to
`https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`. It is omitted when
the plugin has no standard MCP servers.

For migration compatibility, a source entry with `command` and no `type`
normalizes unambiguously to `type: stdio`. A URL entry must declare
`type: streamable-http` or `type: sse`; Skillset does not guess between those
transports, and legacy provider transport spellings fail with the same fix-it
diagnostics as placeholders. The normalizer then enforces the pinned schema
and the snapshot's normative semantic rules, including:

- stdio `command` is one executable token and is either bare or begins with
  `./`; placeholders are not expanded in `command`;
- `args`, `env`, and `cwd` accept only the specified `PLUGIN_ROOT` and
  `PLUGIN_DATA` placeholders, while `env` cannot redefine those reserved
  variables;
- plugin-relative commands and working directories remain inside the
  filesystem-resolved package root, including through symlinks;
- HTTP and SSE URLs are absolute HTTP(S), non-loopback endpoints require
  HTTPS, and headers do not perform placeholder expansion; and
- provider credential, OAuth, and other unknown entry fields never enter the
  standard package. An entry that depends on such fields to operate is
  classified `unsupported` as a whole entry with coverage provenance; the
  renderer does not strip operative fields to force a schema-valid but broken
  server.

Neutral support files referenced by a plugin-relative command or working
directory must be present in the rendered package. A missing or escaping
reference fails before writes. `${PLUGIN_DATA}` creation, persistence,
permissions, process launch, and placeholder expansion at execution time are
client/runtime responsibilities. Skillset validates and packages the declared
contract; it does not claim to install or run it.

### Invalid Standard Components Never Get Written

Skillset is a package author for this purpose, not a permissive client loading
someone else's package. It therefore writes only conforming standard output.

An invalid `plugin.json` prevents that entire standard plugin package.
The classification test is: source that is invalid under the Skillset source
contract, unsafe or escaping paths, and security violations are `failed`
results and block under every policy. Source that is valid under the Skillset
contract but outside a selected standard's envelope - an identifier the
standard rejects, an over-limit field, or content the profile cannot carry -
becomes an `unsupported` or `lossy` result for that standards projection only,
before writes, with an empty renderer-defined output set; provider projections
are unaffected. Under the default `compile.unsupportedDestination: error`, that
result blocks the build. Under `warn` or `skip`, the policy gate preserves the
empty component output set and may continue with the remaining conforming
package plus explicit coverage provenance. `force` cannot waive a pinned
schema, path-containment, or security requirement; it may use only a
renderer-defined conforming transformation and otherwise preserves the empty
output set or failure.

This deliberately differs from client recovery behavior. The Agent Plugins
specification lets a client skip an invalid skill or MCP entry while loading
other components, but that does not authorize Skillset to generate a knowingly
invalid file and claim package conformance.

### Registry, Results, and Locks Name Standards Directly

`agents` never enters `TargetName`, `compile.targets`, provider capability
tables, or distribution selectors.

`@skillset/registry` gains a separate standard-profile registry with stable ids
for Agent Instructions, Agent Skills, and Agent Plugins 1.0. It stores the
canonical source URLs, adoption state, fetched or observed date, content hash,
and local immutable snapshots. Unlike existing provider schema snapshots,
which store summaries, standard snapshots store the full schema bodies needed
for offline output validation; Agent Plugins includes the exact 1.0.0 plugin
and MCP JSON Schemas. The standard-profile registry also owns the expected
support envelope for each profile and feature pair, and adapter conformance
joins `standardProfile` render results against those envelopes, so standards
never enter the feature registry's provider capability tables. Builds validate
against those local snapshots and never fetch schemas or specification text
from the network.

Render Results retain provider `target` as provider identity. The next result
schema adds an optional `standardProfile` id for a standards logical
projection; a projection-specific result has a provider `target` or a
`standardProfile`, never `target: agents`. Standards results use their own
destination vocabulary rather than reusing provider destination names such as
the existing plugin `agents` artifact. A coalesced physical artifact gets
separate logical results that may point to the same output path: one for the
standard baseline and one for the provider delta. Workspace workflow facts
may continue to have neither identity. Readers support the current and next
result schema during the generated-state migration.

Generated lock schema likewise adds:

- `selectedStandards`, separate from provider-only `selectedTargets`;
- pinned standard profile and evidence identities;
- per-item logical consumers for coalesced output;
- standard coverage and excluded source features; and
- a single physical owner for each output path.

The lock never serializes `target: agents`. Standard-only roots identify their
standard profile; shared roots list both logical projections. Generated locks
are rebuilt rather than hand-migrated, while lock readers accept the previous
schema long enough for status, diff, explain, reconcile, and stale-output
cleanup to produce an actionable rebuild path.

### Standard Coverage Is Explicit

A valid standards-native package is not automatically a complete projection of
every Skillset plugin feature. Agent Plugins 1.0 currently standardizes skills
and MCP configuration. Provider-only hooks, agents, commands, rules, apps, and
other companions continue to render only where a provider has a truthful
destination.

The standard renderer must never silently place those components into an
unspecified path or imply full plugin parity. Build results and lock provenance
report the standards-native package's feature coverage. A published
reverse-domain extension may carry additional behavior only when Skillset has
adopted and tested that extension contract; private invention is not portable
by default.

The Agent Instructions profile similarly does not claim that all clients use
Codex's complete discovery and precedence contract. It proves the portable
`AGENTS.md` artifact and scoped instruction meaning. Client-specific discovery
behavior remains registry evidence and a provider or runtime concern.

Provider-native plugin bundles remain first-class outputs during adoption.
Claude output in particular remains native while Claude does not consume the
Agent Plugins package contract. Codex or another provider output may later
reuse a standards-native tree internally, but only after byte-level
conformance, native-extension, and runtime-activation evidence proves that the
change preserves behavior. This ADR does not retire or alias a provider target.

### The Implementation Surface Is Fully Enumerated

The work may land incrementally, but each row below is required before Agent
Plugins moves to `adopted` and joins the omitted-config default.

| Surface | Required change | Completion evidence |
| --- | --- | --- |
| `@skillset/schema` | Add the strict `compile.agents` boolean-or-object contract and its three boolean children; remove the unused root `agents:` placeholder; add skill `compatibility` and `allowed_tools.agents`; version result and lock contracts that gain standard identity. | Generated schemas/examples are current; old root `agents:` fails; all boolean/object/default cases validate. |
| `@skillset/registry` | Add the separate standard-profile registry, immutable AGENTS.md and Agent Skills evidence snapshots, and exact Agent Plugins 1.0.0 specification plus plugin/MCP schema snapshots. | Registry hashes are reproducible, snapshot validation is offline, and a drift command or test reports upstream changes without silently adopting them. |
| Core config/resolution | Resolve adopted standards separately from provider targets; expose typed `AgentStandardsConfig` and `StandardProfileId`; add standards output roots to protected-root, scope, and ownership planning. | No code path adds `agents` to `TargetName`; config and output-root matrix tests pass. |
| Standard renderers | Implement the Agent Instructions baseline, Agent Skills whitelist renderer, Agent Plugins manifest/package renderer, and typed MCP normalizer described above. | Golden files validate against pinned contracts and invalid semantic cases fail before writes. |
| Provider adapters | Refactor Codex instructions and skills to apply native deltas after the standard baseline; lower plugin MCP output from the typed portable model to each provider's documented dialect; leave Claude and Cursor native bundles independent; keep other provider-native plugin bytes stable unless a reviewed conformance fix requires a change. | Before/after provider fixture comparison proves unchanged bytes outside the MCP cutover or records the intentional delta; coalesced files are emitted once. |
| Planner/writer | Represent logical standard and provider consumers separately, merge compatible plans, reject incompatible bytes or ownership, and preserve atomic writes and generated-stale cleanup. | Collision, coalescing, scope, isolated-build, deletion, and deterministic two-root fixtures pass. |
| Results and provenance | Emit standard-profile Render Results, standard coverage, exclusions, pins, and logical consumers in locks; teach status, list, explain, lookup, diff, reconcile, activation-readiness, Workbench diagnostics, and JSON consumers the new result/lock versions. | Human and JSON snapshots explain both a shared `.agents/skills` artifact and an independent `plugins/<plugin>/agents` package without `target: agents`. |
| Import/adopt | Recognize a root Agent Plugins 1.0 `plugin.json`, import its portable metadata, immediate-child skills, MCP model, and recognized neutral support files into canonical Skillset source. | Preview and round-trip fixtures preserve the portable core. Extension namespaces or unmappable extra files block the write with explicit diagnostics; import never silently drops them. |
| Docs and scaffolds | Update tenets, schema contracts, quickstart, target surfaces, features for instructions/skills/plugins/MCP/render results/build scopes/import, generated examples, self-hosted guidance, `skillset new` scaffold naming constraints, and CI scaffold expectations. | Terminology and generated-output checks find no provider-only description of the standards floor or stale `agents:` placeholder. |
| Release/migration | Add a Changeset, release note, generated-output migration guidance, and `compile.agents: false` provider-only escape hatch. | An existing fixture can rebuild to the new defaults; opting out preserves its provider outputs and removes standards claims/output. |
| Adoption evidence | Validate generated packages with the pinned schemas and Agent Skills reference validator, then exercise an isolated generated package in at least one real compatible client without installing globally. | Evidence records package bytes, client/version, observed result, and date; no provider config, trust, publication, or user-level install is mutated. |

The implementation sequence is registry/schema first, then standards planning
and rendering, then result/lock and CLI migration, then import/docs, and finally
the real-client adoption evidence. All three profiles begin `candidate`; each
moves to `adopted` when its required rows pass, and Agent Plugins remains
`candidate` while any required row is incomplete. Explicitly selecting a
standards projection whose profile is not yet `adopted` fails with a named
diagnostic; no candidate profile produces output. The release that marks a
profile `adopted` also makes it part of omitted `compile.agents` defaults;
there is no interval where an unproven candidate silently defaults on, for
any profile.

### Acceptance Matrix

The adoption change is complete only when the following behavior is covered:

- omitted `compile.agents`, `true`, `false`, an empty object, each single-child
  opt-out, and all children `false` normalize exactly as specified;
- explicitly selecting a non-adopted profile fails with a named diagnostic;
- standard selection stays independent from every `compile.targets`
  combination and from provider-level source toggles;
- standalone skills render at `.agents/skills`, plugin skills render as
  immediate children of the standard package `skills/`, and Codex sidecars
  appear only when Codex is a logical consumer;
- root and nested Agent Instructions coalesce with Codex output without a
  duplicate writer, and an instructions opt-out leaves Codex-native output
  intact;
- `plugin.json` covers minimal and metadata-rich packages, rejects unknown
  output fields, and never contains component paths;
- `mcp.json` covers stdio inference, explicit stdio, Streamable HTTP, SSE,
  multiple servers, omitted MCP, invalid/ambiguous transport, provider-dialect
  spelling rejection with import rewriting, provider lowering from the typed
  model, reserved env, placeholders, command tokens, URL rules, missing
  support files, and real-path/symlink escapes;
- Agent Skills covers every standard field, field limit, metadata value type,
  identity/directory match, resources, and provider-delta combination;
- unsupported provider-only components are absent from the standard bundle and
  visible in coverage, while neutral support files do not become false
  component claims;
- `error`, `warn`, `skip`, and `force` never write a nonconforming standard
  artifact and preserve the existing failed-result stop rule;
- current and next Render Result and lock readers give deterministic status,
  diff, explain, list, reconcile, and cleanup behavior during migration;
- standard-only, provider-only, and coalesced builds are deterministic across
  clean roots and pass adapter/standard conformance checks; and
- import round-trips the portable core and fails visibly on extensions or
  unmappable package data.

The focused gates are `bun run schema:check`, `bun run conformance:fast`,
`bun run skillset:check:outputs`, and the relevant package tests. The final
gate is `bun run check`; the isolated real-client probe stays in the external
conformance lane because it tests a consumer rather than deterministic compiler
behavior.

## Consequences

### Positive

- Portable claims gain an externally governed, pinned floor instead of being
  inferred from the current intersection of provider renderers.
- Provider adapters become easier to reason about: each one implements a
  documented delta from a shared semantic baseline.
- Applicable source produces interoperable Agent Instructions, Agent Skills,
  and Agent Plugins projections by default while preserving provider-native
  capabilities.
- Standards and providers can evolve independently without overloading
  `compile.targets` or confusing package shape with runtime support.
- Registry snapshots, deterministic fixtures, locks, and conformance checks
  make adoption and upstream drift reviewable.
- One family-level boolean gives provider-only workspaces an obvious opt-out,
  while the object form keeps partial standards selection available.

### Tradeoffs

- Default builds gain up to three logical Agent standards projections.
  Destination coalescing limits duplicate files but increases planning,
  provenance, and drift-check complexity.
- Skillset must maintain standard-version evidence in addition to provider
  destination evidence.
- A working-draft standard can change. Pinning and explicit adoption updates
  trade immediacy for reproducibility and review.
- The portable package may expose less functionality than a provider-native
  package. Honest coverage reporting becomes part of the product contract.
- Existing generated skills may require conformance fixes or explicit native
  classification when the Agent Skills floor is enforced comprehensively.
- The unused bare root `agents:` placeholder is removed from the workspace
  schema. A config that relied on its structural acceptance will fail rather
  than continue carrying behaviorless configuration.
- Disabling standards compilation reduces portability evidence. Provider
  outputs may still use the same filenames or shapes, but Skillset does not
  report an independent standards projection merely from resemblance.

### Non-Decisions

This ADR does not remove any provider target, claim Claude support for Agent
Plugins, define installation or marketplace behavior, publish generated
output, grant runtime trust, adopt every future public specification
automatically, or standardize features that Agent Plugins 1.0 does not cover.
It does not support Agent Plugins client extensions or configurable standards
output roots in the initial profile; both require a later explicit decision.
Current distribution selectors also remain provider-only; distributing a
standards package requires a later destination contract rather than treating
`agents` as a provider. A provider-less, standards-only build also stays
inexpressible: `compile.targets` keeps requiring at least one provider.
It also does not make Markdown or a standards-native directory the compiler's
intermediate representation; the typed semantic graph remains the internal
boundary.

## References

- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - keeps adaptive source canonical while generated standards and provider trees remain artifacts.
- [ADR-0001: Root Compile Policy](0001-root-compile-policy.md) - amended narrowly: `compile.targets` remains provider selection while adopted standards gain a separate default-output axis.
- [ADR-0003: Lossy and Unsupported Output Policy](0003-lossy-and-unsupported-output-policy.md) - governs provider and standard projections that cannot faithfully represent source.
- [ADR-0005: Feature Reference and Schema Registry](0005-feature-reference-and-schema-registry.md) - provides the typed evidence model and is amended so conforming `AGENTS.md` is a standard baseline rather than Codex-native-only output.
- [ADR-0006: Agent Source Model](0006-agent-source-model.md) - defines project agents as role source, distinct from the Agent standards family introduced here.
- [ADR-0009: Skillset Workspace Layout](0009-skillset-workspace-layout.md) - keeps `.skillset/rules/` as adaptive instruction source and `.skillset/agents/` as project-agent source.
- [ADR-0018: Render Results](0018-render-results.md) - amended so standards projections gain their own identity without entering the provider `target` field.
- [ADR-0019: Deterministic Projection and Adapter Conformance](0019-deterministic-projection-and-adapter-conformance.md) - supplies deterministic and adapter-conformance proof for standards-native output.
- [Skillset Design Tenets](../tenets.md) - governing source-first, provider-truth, derivation, and default-build doctrine.
- [Project Agents](../features/agents.md) - current project-agent source paths, provider renderings, and defaults vocabulary.
- [Workspace config contract](../../packages/schema/src/contracts.ts) - current structural admission of the bare root `agents:` placeholder retired by this decision.
- [AGENTS.md open format](https://agents.md/) - public cross-agent convention for root and nested Markdown instructions.
- [Codex custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md) - provider-native discovery, precedence, overrides, fallback names, and limits layered on the open format.
- [Agent Skills specification](https://agentskills.io/specification) - public component contract for skill directories and `SKILL.md`.
- [Agent Plugins 1.0 specification](https://agent-plugins.org/specification) - working-draft package manifest, skills, MCP, paths, and extension contract.
- [Agent Plugins 1.0 manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) - canonical closed schema pinned for generated `plugin.json`.
- [Agent Plugins 1.0 MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) - canonical transport schema pinned for generated `mcp.json`.
- [Agent Plugins future considerations](https://github.com/agentplugins/agent-plugins-spec/blob/main/FUTURE_CONSIDERATIONS.md) - concerns intentionally outside the 1.0 package contract.
- [Codex Agent Plugins manifest support](https://github.com/openai/codex/commit/a28374e0dbb4119659fb68f8c73de48e01838a5e) - pinned implementation evidence for a current consuming client.
