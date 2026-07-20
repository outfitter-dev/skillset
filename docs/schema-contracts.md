# Schema Contracts

Skillset source contracts are schema-first. When a config key, frontmatter key,
or shared source metadata field changes, update the typed contracts before
teaching another surface about the shape.

The source of truth is `packages/schema/src/`:

- `contracts.ts` defines the JSON Schema descriptors, exported vocabularies,
  and generated artifact shape.
- `value-contracts.ts` owns reusable scalar and presentation contracts shared
  by schema validation, Core, and the CLI, including exact semantic versions
  and human-readable lists.
- `validate.ts` defines the shared diagnostics used by compiler, Workbench, and
  CLI-adjacent checks.
- `examples.ts` defines maximal examples that are checked against the same
  contracts before being written to `docs/reference/examples/`.
- `artifacts.ts` and `scripts/schema-artifacts.ts` derive the bundled schemas,
  document-specific schemas, examples, and freshness checks.

Generated JSON Schemas live under `docs/reference/schemas/`; generated examples
live under `docs/reference/examples/`. Do not hand-edit those files. Change the
schema package, run `bun run schema:generate`, inspect the generated diff, and
then verify with `bun run schema:check`.

Schema contract changes are package-facing when they alter `packages/schema/src/**`
or `packages/schema/package.json`, because the CLI, Workbench, and generated
schema references consume that package. Add a `.changeset/*.md` entry for those
branches, and add a Skillset pending change entry when the source contract or
generated-output promise changes for this workspace. Generated files under
`docs/reference/schemas/**` and `docs/reference/examples/**` should travel with
the source change, but the generated diff is review evidence rather than release
intent by itself.

## Adding A Field

Use this checklist for any new source/config/frontmatter field:

1. Confirm the field belongs in the source contract. Read `docs/tenets.md`, then
   check accepted ADRs and `docs/features/README.md` for existing vocabulary.
2. Add the field to `packages/schema/src/contracts.ts`, including any exported
   key list or vocabulary the compiler should share.
3. Add matching validation in `packages/schema/src/validate.ts`. Keep structural
   validation here; leave compiler-only semantics such as source schema support,
   version policy, path resolution, dependency graph checks, and destination
   policy behavior in the compiler.
4. Extend examples or descriptor guard tests in
   `packages/schema/src/__tests__/schema.test.ts`.
5. Route compiler or CLI parsing through `@skillset/schema` instead of creating
   another local structural parser. Translate diagnostics only when preserving a
   better established compiler message.
6. Route Workbench diagnostics through the same shared validator. Workbench may
   add location, scope, severity, and help text, but it should not maintain a
   parallel field list for the same source shape.
7. Regenerate artifacts with `bun run schema:generate` and keep the generated
   schemas/examples in the same commit as the contract change.
8. Add or update the package Changeset and any Skillset pending change entry
   using wording that names the changed field or surface and whether the change
   is compatible, validation-tightening, or generated-output-affecting.
9. Add focused tests for the caller that consumes the field, then run
   `bun run schema:check`, relevant focused tests, `bun run check`, and
   `bun run skillset:check:ci` before handoff.

Provider-specific behavior belongs under explicit provider blocks such as
`claude`, `codex`, and `cursor` unless the field is intentionally portable.
Provider source can preserve native Claude, Codex, or Cursor files, but adaptive
source should use the shared contract so
compiler, Workbench, docs, and generated editor schemas agree.

## Drift Signals

Treat any of these as a contract drift smell:

- a compiler parser has an allowed-key list for a shape already modeled in
  `@skillset/schema`;
- Workbench reports different validity from compiler/build for the same source
  fixture;
- generated schema artifacts pass while a runtime validator rejects the maximal
  example;
- a docs page documents a field that is not present in `contracts.ts`;
- a provider override is added at top level outside a known provider block.

Fix drift by moving the shared structural rule into `@skillset/schema`, then
adapting compiler and Workbench consumers to that shared result.
