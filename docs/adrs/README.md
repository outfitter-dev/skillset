# Architecture Decision Records

ADRs document the significant design decisions behind Skillset: choices that, if reversed, would change the source contract, target rendering model, compiler promises, or authoring workflow. They capture the context, the decision, the consequences, and the alternatives considered.

## Conventions

- Numbered ADRs live at `docs/adrs/NNNN-slug.md`.
- Draft ADRs live at `docs/adrs/drafts/YYYYMMDD-slug.md`.
- New ADRs should start from [template.md](template.md).
- Owners use `['[galligan](https://github.com/galligan)']` until a decision changes repository ownership metadata.
- Use `bun scripts/adr.ts check` before handoff and `bun scripts/adr.ts map` after ADR lifecycle changes.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0000](0000-source-first-loadouts.md) | Source-First Loadouts | Accepted |
| [0001](0001-root-compile-policy.md) | Root Compile Policy | Accepted |
| [0002](0002-cursor-is-a-first-class-provider.md) | Cursor Is a First-Class Provider | Accepted |
