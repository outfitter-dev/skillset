---
description: The Workbench contract defines how maintainers add, select, format, verify, and troubleshoot authoring diagnostics.
---

# Workbench Diagnostics Package

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `workflows` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](../../reference/features/README.md#support-vocabulary)

Workbench is Skillset's private authoring-diagnostics package. The public [`skillset check`](../../reference/cli/check.md) workflow combines compiler source checks and [generated-output](../../glossary.md#generated-output) readiness, but it does not import `@skillset/workbench`. The package currently supplies internal/test parser, source-contract, Markdown, compatibility, resource, preset, and diagnostic primitives; `scripts/docs/check.ts` consumes its Markdown parser explicitly. Its exports are not a published downstream tooling contract.

## Ownership and Inputs

| Module | Responsibility |
| --- | --- |
| `parser.ts` | JSON, YAML, TOML, Markdown/frontmatter, and unknown-file parsing |
| `schema.ts` | Focused source-contract diagnostics routed through shared schema validation |
| `markdown.ts` | Code-fence and template-placeholder diagnostics |
| `compatibility.ts` | Feature-registry and adapter conformance/coverage diagnostics |
| `resource-runtime.ts` | Resource lint and runtime-support diagnostic bridges |
| `lint-bridge.ts` | Core lint-diagnostic conversion |
| `presets.ts` | Preset, scope, level, and exact-rule selection |
| `diagnostics.ts` and `types.ts` | Stable internal diagnostic shape, sorting, formatting, and summaries |

Inputs are caller-provided source text, shared schema validation results, Core lint/resource reports, registry/conformance reports, runtime-support records, or explicit ast-grep-style matches. Workbench inspects and parses; it does not execute source scripts or project code.

Authored source mutations remain outside Workbench. Bun YAML parsing is read-only here; Core's YAML document writer owns comment- and order-preserving source edits under [ADR 0026](../../adrs/0026-yaml-formatting-and-bun-native-apis.md).

## Diagnostics

A Workbench diagnostic records severity, rule id, optional rule level, scope, subject, optional source location, help, fix guidance, and feature id. Results are sorted deterministically and summarized into error, warning, and info counts plus `ok`.

Scopes are `source`, [`workspace`](../../glossary.md#workspace), `provider`, `resource`, `runtime`, `generated`, and `release`. Rule levels are `standard` and `strict`. The `standard` preset selects standard rules across all scopes; `strict` selects both levels across all scopes. An explicit rule-id selection bypasses the preset's level filter but still respects selected scopes.

These selectors are internal package primitives. Do not document or accept public `skillset check --preset`, `--scope`, or `--rule` flags until the CLI registry and command implementation expose them.

## Outputs and Consumers

Workbench returns deterministic in-memory diagnostics and summaries. `scripts/docs/check.ts` uses its Markdown parser, and compiler/CLI checks can bridge owned diagnostic sources into the common shape. Public text and JSON presentation remain command-owned.

Checked-in fixtures under `fixtures/workbench-clean` and `fixtures/workbench-invalid` prove source declaration, parser, schema, resource, and deterministic diagnostic behavior. They are compiler fixtures, not public `tests.yaml` declarations.

## Adding or Changing a Rule

1. Put validation in the canonical schema or compiler owner when the rule expresses an existing source contract; adapt its diagnostic rather than duplicating field lists.
2. Use Workbench for authoring analysis, compatibility views, parser diagnostics, or optional structural proof that has no stronger owner.
3. Assign one stable rule id, scope, severity, subject, and standard/strict level.
4. Keep fixes advisory or manual; Workbench primitives do not mutate source.
5. Add focused positive, negative, location, sorting, selection, and fixture coverage as applicable.

```bash
bun run test:focused -- packages/workbench/src/__tests__
bun run schema:check
bun run docs:check
```

Run the public aggregate when CLI integration changes:

```bash
bun run check
```

## Troubleshooting

- If Workbench and compiler validation disagree, treat `@skillset/schema` or the compiler owner as canonical and remove the parallel Workbench rule.
- If a diagnostic changes order between runs, inspect its comparison keys and normalized subject/location fields; presentation must not repair nondeterminism.
- If a strict diagnostic appears in the standard preset, verify its `ruleLevel` and the exact-rule selection path.
- If a Markdown finding points inside code spans or fenced examples, fix the masking/parser boundary before broadening an allowlist.
- If an optional backend is unavailable, report availability or omit its findings. Ordinary checks must not acquire a new runtime implicitly.

## Evidence and Decisions

- `packages/workbench/src/index.ts` defines the package surface; the adjacent modules own each diagnostic stage.
- `packages/workbench/src/__tests__/{parser,schema,markdown,presets,diagnostics,compatibility,resource-runtime,lint-bridge,fixtures,ast-grep}.test.ts` proves the focused contracts.
- [Schema Contracts](../schema-contracts.md) defines shared schema ownership and regeneration.
- [Package Ownership](../package-ownership.md) places authoring diagnostics in Workbench and [render](../../glossary.md#render) semantics in Core.
- [Skillset Schemas](../../reference/schemas/README.md) is the generated public schema [projection](../../glossary.md#projection).
