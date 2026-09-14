---
id: 30
slug: chatgpt-product-bundles-and-standards-only-builds
title: ChatGPT Product Bundles and Standards-Only Builds
status: accepted
created: 2026-09-12
updated: 2026-09-12
owners: ['[galligan](https://github.com/galligan)']
depends_on: [1, 7, 28]
amends: [1, 7, 28]
---

# ADR-0030: ChatGPT Product Bundles and Standards-Only Builds

## Context

ADR-0001 made `compile.targets` the single place where an author selects
provider projections. It required at least one provider because standards-only
output did not exist then. ADR-0028 added adopted open standards as a separate
compile dimension and deliberately kept `agents` out of provider identities,
`TargetName`, and `compile.targets`. It also retained ADR-0001's non-empty
provider rule as a non-decision while the standards foundation was still being
implemented.

That rule is now too broad. An adopted, applicable standard projection can be
a complete and useful build result without a provider target. Requiring a fake
provider would make provenance less truthful and would overload provider
selection with a standards request. Conversely, allowing an empty target list
with no selected usable standard projection would turn a likely configuration
mistake into a successful no-op.

The same work needs a current OpenAI-facing package topology. Agent Plugins
provides the closed portable root manifest and fixed `skills/` and `mcp.json`
components. The released OpenAI consumer adds provider-native interface, app,
and hook behavior through `extensions.com.openai`, and recognizes a marketplace
catalog. The product needs a stable name for that bundle and catalog family.
It does not need a second compiler target: existing source contracts,
selectors, provider blocks, source islands, result identities, and runtime
paths already use `codex`.

The migration has two failure modes that source-first rendering must prevent.
First, a modern root extension could appear to replace a legacy
`.codex-plugin/plugin.json` overlay while silently dropping an authored
`_codex` island or provider-manifest meaning. Second, independent standards
and provider consumers could race to write the same flattened skill or
sidecar, or collapse unrelated source identities merely because their current
bytes happen to match. Neither outcome is a faithful rendering.

## Decision

**ChatGPT names the modern product bundle and catalog; `codex` remains the
canonical compiler target. Standards-only builds are valid only when resolution
leaves at least one eligible adopted standard projection.**

This record amends ADR-0001 only at its non-empty-provider-selection edge,
ADR-0007 only at the OpenAI-facing metadata fallback and absent-author edge,
and ADR-0028 only where those decisions and the resulting packaging,
coalescing, and candidate-evidence rules need to be made executable. The
predecessor bodies and statuses remain unchanged.

### `codex` remains the source and runtime contract

The compiler retains `codex` as the only OpenAI-related target/configuration
identity. This includes the canonical target registry, `compile.targets`
selectors, target-keyed maps, `codex` provider blocks, `_codex` source islands,
`.codex` paths, runtime names, commands, current result identities, and the
existing Codex semantic adapter.

ChatGPT is product terminology only for these generated surfaces:

- the modern plugin bundle at `plugins/<plugin>/chatgpt/`; and
- the marketplace catalog at `.agents/plugins/marketplace.json`.

The modern bundle uses the existing `codex` semantic adapter together with the
Agent Plugins baseline. It does not add a `chatgpt` `TargetName`, selector,
provider-block alias, target-keyed map member, `_chatgpt` island, public
migration window, or second renderer. An explicitly authored filesystem path
is preserved exactly; the compiler must not rewrite a path merely because it
contains the word `codex`.

Any broad public target rename requires a later source-contract decision with
a migration plan, release boundary, and evidence. This ADR creates neither an
alias nor an expiry date for one.

### Standards-only selection is narrow and honest

`compile.targets` remains provider selection. Standards never become a target
value and `agents` never becomes `target: agents`.

An explicit empty list is now valid:

```yaml
compile:
  targets: []
```

only when resolution selects at least one eligible adopted standard projection.
For this rule, eligible means that the projection is applicable to resolved
source, selected by the effective `compile.agents` configuration, and backed
by an adopted profile. The build plan then records the standard profile rather
than inventing a provider identity.

An empty target list with no such projection fails before writes with an
actionable `no-projections` diagnostic. A disabled standards family, a
standards child opt-out that removes every applicable projection, non-applicable
source, or a candidate-only profile does not satisfy the rule. Normal builds
continue to select adopted standards by default and reject explicit candidate
selection for production output.

This is the complete amendment to ADR-0001. Provider selection remains under
`compile.targets`; provider blocks remain the home for provider-native output,
overrides, and opt-outs; non-empty lists retain their existing meaning.

### Modern bundles have one portable core and one native extension

The pure Agent Plugins projection remains
`plugins/<plugin>/agents/`. The ChatGPT product bundle renders at
`plugins/<plugin>/chatgpt/` and has an Agent Plugins root `plugin.json` with
the fixed portable `skills/` and optional `mcp.json` components. The root is a
closed standard manifest. The OpenAI extension cannot redirect, augment, or
duplicate either fixed component.

The ChatGPT root may add one complete `extensions.com.openai` object. It uses
the existing `codex` provider configuration for reviewed native overrides and
derives other supported values from the canonical source graph. A field that
cannot be mapped faithfully is diagnosed with its source path and an
actionable unsupported classification; it is not copied as untyped provider
data. This ADR authorizes the typed `codex` extension/source mappings needed
for the pinned complete native surface owned by SET-529 and SET-531. It does
not add duplicate adaptive fields for meanings already represented by canonical
metadata or the existing typed `codex` provider configuration.

The extension may render only the reviewed provider-native interface, app, and
hook material. It must be generated in the consumer's canonical forms and
validated as closed output. In particular, equivalent supported import forms
normalize to a single generated form, and a permissive client that ignores or
drops malformed fields is not evidence that Skillset may emit them.

When an inline `extensions.com.openai` exists, it replaces the legacy
`.codex-plugin/plugin.json` compatibility overlay. It is never a general
manifest merge. The portable root remains authoritative for identity and fixed
components; the extension is authoritative only for its reviewed native
surface.

### Metadata fallbacks preserve authored truth

The Agent Plugins root `description` and the native
`interface.shortDescription` use the same deployed fallback order:

1. `listing.summary`;
2. `listing.description`;
3. `skillset.description`; and
4. the plugin id.

`interface.longDescription` uses the long-copy order:

1. `listing.description`;
2. `skillset.description`;
3. `listing.summary`; and
4. the plugin id.

Source validation rejects wrong types before fallback. The renderer then uses
the existing trimmed, nonempty `readString` selection for each candidate.
Fixtures cover missing and blank values at every step, and the established
results or lock provenance identifies the selected fallback.

Typed `codex` provider overrides may replace a native interface value after
canonical derivation. They win only for that native interface surface. The
pure Agent Plugins root excludes provider manifest overrides and remains a
portable rendering of canonical metadata.

ADR-0007 permits an author fallback to a maintainer default for source
resolution. This amendment does not turn that permission into invented
ChatGPT-facing identity: `interface.developerName` and other ChatGPT interface
author output derive only from truthful authored metadata or an explicit typed
mapping. When no such value exists, the field is omitted. In particular, the
compiler must not emit a fabricated `Skillset Maintainers` value.

### Catalog identity follows the modern bundle

The ChatGPT catalog is emitted at `.agents/plugins/marketplace.json`. It
describes the modern ChatGPT bundle identity and preserves reviewed native
marketplace source and policy unions through typed mappings. Catalog entries
must retain the documented distinction between a local materialized package
and remote fallback listing metadata. They must not become a second authority
for a package's skills, MCP servers, apps, or hooks.

The marketplace source boundary is closed. The retained legacy/listing mappings
are exactly: entry `name`; typed local, URL Git, Git-subdirectory, and npm
`source` forms; `policy.installation`, `policy.authentication`, and
`policy.products`; `category`; fallback `version`, `description`, `keywords`,
`author`, and `homepage`; legacy flattened `displayName` only as input that
normalizes to `interface.displayName`; and the reviewed nested `interface`
fields. The generated catalog uses the canonical typed forms and the nested
interface form. `skills`, `mcpServers`, `apps`, `hooks`, and every other
flattened or unmapped key are rejected with an actionable diagnostic rather
than copied, ignored, or treated as fallback component authority.

An unknown catalog field, a lossy source-form conversion, a mapping conflict,
or an unresolved policy classification diagnoses before write. Empty product
lists remain a valid explicit native deny-all intent; they are not silently
replaced with omission. Product policy parsing alone does not claim
installation, trust, activation, or end-to-end product enforcement.

This ADR does not ban credential-bearing source URLs. SET-530 verifies the
actual existing source and distribution constraint before applying any stricter
classification, preserves supported native URL semantics when no such
constraint applies, redacts credentials from diagnostics and evidence, and
records the resulting bounded decision. The compiler must not convert or
blanket-reject a supported native URL form based on an assumed policy.

### Legacy native input must map or stop

`.codex-plugin/plugin.json` remains an import and inspection compatibility
input. New generated output uses the modern root manifest, fixed component
layout, and the reviewed inline OpenAI extension.

An authored `_codex/.codex-plugin/plugin.json` island or provider manifest
override is a source boundary, not an overlay to discard. Before writing a
modern bundle, the compiler must either:

1. map supported authored meaning through the explicit `codex` provider
   boundary into the reviewed extension; or
2. diagnose a conflicting, opaque, unmappable, unsafe, or otherwise
   unpreservable capability before any output changes.

Opaque islands preserve their existing no-standard-claim behavior. This rule
does not promote opaque native fields into the portable manifest, copy them
into standard output, or authorize field-by-field general merging. A legacy
island must never silently disappear, and replacement must not silently lose
metadata.

### Standalone and plugin-owned skills have distinct output controls

`compile.agents.skills` controls the repository-scope standalone Agent Skills
projection at `.agents/skills`. When enabled, it includes every adaptive
standalone skill and every plugin-owned adaptive skill, flattening each through
the same Agent Skills baseline, resource, and license renderer at
`.agents/skills/<identity>/`. This repository-scope projection is independent
of plugin-bundle selection and provider toggles, and owns its own standards
claim.

`compile.agents.skills` does not control `skills/` inside an enabled Agent
Plugins package or ChatGPT product bundle. Those package components remain
required by the selected package projection even when the flattened
repository-scope output is opted out. This narrowly amends ADR-0028's
applicable-source behavior for standalone Agent Skills without making a
plugin-owned skill depend on its package bundle being selected.

A flattened standalone skill receives `agents/openai.yaml` only when a proven
logical `codex` provider consumer requires that sidecar. A standards-only
projection does not synthesize it. The sidecar's actual name remains
`agents/openai.yaml`; the product word ChatGPT does not rename the established
Codex-compatible file contract.

The planner assigns one writer to each physical skill tree, resource, license,
and sidecar. Logical consumers from the same resolved source unit may coalesce
when their planned bytes and ownership are compatible. Equal bytes do not make
two different source units interchangeable: cross-source same-identity output
is an identity conflict even when byte-for-byte equal. Any incompatible bytes,
ownership, or source identity fails planning rather than selecting an arbitrary
winner. Locks record one physical owner and all logical consumers, allowing a
remaining consumer to retain a path through safe ownership transitions.

### Skill fidelity comes from declared contracts

Skill body content, declared resources, and declared licenses use the existing
resource pipeline, containment checks, and provenance model. A prose mention
of a path is documentation, not a dependency declaration. Escaping or
unresolved declared package references, missing declared resources, and a
declared capability that the selected projection cannot preserve diagnose as
unsupported or failed according to the existing destination policy; generation
does not omit or rewrite operative meaning to produce a superficially valid
skill.

Unrelated plugin hooks and MCP configuration neither disqualify an otherwise
portable individual skill nor get copied into that skill's standalone output.
They remain plugin-level provider/native or standard-package concerns with
their own coverage and diagnostics.

### Candidate conformance is evidence, never production selection

ADR-0028's adoption rule remains intact: candidate profiles cannot be selected
by the normal production CLI, cannot be omitted-config defaults, and cannot
mint production output, locks, or adoption claims.

One repository-internal conformance route is permitted solely to gather the
evidence needed for a later adoption decision. An opt-in external runner may
invoke the actual production renderer functions with immutable candidate
evidence when all of the following hold:

- it writes only to a fresh, disposable runner-owned directory and refuses the
  source repository, configured output roots, and user runtime roots;
- it does not alter the global registry, expose a public CLI override, alter
  environment selection, or represent the candidate as adopted;
- its receipt names the candidate status and records source/schema hashes,
  generated-artifact hashes, renderer commit, consumer and version, date,
  command, observed behavior, and limitations;
- the exact produced bytes pass the pinned offline schema or reference
  validators and load in isolation through a pinned compatible client, with
  profile-specific observations; and
- a separately reviewed registry change later promotes only the evidenced
  profile, followed by a normal production rerun that compares adopted-default
  output to the vetted bytes.

Containment and negative tests prove that no candidate becomes a normal default
or production selection and that no user settings, production lock, or
registry adoption state changes. This is conformance-only rendering, not a
hidden consumer feature or a production target-selection exception.

## Consequences

### Positive

- Standards-native repositories can produce a useful, honestly identified
  projection without inventing a provider target.
- OpenAI-facing bundles use a closed portable package core and one reviewed
  native extension while preserving the existing `codex` compiler contract.
- Modern bundle and catalog names align with the ChatGPT product surface
  without forcing a broad source-vocabulary migration.
- Locks and planning retain source identity and logical-consumer evidence,
  making shared paths and cleanup reviewable.
- Legacy native authoring either survives through an explicit mapping or fails
  before output changes, rather than disappearing during a topology change.
- Candidate evidence can exercise the real renderer and a real pinned consumer
  without weakening adoption, default-selection, or runtime-authority rules.

### Tradeoffs

- The product uses two names deliberately: `codex` for compiler source and
  runtime semantics, ChatGPT for bundle and catalog presentation. Documentation
  and diagnostics must keep that boundary clear.
- Empty `compile.targets` adds a resolution branch and requires a specific
  diagnostic, fixtures, and result/lock evidence instead of a simple schema
  non-empty check.
- Keeping one physical writer and source-identity conflict detection makes the
  planner and migration locks more detailed, but it avoids nondeterministic
  output ownership.
- Complete native extension rendering is stricter than copying a compatibility
  manifest. Some legacy material will block until it has a reviewed mapping or
  an intentional unsupported classification.
- Candidate conformance requires isolated harnesses, durable receipts, and
  consumer-specific probes. It deliberately cannot be used as a shortcut to
  production output.

## Non-Decisions

This ADR does not rename the `codex` target, alter existing `codex` selectors
or runtime paths, add a `chatgpt` target alias, migrate `_codex` islands, or
create another renderer. It does not make ChatGPT a provider identity in render
results, locks, or `compile.targets`.

It does not replace ADR-0028's standards adoption gates, declare candidate
profiles adopted, make candidates normal build defaults, or make a standard
claim for opaque islands. It does not add configurable output roots or a new
package/source abstraction.

It does not define unreviewed reverse-domain extensions, connector validity,
authorization, trust, installation, activation, hook execution, marketplace
enforcement in every product surface, or publication behavior. Those are
separate provider/runtime or release evidence boundaries. It also does not
allow catalog metadata to redirect package components or turn unrelated
plugin-level hooks or MCP into individual-skill content.

## References

- [ADR-0001: Root Compile Policy](0001-root-compile-policy.md) - amended only to permit an empty provider selection with an eligible adopted standards projection.
- [ADR-0007: Source Manifest Listing Metadata](0007-source-manifest-listing-metadata.md) - amended only for truthful OpenAI-facing metadata fallback and absent-author rendering.
- [ADR-0028: Open Standards Are the Default Portability Floor](0028-open-standards-are-the-portability-floor.md) - amended to preserve the floor while defining its standards-only and modern product-bundle edges.
- [Skillset Design Tenets](../project/tenets.md) - source-first rendering, provider truth, visible unsupported behavior, and explicit runtime authority.
- [Agent Plugins 1.0 manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) - closed portable root-manifest contract.
- [Agent Plugins 1.0 MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) - portable MCP component contract.
- [OpenAI plugin documentation](https://developers.openai.com/plugins/build/plugins) - product-facing provider reference, pinned by the implementation evidence matrix.
- [OpenAI Codex 0.154.0 plugin parser pin](https://github.com/openai/codex/tree/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core-plugins/src) - immutable parser, Agent Plugins adapter, and marketplace behavior evidence.
- Linear: SET-533 - bounded contract for the modern ChatGPT bundle, portable skills, and standards-only build amendment.
