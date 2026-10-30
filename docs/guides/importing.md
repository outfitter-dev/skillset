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

An unmanaged root `AGENTS.md` stays authored source through [native root guidance](../configuration/project-configuration.md). Root `CLAUDE.md` and `.claude/CLAUDE.md` are preserved and reported for guided adoption; they are never native sources or automatic rule imports. If Claude guidance is the better starting point, have an agent compare the documents and synthesize a reviewed `.skillset/RULES.md`. Explicitly reconcile native AGENTS mode before switching to that source, then review the generated `AGENTS.md` and configured Claude front page before replacing originals. The compiler does not judge which document is stronger.

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

## Review what became source

After either workflow:

1. Inspect the new `.skillset/` files and any reported transformations or preserved [target-native islands](../glossary.md#target-native-island).
2. Resolve lint, identity, reference, or [unsupported-destination diagnostics](../configuration/project-configuration.md#handle-unsupported-destinations).
3. Preview the first build with `skillset build`.
4. Confirm it with `skillset build --yes`.
5. Run `skillset check --only outputs` and review the generated diff.

Provider-specific material may remain explicit rather than being forced into a fake portable abstraction. The [support matrix](../reference/support-matrix.md) shows current support, and [ADR-0024](../adrs/0024-one-action-repo-adoption.md) records the adoption rationale for the [workspace](../glossary.md#workspace) workflow.

If import refuses a path or adoption reports a conflict, follow [troubleshooting](../troubleshooting.md) before changing source by hand.

Importing changes repository source only. [Activation](../glossary.md#activation), installation, trust, and user-level provider configuration remain separate workflows.

Adoption transform previews are recognition evidence. A recognized construct does not automatically declare a whole-document dialect or authorize translation of other text in the file. Explicit authored dialect settings remain source decisions.

Repository adoption records recognized ambiguous constructs in imported primary skill bodies as open review findings in `.skillset/adopt/state.json`. Safe Markdown boundaries receive ledger-owned locators; fences, tables, and other unsafe locations keep sidecar records. The isolated build strips validated locators, preserves the authored text, and leaves the original provider files unchanged. A successful import/build can therefore complete with review required. The immutable operation receipt records the finding codes; the workspace ledger retains locations, fingerprints, and evidence. This body classification does not establish migration readiness or complete provider-field and hook analysis.

Raw argument tokens such as `$ARGUMENTS`, indexed forms, and dotted forms are preserved and flagged for review, including escaped text and code examples. Adoption does not turn them into Skillset placeholders based on their spelling or provider directory. Existing explicitly authored `{{$ARGUMENTS}}` syntax remains available under the [preprocessing contract](../reference/source/preprocessing.md); using that syntax requires an author decision about destination behavior, not an inference of equivalent runtime substitution.

Native plugin hook diagnostics distinguish event/handler structure from command semantics. A supported structure produces `import-native-hook-runtime-unverified`, not a claim of lossless adaptation: script behavior, environment variables, and provider payload consumption still require review. Structural incompatibilities retain their specific diagnostics. Explicit import provider selections determine which providers are assessed; otherwise native manifests supply the assessment set. Import preserves the native hook JSON bytes. These diagnostics do not authorize cross-provider execution or establish a build-time provider boundary.

A plugin with an identified Claude-only hook source and no additional hook declarations imports its hook directory into `_claude/hooks/` and records `skillset.preprocess: false` so native JSON stays opaque. Existing explicit preprocessing intent or other authored islands are not changed. Build preserves the emitted `hooks/hooks.json` and companion paths, including scripts that read their own hook config. Cursor receives an explicit empty hook declaration when it has no hook source of its own, preventing its default discovery from loading the Claude file. The portable root manifest gains no hook extension. The import report records this provider scoping with documentation evidence; arbitrary command semantics still require review. Unknown or multiple origins, additional hook declarations, and existing native island collisions are not automatically resolved.

Repository adoption persists native hook diagnostics as sidecar findings in the same ledger transaction as imported Markdown locators. Hook JSON remains byte-for-byte unchanged, and its preimage is checked before and after installation so concurrent edits abort or roll back the transaction. Reports list the finding codes and dispositions, while receipts retain their codes. Malformed hook structures remain visible for review. The ledger records unknown runtime semantics and unsupported structure; it does not grant cross-provider execution support.
