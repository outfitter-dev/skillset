# Workbench Check

Related feature id: `workflows`

Support vocabulary: [Feature Reference](README.md#feature-reference-vocabulary)

Workbench is Skillset's source and workspace correctness surface. It is the place for checks that help authors make a better Skillset workspace before generated output is written or trusted. The public `skillset check` command is part of the `workflows` feature entry and currently runs the existing authoring diagnostics path; the private `@skillset/workbench` workspace package is the internal implementation layer for richer parser, schema, preset, scope, and rule-id diagnostics as they move toward the CLI.

## Commands

Use `skillset check` for the currently wired source authoring diagnostics:

```bash
skillset check --root .
```

Use `skillset verify` for generated-output freshness:

```bash
skillset verify --root .
```

That split is intentional. `check` answers "does the current authoring diagnostics path find source issues?" `verify` answers "do the generated files on disk still match what this source would build?" Hooks and CI usually run both, with `change check` first when a repo uses pending change entries.

`skillset lint` remains available as the direct lint surface for current source diagnostics. `skillset check` is the Workbench-facing command and currently routes implemented source diagnostics through the existing lint engine. Parser/schema checks, diagnostic scopes, presets, and exact rule-id selection are implemented in the private `@skillset/workbench` workspace package for tests and future CLI integration; they are not yet exposed as `skillset check --preset`, `--scope`, or `--rule` flags.

## Diagnostic Model

Workbench diagnostics have stable fields for severity, rule id, rule level, scope, subject, optional source location, optional help text, and optional fix guidance. Text output is deterministic and JSON-safe diagnostics are available inside the workspace package for tests and future CLI output. They are not yet a published downstream tooling contract.

Scopes are deliberately about the checked surface:

| Scope | Meaning |
| --- | --- |
| `source` | Individual source files such as skills, agents, hooks, configs, and Markdown/frontmatter. |
| `workspace` | Cross-file or workspace-level source contracts. |
| `provider` | Provider capability and adapter compatibility checks for Claude, Codex, and future providers. |
| `resource` | Shared resource declarations, copied files, executable scripts, and resource links. |
| `runtime` | Runtime adapter, harness, distribution, or activation support records. |
| `generated` | Generated-output facts and stale/missing managed output. |
| `release` | Change, release, version, and changelog state. |

Rule levels are `standard` and `strict`. Standard rules should be suitable for ordinary CI and hooks. Strict rules are convention checks and structural proof points that are useful for authors who want a tighter local bar.

## Presets

The Workbench workspace package defines two presets:

| Preset | Contents | Use |
| --- | --- | --- |
| `standard` | Standard-level diagnostics across all Workbench scopes. | Default authoring correctness checks. |
| `strict` | Standard plus strict-level diagnostics across all Workbench scopes. | Local hardening, repo-specific quality gates, and future stricter CI modes. |

Current public CLI selection stays intentionally small; `skillset check` runs the default authoring check path. Preset, scope, and exact rule-id selection exist in the internal Workbench layer so the CLI can expose them later without changing diagnostic shape.

## Parser And Schema Checks

Workbench parser helpers use Bun-backed JSON, YAML, and TOML parsing plus Markdown/frontmatter extraction. Syntax diagnostics carry file and line information where the parser exposes it, and Markdown heading extraction ignores fenced code blocks so body facts stay stable.

Workbench Markdown diagnostics also check code fence nesting inside Markdown-labeled examples. When a fenced Markdown example needs to show another fenced code block, the outer fence must use more backticks than any inner fence. For example, use four backticks around a `markdown`, `md`, `mdx`, or `gfm` snippet that contains triple-backtick examples. The `markdown/code-fence-nesting` rule reports the outer fence and the conflicting inner fence so authors can increment the outer fence length by one backtick beyond the longest inner fence.

Workbench also recognizes template guidance placeholders in skill prose. Prefer `{ Placeholder text }` for new guidance because Markdown previewers do not treat it as a link. `[Placeholder text]` is also accepted for compatibility with existing agent-skill template conventions, and bare bracket placeholders are not treated as file links. Template guidance placeholders are examples for the agent or human reader; Skillset does not expand them. Use `{{this.description}}`, `{{shared:path.md}}`, and other `{{...}}` forms only for Skillset preprocessing. The `markdown/template-placeholder` rule warns about clearly broken placeholders such as `{   }`, `[]`, or an unclosed `{ Placeholder` outside code spans and fenced examples.

Schema checks cover representative source contracts:

- ordinary workspace config files such as `.skillset/skillset.yaml`;
- skill `SKILL.md` frontmatter and required body;
- project-agent Markdown frontmatter and required body;
- hook definition files under `hooks/hooks.json`.

Dedicated root `skillset.yaml` support is loaded and validated by the compiler today. Workbench's current package-level schema helper models the shared root config shape used by ordinary and dedicated workspaces, but it is not a replacement for the compiler. The checks are early, focused diagnostics for source shape mistakes that should be easy to fix before a build.

The public schema reference is generated from `@skillset/schema` and checked by `bun run schema:check`. See [Skillset Schemas](../reference/schemas/README.md) for the current JSON Schema artifacts and maximal examples, and use the [schema contract workflow](../schema-contracts.md) when adding fields. Workbench should consume those contracts instead of maintaining a parallel schema description.

## Resources, Providers, And Runtime

Workbench can consume existing resource lint issues and report them in the `resource` scope. This keeps authoring mistakes such as undeclared shared resource links, plugin-root script dependencies, and non-executable declared scripts visible in the same diagnostic model as parser and schema findings.

Provider and runtime diagnostics consume structured reports from the feature registry, adapter conformance, adapter coverage, and runtime support records. The important boundary is that provider/runtime diagnostics report what Skillset knows; they do not install hooks, trust plugins, execute scripts, or mutate Claude/Codex runtime settings.

## ast-grep Proof Point

Workbench includes a bounded ast-grep adapter proof. It converts caller-provided ast-grep-style matches into Workbench diagnostics and exposes an explicit availability probe for the `ast-grep` binary.

The adapter does not add an ast-grep dependency, does not run searches implicitly, and does not execute project code. That makes ast-grep usable later as an optional structural backend for repo-specific or strict rules without making ordinary `skillset check` depend on a new runtime.

## Fixtures

Checked-in Workbench fixtures live under `fixtures/workbench-clean` and `fixtures/workbench-invalid`.

- `workbench-clean` is a positive source workspace with representative config, agent, hook, skill, and inert scripts. Tests assert declaration and existence checks without executing those scripts.
- `workbench-invalid` intentionally violates source contracts and resource expectations so diagnostics stay deterministic.

These fixtures are internal compiler fixtures, not public source-root `tests.yaml` declarations. Public deterministic build tests belong to `skillset test`; future evals remain a separate, adapter-aware feature.

## Authoring Rules

- Run `skillset check` before `skillset build --yes` when editing source that is covered by current authoring diagnostics.
- Run `skillset verify` after building or when checking whether generated output is stale.
- Run `skillset change check` for pending change-entry coverage.
- Keep generated-output edits out of source truth; use `skillset explain`, `skillset diff`, `skillset restore`, and source suggestions when a generated file was edited directly.
- Treat `strict` rules as opt-in until a repo explicitly chooses them.
- Do not add rule backends that execute source scripts during checks. Workbench may inspect files and parse source, but runtime execution belongs to explicit tests, harnesses, or user-approved hooks.

## Evidence

- Package primitives: `packages/workbench/src/`
- Parser/schema tests: `packages/workbench/src/__tests__/parser.test.ts`, `packages/workbench/src/__tests__/schema.test.ts`
- Resource/runtime/provider tests: `packages/workbench/src/__tests__/resource-runtime.test.ts`, `packages/workbench/src/__tests__/compatibility.test.ts`
- ast-grep proof tests: `packages/workbench/src/__tests__/ast-grep.test.ts`
- Markdown rule tests: `packages/workbench/src/__tests__/markdown.test.ts`
- Fixture tests: `packages/workbench/src/__tests__/fixtures.test.ts`
- CLI command split tests: `apps/skillset/src/__tests__/contract.test.ts`, `apps/skillset/src/__tests__/runtime-hooks.test.ts`
