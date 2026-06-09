# ChatGPT Pro External Review Digest

Date recorded: 2026-06-03

Source provided by the maintainer:
`/path/to/review-response.txt`

Context:

- Review target: the temporary Skillset overview and review prompt generated from the current `skillset` / `agents` work.
- Reviewer stance: external conceptual and target-surface review against Claude Code, Codex, and Agent Skills documentation.
- Purpose of this digest: preserve the dated recommendations in the active packet and turn them into a discussion guide, not accept them blindly as implementation decisions.

## Executive Read

The review strongly supports the core Skillset model:

> Maintain one reviewed, deterministic, portable-ish source graph, then emit target-native artifacts with clear provenance, validation, and drift checks.

It agrees that `skillset` should remain a compiler, validator, importer, and explainer. It should not become a trust manager, marketplace, global installer, permissions broker, or runtime shim in v1.

The main criticism is that a few current names and lowerings could imply more portability or enforcement than the targets actually provide. The reviewer wants a narrower v1 contract with clearer target-native boundaries.

## Highest-Severity Recommendations

### P0: Codex Hook Shape And Path

Recommendation:

- Move Codex plugin hooks to `hooks/hooks.json` by default.
- Use a top-level `{ "hooks": { ... } }` JSON shape.
- Treat root `hooks.json` and root-event maps as compatibility/import aliases only.

Reviewer rationale:

- Codex plugin docs describe `hooks/hooks.json` as the default plugin hook location.
- Codex hook examples use a top-level `hooks` object.
- Manifest path overrides may exist, but using the documented default reduces asymmetry and future drift.

Initial coordinator read:

- Likely right to treat as a near-term correction.
- Need one live-doc verification pass before changing source/output paths because the current compiler deliberately allowed manifest path override.
- This would probably require fixture updates, hook validation changes, generated manifest path changes, and compatibility handling for old source.

### P0: Rename Source `rules` To `instructions`

Recommendation:

- Rename `.skillset/rules/` to `.skillset/instructions/`.
- Keep `.skillset/rules/` as a deprecated alias if needed.
- Reserve future `.skillset/codex/rules/` or similar for actual Codex command permission rules.

Reviewer rationale:

- Claude `.claude/rules/` are project instruction rules.
- Codex `AGENTS.md` is project instruction material.
- Codex "Rules" are a different experimental command-permission `.rules` surface.
- Calling source `.skillset/rules` risks conflating three concepts.

Initial coordinator read:

- Conceptually strong.
- This is probably a product-language decision more than a pure code fix.
- the maintainer likely needs to decide whether the ergonomics of `rules` are worth the ambiguity.
- If accepted, do it soon while the repo is still young.

### P0: Portable Tool Policy Over-Promises

Recommendation:

- Rename portable `tools` to `tool_intent` or `access_intent`.
- Make it explicit that this is intent/metadata unless lowered to a documented target-native enforcement surface.
- Keep Codex `.skillset.tools.yaml` clearly metadata-only, or move that metadata into lock/provenance only.

Reviewer rationale:

- Claude `allowed-tools` pre-approves tools but does not fully restrict all other tools.
- Codex has config/profile/MCP permission mechanisms, but no skill-local `allowed-tools` equivalent.
- A portable `tools` block may imply security enforcement that does not exist.

Initial coordinator read:

- Very likely correct.
- The word "tools" may be too operational.
- The strict registry still seems valuable, but naming and generated placement need discussion.

## P1 Recommendations

### Clarify `skillset.version`

Recommendation:

- Add `skillset.schema: 1`.
- Define `skillset.version` as content/plugin/package version only.
- Store compiler provenance separately as generated metadata and locks.

Initial coordinator read:

- Strongly agree.
- We had already felt this ambiguity.
- We need decide exact names and whether root config gets `skillset.schema` or a top-level `schema`.

### Namespace Generated Skill Metadata

Recommendation:

- Replace generic generated metadata with namespaced keys such as:
  - `metadata.skillset.version`
  - `metadata.skillset.generated_by`

Initial coordinator read:

- Likely right in spirit.
- Need check whether nested maps or dotted metadata keys fit best with Agent Skills / target parsers.
- Current simple `metadata.version` and `metadata.generated` are readable, but collision risk is real.

### Make Skill Source Standard-First

Recommendation:

- Prefer top-level `name` and `description` for skill source identity.
- SET-53 superseded the migration idea: skill source now uses top-level `name`; skill-local `skillset.name` is unsupported.

Initial coordinator read:

- This pushes against the maintainer's earlier preference for `skillset.name`.
- The reviewer argues from Agent Skills and Codex standards.
- Worth discussing carefully: plugin identity may still want `skillset.name`, while skill identity may be better standard-first.

### Expand Claude Plugin Pass-Through Surfaces

Recommendation:

- Add pass-through support for Claude plugin paths beyond current coverage:
  - `.lsp.json`
  - `monitors/`
  - `bin/`
  - `settings.json`
  - `output-styles/`
  - `themes/`

Initial coordinator read:

- Seems like a good additive slice if live docs confirm.
- Keep pass-through only; no schema synthesis in v1.

### Codex Manifest Field Exactness

Recommendation:

- Ensure generated Codex plugin manifests use current target-native casing, especially `interface` camelCase fields such as `displayName`, `shortDescription`, `longDescription`, `defaultPrompt`, and `brandColor`.

Initial coordinator read:

- Already partly implemented, but deserves golden tests against target examples.
- Need audit current `renderCodexInterface`.

### Claude `allowed-tools` Semantics

Recommendation:

- Do not treat Claude `allowed-tools` / `disallowed-tools` as symmetric portable policy.
- Make clear that `allowed-tools` grants no-prompt permission but does not fully restrict all other tools.

Initial coordinator read:

- Strong point.
- Impacts docs and perhaps portable deny lowering.

### Plugin-Bundled Scripts

Recommendation:

- Scripts invoked from skill Markdown should generally be copied into the generated skill `scripts/`.
- Plugin hooks/MCP/commands can reference plugin-root variables.
- Avoid skill Markdown depending on plugin-root paths unless explicitly target-native.

Initial coordinator read:

- Strongly aligned with the shared-resource model.
- Good documentation/testing follow-up.

### Generated `AGENTS.md` Boundaries

Recommendation:

- Add generated source-boundary headings when multiple source instruction files concatenate into one `AGENTS.md`.
- Add size-budget diagnostics against Codex instruction limits.

Initial coordinator read:

- Agree. This would make generated AGENTS files much easier to review.

### Hook Validation Mode

Recommendation:

- Default Codex hook validation to strict.
- Default Claude to shape+warn.
- Optionally support explicit validation modes such as strict / warn / passthrough.

Initial coordinator read:

- Good design shape.
- Current compiler does strict Codex and broad Claude; mode configurability can wait unless users hit a blocker.

## Other Recommendations

P2/P3 themes:

- Define `summary` as UI/catalog text and `description` as routing/invocation text.
- Consider supporting `when_to_use` for Claude and folding equivalent routing text into Codex descriptions.
- Keep explicit shared-resource opt-ins, but add better lint/autofix suggestions.
- Preserve target-native fields during import and produce an import report.
- Keep `.mcp.json` and `.app.json` target-native pass-through with JSON/path sanity checks.
- Keep Claude agents and Codex subagents target-native; do not cross-lower in v1.
- Keep root `.skillset/config.yaml` plus plugin-local `skillset.yaml`; this asymmetry is acceptable.
- Keep `shared:` and `plugin:` canonical; treat `root:` as an alias but do not overemphasize it.
- Keep install/sync separate from build.

## Suggested New Commands

Reviewer suggested:

- `skillset explain <path>`: explain source path, lock entry, lowering decisions, and generated fields for a generated artifact.
- `skillset diff`: show expected generated changes without writing them.
- `skillset doctor`: inspect target assumptions, unmanaged outputs, stale locks, invalid pass-through, missing scripts, executable bits, path casing, ignored plugin dirs.
- `skillset add skill`
- `skillset add plugin`
- `skillset validate --target claude|codex`
- `skillset preview --target codex --skill foo`
- `skillset changes`: changeset-style lock diff report.

Initial coordinator read:

- `explain`, `diff`, and `doctor` feel highest value.
- `add` scaffolds are useful after the v1 contract settles.
- `changes` likely belongs near PAT-52.

## Proposed V1 Shape From Reviewer

Reviewer would narrow v1 to:

- Source root remains `.skillset/`.
- Source project instructions move to `.skillset/instructions/**/*.md`.
- Root config adds `skillset.schema: 1`.
- Skills become standard-first (`name`, `description`, `summary`, `version`, `metadata`) with Skillset extras under `skillset`.
- Target-native overrides use explicit target blocks such as `claude.frontmatter` and `codex.agents_openai`.
- Portable policy becomes `tool_intent`.
- Hooks stay target-native, use `hooks/hooks.json`, and require target-native JSON shape.
- Pass-through surfaces expand, but target-native surfaces are not synthesized.

## Discussion Buckets

Likely accept:

- Keep compiler/product boundary narrow.
- Add `skillset.schema`.
- Tighten Codex hook shape/path after live verification.
- Rename or at least reframe `rules` as project instructions.
- Rename portable tool policy to something intent-like.
- Add Claude plugin pass-through paths.
- Add generated `AGENTS.md` source headers.
- Add import reports.
- Add `explain` / `diff` / `doctor` follow-ups.

Needs the maintainer decision:

- Whether source directory should actually rename from `.skillset/rules` to `.skillset/instructions`.
- Whether skill source should prefer top-level `name` over `skillset.name`.
- Whether generated metadata should use nested maps or dotted namespaced keys.
- Whether Codex `.skillset.tools.yaml` should exist beside generated skills or move into locks only.
- Whether `tool_intent` or `access_intent` is the better term.

Likely defer:

- Global/XDG install/sync.
- Symlink mode.
- Codex `.rules` permission source model.
- Portable hook language.
- Claude agents to Codex subagent lowering.
- Full MCP/app schema synthesis.

Potential disagreements / verify before accepting:

- The review labels Codex hook shape/path as P0. It may be a P1 if manifest hook path overrides are truly supported and stable, but it is still probably worth aligning with the documented default.
- The review recommends top-level skill `name` over `skillset.name`. This conflicts with a prior local preference and may need a split decision: plugin source identity under `skillset.name`, skill source identity standard-first.
- The review recommends `targets:` in one proposed instruction example, but Skillset has an explicit no-`targets:` design rule. If we adopt `.skillset/instructions`, keep top-level `claude` and `codex` toggles unless the maintainer reverses that decision.

## Immediate Follow-Up Candidate Packet

Possible next implementation packet:

1. Live-doc verify Codex plugin hooks path and top-level hook JSON schema.
2. Superseded by SET-53: do not add migration aliases for source root `hooks.json`; use canonical `hooks/hooks.json`.
3. Decide and implement `rules` -> `instructions` naming, or add docs language that source `rules` means "project instructions" and not Codex `.rules`.
4. Add `skillset.schema: 1` validation.
5. Superseded by SET-53: portable tool intent is `tool_intent`; old `tools` is unsupported.
6. Add generated `AGENTS.md` source-boundary headings.
7. Add Claude plugin pass-through paths.
8. Update docs and generated outputs.

## Maintainer Decision Notes

Recorded: 2026-06-03

the maintainer's current decisions from review triage:

- Accept canonical Codex hooks direction: use documented Codex hook defaults
  rather than leaning on a manifest override as the main path.
- Accept the source terminology shift from `rules` toward `instructions`. The
  prior naming already felt uncertain, and avoiding Codex `.rules` confusion is
  worth it.
- Rename portable `tools` to `tool_intent`.
- Add `skillset.schema` as the explicit source schema marker.
- Do not over-nest generated output version metadata under `skillset` if the
  generated skill's own version can stay clear as simple `metadata.version` (or
  equivalent target-appropriate metadata). Compiler/source provenance can remain
  separate from the output artifact's version.
- Revisit `skillset.name`: the maintainer does not see why source would need a machine
  name distinct from the real `name`, especially when directory names already
  identify plugins/skills. This points toward standard-first top-level `name`
  for skills and likely simpler naming semantics for plugins too.
- Keep `targets:` out of the design. Default posture should be: compile for both
  Claude and Codex. A top-level `claude: false` or `codex: false` can opt out at
  any supported level. Root config can set a one-target default, and lower levels
  can opt back in with `claude: true` or `codex: true`.

Implications to consider in the next slice:

- SET-53 superseded the migration-path idea: `.skillset/instructions` and `tool_intent` are the only supported source shapes.
- Need a clear rule for generated metadata: likely keep artifact version as
  `metadata.version`, keep generated-by provenance as `metadata.generated`, and
  put deeper hashes/source paths in `.skillset.lock`.
- Need decide whether plugin `skillset.name` remains only because plugin
  metadata lives under `skillset`, or whether plugin source should also move
  toward a top-level `name` with `skillset` reserved for compiler-specific
  metadata such as `schema`.
