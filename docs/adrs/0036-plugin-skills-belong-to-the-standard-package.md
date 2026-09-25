---
id: 36
slug: plugin-skills-belong-to-the-standard-package
title: Plugin Skills Belong to the Standard Package
status: accepted
created: 2026-09-16
updated: 2026-09-16
owners: ['[galligan](https://github.com/galligan)']
depends_on: [28, 30, 32, 33]
amends: [28, 30, 32]
---

# ADR-0036: Plugin Skills Belong to the Standard Package

## Context

The adopted Agent Skills profile currently gives a plugin-owned skill two
standard placements: the skill is an immediate child of the Agent Plugins
package's `skills/`, and a byte-identical copy appears in repository
`.agents/skills/`. The second copy was useful for local project discovery, but
the decision record treats it as inherent standard output rather than an
explicit project-use choice.

That duplicates bytes and blurs two roles. A plugin skill's portable package is
its distribution boundary. A repository user may also choose the skill for
local discovery, but that selection is consumption of the plugin rather than a
second canonical standard projection.

## Decision

A plugin-owned skill's inherent Agent Skills placement is the Agent Plugins
package, where it renders once as an immediate child of `skills/`. Repository
`.agents/skills/` remains the inherent standard output root for standalone
workspace skills.

A plugin-owned skill appears in repository provider skill directories only as a
project-use copy selected through `plugins.internal_use`. An omitted selection
means none. There is no implicit “all”, and there is no standards opt-out: the
package-contained skill remains the applicable standard projection regardless
of project-use selection or provider toggles.

The lock records one entry for each rendered projection, each with its own path,
hash, and role. The role vocabulary is `standard` for an inherent Agent
Instructions, Agent Skills, or Agent Plugins standards projection,
`project-use` for a selected repository-local copy, and `bundle` for
provider-native package output. Moving a plugin skill's standard placement
changes the role of the existing package projection; it does not create a
second source identity. A separately selected project-use copy has its own
projection entry and role.

When a configured package destination is the repository root, Skillset
preserves an authored `README.md`, `LICENSE`, or `CHANGELOG.md` already present
there and warns instead of replacing it. This is a writer-safety rule, not a
decision about how root placement is configured.

The internal-only hard cutover in ADR-0033 applies. Current-model plans show
ordinary removals. Transition from older generated output belongs in the
internal authoring-model cutover playbook, not an upgrade-only diagnostic,
schema alias, or automatic migration path.

### Superseded statements

This ADR replaces only the placement statements below; the adopted standards
remain inherent:

- `docs/adrs/0028-open-standards-are-the-portability-floor.md`: “Agent Skills |
  standalone `.skillset/skills/<skill>/` | `.agents/skills/<skill>/`.” The row
  remains true for standalone skills; plugin-owned skills are canonical only in
  their Agent Plugins package.
- `docs/adrs/0030-chatgpt-product-bundles-and-standards-only-builds.md`: “As
  amended by ADR-0032, the adopted Agent Skills profile intrinsically renders
  applicable standalone and plugin-owned adaptive skills at
  `.agents/skills/<identity>/`.” Only standalone skills render there
  intrinsically; plugin-owned copies require `plugins.internal_use` selection.
- `docs/adrs/0032-standards-compilation-is-inherent.md`: “Agent Skills |
  portable standalone and plugin-owned skills | repository
  `.agents/skills/<identity>/`.” Standalone skills retain that placement, while
  plugin-owned skills use the package's immediate-child `skills/` placement.

## Consequences

Every applicable plugin skill still renders in standard form exactly once at
its canonical package location. Repository copies now state an explicit local
use decision, so removing a selection can remove that copy without questioning
the package's portable identity. Locks and plans can distinguish package,
standalone, and project-use roles without duplicating source identity.

`standardProjectionSourceInventory()` and the Agent Skills renderer must stop
counting plugin-owned skills as repository standalone projections. SET-553 owns
that implementation and its receipt/golden coverage.

Output placement is a separate decision.
[ADR-0037](0037-one-shared-plugin-package-per-plugin.md) records one shared
package per plugin at `plugins/<plugin>/`; `plugins.output`, the `[name]`
token, and repository-root placement remain with SET-561 and SET-581. This ADR
neither reserves syntax nor chooses destinations.

## References

- [Tenets](../project/tenets.md) - inherent standards, explicit selection, and inspectable provenance.
- [ADR-0028: Open Standards Are the Default Portability Floor](0028-open-standards-are-the-portability-floor.md) - adopted Agent Skills and Agent Plugins profiles amended here.
- [ADR-0030: ChatGPT Product Bundles and Standards-Only Builds](0030-chatgpt-product-bundles-and-standards-only-builds.md) - package and repository ownership amended here.
- [ADR-0032: Standards Compilation Is Inherent](0032-standards-compilation-is-inherent.md) - inherent projection principle retained with a corrected canonical placement.
- [ADR-0033: Workspace Authoring Model](0033-workspace-authoring-model.md) - internal hard-cutover policy and plugin source boundary.
- [ADR-0037: One Shared Plugin Package per Plugin](0037-one-shared-plugin-package-per-plugin.md) - the deferred output placement decision.
- [SET-553](https://linear.app/outfitter/issue/SET-553/standards-placement-for-plugin-vs-standalone-skills) - renderer and provenance implementation owner.
- [SET-561](https://linear.app/outfitter/issue/SET-561/root-destination-and-output-paths-pluginsoutput) - destination-resolution owner.
- [SET-581](https://linear.app/outfitter/issue/SET-581/publish-one-output-package-at-the-repository-root) - root-package writer owner.
- [Internal authoring-model cutover playbook](https://linear.app/outfitter/document/internal-authoring-model-cutover-playbook-08c333c9dde4) - one-time transition procedure.
