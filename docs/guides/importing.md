---
description: Adopts supported provider-native material into canonical Skillset source without overwriting existing source or changing runtime configuration.
---

# Import Existing Work

Importing turns selected [provider-native](../glossary.md#provider-native) or Agent standards material into reviewable [canonical source](../glossary.md#canonical-source). Choose the workflow by scope: survey a whole repository with `init --adopt`, or import one known skill or plugin with `import`.

## Survey a repository

Use this path when an existing repository may contain several provider directories, skills, plugins, or instruction files.

```bash
skillset init
```

The preview reports setup and adoption candidates. If you do not want to adopt them, a plain confirmed initialization scaffolds Skillset without importing them:

```bash
skillset init --yes
```

If you do want to adopt surveyed material, do not scaffold first. Select a stable candidate id or explicitly choose all candidates, then confirm setup and adoption together:

```bash
skillset init --adopt all --yes
```

Adoption preserves originals, stages imported source under `.skillset/`, validates it, runs an isolated [projection](../glossary.md#projection), and records an audit report. It does not write live provider output. Conflicting identities, versions, portable metadata, or divergent source block instead of being merged by name alone.

Selected skill roots are normalized in private storage before adoption writes source. If two units claim the same destination, their portable frontmatter, body, companion bytes and executable modes must match, and their native fields must be compatible. A mismatch or skill preparation failure blocks initialization and all imports; preview and the receipt retain the conflict. Compatible copies retain the first origin in stable candidate order, with that rationale recorded. This ordering is not evidence that one provider's directory is canonical. Existing authored destinations are compared before writes, and selected input changes invalidate the preflight. This does not promise rollback of later operational failures after imports begin.

Generated copies from an external generator may legitimately differ. A source-file marker alone does not prove their freshness or authorize discarding them. Review those copies and select the intended source explicitly. On versions without preflight conflict detection, avoid `--adopt all` for overlapping roots. Preserve any partially adopted tree, use a clean reviewed checkout, and import the chosen source selectively, for example `skillset import .claude/skills --kind skills --from claude` when repository evidence establishes that directory as authored source. Explicit targeted `import` retains its existing behavior.

An unmanaged root `AGENTS.md` stays authored source through [native root guidance](../configuration/project-configuration.md). Root `CLAUDE.md` and `.claude/CLAUDE.md` are preserved and reported for guided adoption; they are never native sources or automatic rule imports. If Claude guidance is the better starting point, have an agent compare the documents and synthesize a reviewed `.skillset/RULES.md`. Explicitly reconcile native AGENTS mode before switching to that source, then review the generated `AGENTS.md` and configured Claude front page before replacing originals. The compiler does not judge which document is stronger.

A direct Claude manifest `name` or `description` can receive an exact metadata round-trip qualification in the adoption receipt. This requires a current, narrowly scoped capability judgment and identical strings in the selected native input, the canonical graph used by the build, and the actual Claude output. The record identifies the output field, output digest and authority digest without storing metadata values. Name remaps, fallback values, trimming, listing or manifest overrides (even equal-valued overrides), failed builds and unselected output do not qualify. Other providers, fields and runtime behavior remain outside this proof. Direct `import` records source observations only, because it does not perform that isolated build. See [ADR-0048](../adrs/0048-adoption-is-a-reviewable-migration.md) and the [Claude manifest field contract](https://code.claude.com/docs/en/plugins/manifest-reference#fields).

The adoption receipt labels its build as isolated and counts actual writes to the mirror. Its Cutover section lists live unmanaged collisions, including imported skill files, plugin manifests, and marketplace files. `skillset report show <id>` retains that list and the next steps. Review the mirror, preserve or relocate colliding originals after approving their replacements, and then run `skillset build --yes`. A truncated receipt directs you to `skillset diff` for the full live list.

Review the exact route in the generated [`init` reference](../reference/cli/init.md).

## Import one explicit source

Use direct import when you already know the path to one skill, a skill collection, one plugin, or a plugin collection:

```bash
skillset import /path/to/SKILL.md
skillset import /path/to/plugin
```

Direct import writes source immediately; it has no `--yes` preview mode. Skillset stages and writes each imported [source unit](../glossary.md#source-unit) separately and refuses to overwrite an existing source path. During a collection import, an earlier unit can remain written if a later unit fails. If a directory is ambiguous, use `--kind` as documented in the generated [`import` reference](../reference/cli/import.md).

Origin shortcuts are an explicit request to inspect a known local provider or Agent Skills origin:

```bash
skillset import claude
skillset import agents
```

`claude`, `codex`, and `cursor` name providers. `agents` names the Agent Skills standard root at `~/.agents/skills`; it is not a provider. Use shortcuts deliberately. Import does not silently scan user-level origins during ordinary [build](../glossary.md#build) or check operations.

## Preserve imported material

A skill import treats the containing skill directory as the unit, even when the selected path is its `SKILL.md`. Sibling `references/`, `scripts/`, `assets/`, `agents/`, and other sidecars are copied into canonical source with it. Collection imports follow linked skill directories but de-duplicate identical real paths.

Plugin imports accept Skillset source plugins, supported Claude, Codex, or Cursor native plugin directories, and closed Agent Plugins 1.0 packages. Agent Plugins import maps the portable manifest, immediate-child skills, MCP model, and recognized neutral support files back into canonical source; unmappable extensions or extra files block the write rather than disappearing. Native manifests are preserved, and Skillset synthesizes a minimal source `skillset.yaml` when the imported plugin has no source config.

Import preserves recognized source frontmatter, provider-native fields, and unknown fields instead of silently dropping them. Review the report's copied files, inferred source fields, preserved provider-native fields, unsupported fields, warnings, and next checks before building. These categories describe what Skillset understood and what still needs human judgment; they do not claim every preserved field is portable.

When the import explicitly identifies a Claude origin, native skill `allowed-tools`, `disallowed-tools`, and `user-invocable` values are retained under `claude.frontmatter`, alongside the existing native invocation-policy handling. They do not become shared tool or invocation policy for another provider. This applies to standalone skills and skills inside plugins. Conflicting top-level and provider-scoped values block the import before the source unit is installed. An unknown origin keeps its fields verbatim with warnings; it does not establish Claude ownership or cross-provider support.

Structured `metadata` remains valid canonical Skillset source. Import reports each non-string metadata value as `adopt.metadata-standard-incompatible`, with a sidecar JSON Pointer and pinned Agent Skills evidence; repository adoption persists those findings before its isolated build. Agent Skills requires string values, but the finding does not infer provider ownership or claim that every selected provider rejects the value. The renderer evaluates the applicable standard and provider projections. Import does not stringify, remove, or move the metadata into a provider boundary. The local ledger retains field locations and fingerprints; immutable receipts retain finding codes without metadata values. Correcting or removing a value does not silently resolve its existing review record.

## Review what became source

After either workflow:

1. Inspect the new `.skillset/` files and any reported transformations or preserved [target-native islands](../glossary.md#target-native-island).
2. Resolve lint, identity, reference, or [unsupported-destination diagnostics](../configuration/project-configuration.md#handle-unsupported-destinations).
3. Preview the first build with `skillset build`.
4. Confirm it with `skillset build --yes`.
5. Run `skillset check --only outputs` and review the generated diff.

Provider-specific material may remain explicit rather than being forced into a fake portable abstraction. The [support matrix](../reference/support-matrix.md) shows current support, and [ADR-0024](../adrs/0024-one-action-repo-adoption.md) records the adoption rationale for the [workspace](../glossary.md#workspace) workflow.

If import refuses a path or adoption reports a conflict, follow [troubleshooting](../troubleshooting.md) before changing source by hand.

When native plugin import synthesizes source configuration, a lone `LICENSE` is renamed to `LICENSE.txt` in the staged copy; the original stays unchanged, and `native.license-path` records the path conversion with unknown semantic fidelity. The authored notice then supplies plugin and inherited skill output. An existing `LICENSE.txt` needs no rename. Both filename spellings, nonregular notice files, or native license metadata combined with a notice fail before the plugin is claimed: the current canonical precedence would otherwise replace that text with a generated identifier notice. Provide explicit source configuration to choose the intended license behavior. Existing authored `skillset.yaml` remains authoritative, including its license precedence; import does not infer that arbitrary text and an SPDX identifier are equivalent.

Importing changes repository source only. [Activation](../glossary.md#activation), installation, trust, and user-level provider configuration remain separate workflows.

Adoption transform previews are recognition evidence. A recognized construct does not automatically declare a whole-document dialect or authorize translation of other text in the file. Explicit authored dialect settings remain source decisions.

Repository adoption records recognized ambiguous constructs in imported primary skill bodies as open review findings in `.skillset/adopt/state.json`. Safe Markdown boundaries receive ledger-owned locators; fences, tables, and other unsafe locations keep sidecar records. The isolated build strips validated locators, preserves the authored text, and leaves the original provider files unchanged. A successful import/build can therefore complete with review required. The immutable operation receipt records the finding codes; the workspace ledger retains locations, fingerprints, and evidence. This body classification does not establish migration readiness or complete provider-field and hook analysis.

Raw argument tokens such as `$ARGUMENTS`, indexed forms, and dotted forms are preserved and flagged for review, including escaped text and code examples. Adoption does not turn them into Skillset placeholders based on their spelling or provider directory. Existing explicitly authored `{{$ARGUMENTS}}` syntax remains available under the [preprocessing contract](../reference/source/preprocessing.md); using that syntax requires an author decision about destination behavior, not an inference of equivalent runtime substitution.

Plugin skill inspection follows compiler discovery through grouping directories and stops at each primary `SKILL.md`; nested companion examples remain resources. Reports use the effective skill name and include native and unknown fields from every primary skill in their summaries. An import without provider provenance does not invent a Claude-native result.

A shared plugin skill cannot carry conflicting effective invocation policy for providers that recognize `disable-model-invocation`. An absent field means automatic invocation is enabled; a provider-only `true` restriction therefore conflicts with another enabled provider's default. Use separate standalone outputs or explicitly align the shared policy. Provider scoping in source alone cannot isolate behavior inside one shared file.

Native plugin hook diagnostics distinguish event/handler structure from command semantics. A supported structure produces `import-native-hook-runtime-unverified`, not a claim of lossless adaptation: script behavior, environment variables, and provider payload consumption still require review. Structural incompatibilities retain their specific diagnostics. Explicit import provider selections determine which providers are assessed; otherwise native manifests supply the assessment set. Import preserves the native hook JSON bytes. These diagnostics do not authorize cross-provider execution or establish a build-time provider boundary.

A plugin with an identified Claude-only hook source imports its default hook directory into `_claude/hooks/` and records `skillset.preprocess: false` so native JSON stays opaque. Existing explicit preprocessing intent or other authored islands are not changed. Build preserves the emitted `hooks/hooks.json` and companion paths, including scripts that read their own hook config. Cursor receives an explicit empty hook declaration when it has no hook source of its own, preventing its default discovery from loading the Claude file. The portable root manifest gains no hook extension. The import report records this provider scoping with documentation evidence; arbitrary command semantics still require review. Unknown or multiple origins and existing native island collisions are not automatically resolved. When synthesizing source configuration from a sole Claude native manifest, import preserves additional `.json` paths, inline event maps, and mixed arrays in `claude.manifest.hooks`, including their order and repeated references. Referenced files and their containing resource directories move into the Claude island but keep their emitted paths and exact bytes, including Markdown companions; `claude.opaque` records these byte-copy directories explicitly, without changing existing authored document controls. Inline values remain in the manifest. This also works without a default hook file. Missing or escaping paths, managed-path collisions, mixed provider ownership, or incompatible preprocessing intent fail before destination claim. Existing authored canonical source configuration remains authoritative. Overlapping resource directories move once. Root-level declarations and declarations inside managed component trees require explicit source configuration so import cannot relocate the plugin root or its skills. The inventory covers declared hook files and their resource directories; arbitrary command dependencies elsewhere still require review.

Repository adoption persists native hook diagnostics as sidecar findings in the same ledger transaction as imported Markdown locators. Hook JSON remains byte-for-byte unchanged. Inline findings select locations within the preserved original manifest, with one physical-file owner and distinct identities for each inline location. Import reports and ledger findings share the same classifier. Each physical file’s preimage is checked before and after installation so concurrent edits abort or roll back the transaction. Reports list the finding codes and dispositions, while receipts retain their codes. Malformed hook structures remain visible for review. The ledger records unknown runtime semantics and unsupported structure; it does not grant cross-provider execution support.

For a selected native Cursor MCP source, repository adoption inventories a narrow local-script candidate: command exactly `node`, one literal relative `.js` argument with simple filename segments, and no explicit working directory. After a successful isolated render, an original regular file missing from the actual selected package becomes `adopt.mcp-local-candidate-omitted`, an error-severity sidecar finding. Symlink components, missing originals, dynamic arguments and other Node invocation shapes remain `adopt.mcp-local-candidate-unverified` warnings. Other commands and providers are outside this check. A retained file is not proof of runtime working directory or transitive dependency completeness. Failed or unselected projections provide no omission evidence. Originals and MCP declarations stay unchanged; receipts retain finding codes. An operation with blocking findings reports completion with review required, while authoritative lifecycle readiness remains a separate gate. If recording fails after rendering, reports retain the completed build and writes but withhold cutover advice.

When native Claude and Codex manifests explicitly provide the same ordered keyword array and Cursor provides a different valid array, import keeps the agreed array in canonical metadata and listing, and preserves Cursor's exact array under `cursor.manifest.keywords`. Survey and direct import use the same decision, including duplicate provider occurrences. No lists are unioned, reordered or deduplicated. The conversion report identifies the native source field and scoped destination with unknown runtime fidelity; it does not assert equivalent search behavior. All three lists must be present and valid for this boundary. Other keyword disagreements keep the existing conflict diagnostic, and explicit canonical source remains authoritative. This resolves that specific discovery-metadata conflict without promising that the plugin's other metadata, runtime dependencies or selected projections are compatible.
