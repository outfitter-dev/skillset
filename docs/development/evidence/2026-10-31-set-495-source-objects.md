---
description: Accounts for emitted open source object shapes, consumers, preservation and omission findings at the SET-495 audit revisions.
---

# SET-495 Source Object Inventory

The [machine inventory](2026-10-31-set-495-schema-inventory.json) records every emitted `type: object` node whose `additionalProperties` is not false, including typed maps, in the individual schema artifacts at `02559515979024f1fab9cf1a8e1c711185adcbea`. The combined artifact is excluded to avoid counting its embedded copies again. This yields **116 occurrences, 30 structural shapes: 101 open and 15 typed-map occurrences**. Shape IDs identify syntax, not shared semantics: identical weak schemas can have different consumers. Properties introduced only by unconstrained extra members are not separately enumerable.

Source probes ran at parent `8dcd23e5b455645b61a63ad5420ca659a8102b97`; no source schema or source renderer changed between these commits. Project-agent metadata was additionally tested at `02559515`. The [captured results](2026-10-31-set-495-probes.json) retain exact per-result statuses and diagnostics. Neither source preservation on disk nor a generic `transformed` status proves field-level output preservation.

## All emitted candidate families

Paths below refer to repository source at the recorded revision. Repeated occurrences under `source-metadata`, workspace/plugin and frontmatter contracts share a declaration, but applicability still depends on the source unit.

| Shape IDs / family | Declaration and actual consumer | Disposition |
|---|---|---|
| O01: workspace `changes` | `contracts.ts:292`; schema `validate.ts` checks only shape; `apps/skillset/src/change-entries.ts:755–767` reads `reason.minLength` as positive integer, otherwise defaults to 40 | **F4:** wrong-type known value accepted and silently ignored. Local change policy, not provider rendering. Plugin-level `changes` is also accepted, but no plugin policy consumer was found in config/resolver/change command paths; do not assume workspace policy applies there. |
| O01: `defaults` | `config.ts:1651–1717` rejects unknown target/surface names, then merges surface objects into resolved target options | Outer invalid keys are rejected. Nested semantics follow the relevant provider surface below; an open outer declaration is not proof of loss. |
| O01: `distributions` | `config.ts:533–557` validates IDs, object values and `dryRun/from/to` keys; `distribution.ts:72–76` consumes parsed declarations | Runtime validation is stronger than generated object shape. No silent subset drop demonstrated. |
| O01: portable `marketplace` and `presentation` | `contracts.ts:1193,1198`; `render-marketplaces.ts:268–297,564–585`; `source-listing.ts:39–90` | **F2/F3:** marketplace description omitted without field evidence; known presentation alias wrong type ignored with generic migration warning. Additional portable keys need explicit meaning/disposition, not blanket copying into provider formats. |
| O02/O03/O12/O13: root/plugin target blocks and skill selections | `contracts.ts:1720–1805`; `config.ts:1743–1766`; target manifest and feature consumers | Known `enabled/include`, bundle/opaque and retired path constraints validate. Provider `manifest` overrides are merged, and feature-specific controls are consumed by their owners. Arbitrary unknown outer controls are not promised portable output; no claim that all extras are forwarded. Full vocabulary remains provider-specific. |
| O04: marketplaces map | Canonical declaration values are closed source/policy/interface structures; map IDs resolve in marketplace configuration | Typed map, not a free-form entry. Nested contracts remain subject to their own validators. |
| O05/O06: internal-use draft/skill maps | `contracts.ts` internal-use selector schemas; `project-use.ts` resolves declared source identities | Typed map with validated selector values. No arbitrary nested metadata projection. |
| O07: source author/owner | `contracts.ts:1210–1219` validates known name/email/url; `source-author.ts`; `render-result-collector.ts:624–819,1307+` compares actual projected author fields | Open extras can have field-level omission evidence. This is a negative control against assuming every open record loses silently; it does not authorize provider-equivalent meaning for arbitrary keys. |
| O08: portable manifest | `contracts.ts:221–236,1224–1236`; `render-plugin-manifest.ts:52–110`; `render-result-collector.ts:1191–1298` | **F1:** only five declared keys enter omission accounting. `publisher` is accepted and omitted with clean manifest results. Comments intentionally permit extras but do not supply an output disposition. |
| O09/O10: source outputs | `contracts.ts:1896–1907`; `validate.ts:3506–3529`; `config.ts:485–515,1779–1787` | Retired per-provider skill roots reject explicitly. **F7:** legacy `outputs.plugins.<target>` is an active string reader omitted from member validation; a number falls back silently. Other unknown keys have no established output meaning. |
| O01/O11: plugin vs skill `bin`/`mcp` | `resolver.ts:1473–1552` requires and resolves plugin object `source`; skill `loadSkills` retains then `stripSourceFrontmatter` removes source-only selections | Plugin source is validated/loaded; extra object controls are ignored without established meaning. **F8:** skill object selections are admitted and stripped without loading their missing referenced sources or reporting loss. Validate applicability rather than promising an unimplemented feature. |
| O01: tools | `contracts.ts:1700`; `validate.ts:4422–4486` validates known provider blocks and rejects unknown keys | Weak descriptor, stronger runtime validation; not the all-three loss class. |
| O14: adaptive hook attachment maps | `contracts.ts` attachment schema; `adaptive-hook-attachments.ts:152–162` retains attachment overrides | Typed entry map. Match semantics are covered by the next row. |
| O01: adaptive/attachment match objects | `adaptive-hook-effective.ts:30–53` clones values; `render-hooks.ts:120–136,308–320` forwards matcher; classifier `:228–234` can report unsupported | Preserved structurally or classified unavailable. Does not prove arbitrary match keys have runtime meaning. |
| O15/O16: skill frontmatter/metadata | `contracts.ts:364–397,1259–1269`; `render.ts:2035–2043`; `render-agent-skills-standard.ts:119+` | Positive probe preserves `metadata.team` and extra top-level `extra_note` in shared SKILL.md. Known source-only fields are removed deliberately; unsupported standard metadata values receive separate compatibility checks. No universal runtime claim. |
| O17: resource maps | `contracts.ts` resource mapping; resource descriptor/parser and materialization owners | Typed string resource selectors, not an arbitrary object payload. File traversal/containment remains a separate contract. |
| O18/O19: agent target blocks and metadata | Closed top-level agent schema; open metadata; `render.ts:1192–1376` merges provider options into output | **F6:** `metadata.team` preserved in Claude/Cursor agents but omitted from Codex TOML with only generic transformed status. Native target option maps are merged, not equivalent to portable metadata preservation. |
| O19/O20/O21/O11: rule metadata/frontmatter/provider overrides | `contracts.ts:426–447,1273–1277,1939–1951`; `render-rules.ts:307–345` selects paths, description/alwaysApply/globs | **F5:** rule metadata and arbitrary extra frontmatter omitted without field evidence. Derived-rule behavior is retained. Unknown native keys have no automatic cross-provider equivalence. |
| O22/O23/O24/O25: raw hook envelopes/groups/handlers | `contracts.ts:1582–1629`; `hooks.ts:71–165`; `render-hooks.ts:577–642` | Typed event maps plus open known group/handler shapes. Non-Cursor normalized objects are retained; Cursor refuses unknown group/handler controls or collisions. No blanket silent drop shown; native runtime semantics remain separately qualified. |
| O26: hook env maps | Adaptive hook run schema | Typed string values, not unconstrained object members. |
| O27/O28/O29: legacy change entry and evidence | `contracts.ts:545–577,1633–1650`; legacy change readers | Compatibility/durable-input data, separate from provider projection. Extra evidence is not a new output contract. Do not infer runtime source loss from ignored legacy bookkeeping fields. |
| O30: test plugin-skill selections | `contracts.ts:698–700`; test selection/staging by resolved identity | Typed selector map, not open presentation content. |
| O01: CLI result/event data/meta and report payload | `contracts.ts:755–812,823–927,1021–1035`; `report.ts:74` validates report-kind contracts | Four output envelope occurrences excluded from authored-source loss class. Their arbitrary payloads need separate output-contract review if a documented consumer loses data. |

All 30 shape IDs and 116 pointers are accounted for above. This is a finite schema and consumer inventory; arbitrary extension-key semantics and complete provider runtime behavior are expressly not enumerable from these descriptors. Closed objects in migration-state, import-normalization and import-capability-assessment contracts are excluded by the scan predicate; their validators own durable-state/report correctness. The ordinary test/eval, source listing and many hook-run structures are closed, so are also outside this candidate set.

## Source reproductions

Use a temporary workspace and the audited CLI. Set root `skillset: {name: audit, license: none}` and `compile: {targets: [claude]}`. For plugin cases create `.skillset/plugins/tools/skills/helper/SKILL.md` with a valid name/description and body, and `.skillset/plugins/tools/skillset.yaml` with `skillset: {name: tools}`. Run `build --root <fixture> --yes --json`, then `diff --root <fixture> --json`; inspect generated bytes and individual `data.renderResults`. Preserve original source when comparing output.

| Finding | Minimal change to fixture | Recorded observation |
|---|---|---|
| F1 | Plugin `skillset.manifest: {publisher: Outfitter}` | Both manifests omit publisher; rendered outcomes and no diagnostics. |
| F2 | Root `skillset.marketplace: {description: visible-description}` | Generated Claude marketplace uses default description; no field diagnostic. |
| F3 | Plugin `skillset.presentation: {displayName: 42}` | Known alias ignored; only generic compatibility warning. |
| F4 | Root `changes: {reason: {minLength: "2"}}`; check a five-character reason with change status/check | Config accepted; check enforces default 40 instead of supplied value. |
| F5 | `.skillset/rules/review.md` frontmatter `metadata: {team: security}` and `example_extra: important` | Claude rule contains body only; transformed outcome, no field diagnostic. |
| F6 | `.skillset/subagents/review.md` with name/description, `metadata: {team: security}` and body; run once per target | Claude/Cursor retain metadata; Codex omits it, transformed outcome without diagnostic. |
| F7 | Root `skillset.outputs: {plugins: {claude: 42}}` | Accepted, default plugin output path used, no diagnostic. |
| F8 | Skill frontmatter `bin: {source: "repo:example/bin"}` and `mcp: {source: "repo:example/mcp.json"}` with those paths absent | Accepted and stripped, no source-resolution error or loss result. |

Return to the [audit and recommendations](2026-10-31-set-495-open-object-audit.md).
