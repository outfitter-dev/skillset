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
| [0003](0003-lossy-and-unsupported-output-policy.md) | Lossy and Unsupported Output Policy | Accepted |
| [0004](0004-core-library-boundary.md) | Core Library and CLI Boundary | Accepted |
| [0005](0005-feature-reference-and-schema-registry.md) | Feature Reference and Schema Registry | Accepted |
| [0006](0006-agent-source-model.md) | Agent / Subagent Source Model | Accepted |
| [0007](0007-source-manifest-listing-metadata.md) | Source Manifest Listing Metadata | Accepted |
| [0008](0008-unified-source-layout.md) | Unified Source Layout | Superseded |
| [0009](0009-skillset-workspace-layout.md) | Skillset Workspace Layout | Accepted |
| [0010](0010-named-partials.md) | Named Partials | Accepted |
| [0011](0011-source-test-selection-shape.md) | Source Test Selection Shape | Accepted |
| [0012](0012-fixtures-tests-dogfooding-and-evals.md) | Fixtures, Tests, Dogfooding, and Evals | Accepted |
| [0013](0013-changelog-and-versioning.md) | Changelog and Version Bump Workflow | Superseded |
| [0014](0014-source-change-release-provenance.md) | Source Change, Release, and Dependency Provenance | Accepted |
| [0015](0015-reason-only-change-ledger-derived-state.md) | Reason-Only Change Ledger and Derived State | Accepted |
| [0016](0016-change-release-edge-decisions.md) | Change and Release Edge Decisions | Accepted |
| [0017](0017-lowering-outcomes-and-loss-ledger.md) | Lowering Outcomes and Loss Ledger | Superseded |
| [0018](0018-render-results.md) | Render Results | Accepted |
| [0019](0019-deterministic-projection-and-adapter-conformance.md) | Deterministic Projection and Adapter Conformance | Accepted |
| [0020](0020-portable-skill-tools-policy.md) | Portable Skill Tools Policy | Accepted |
| [0021](0021-post-tools-policy-boundary.md) | Post-Tools Policy Boundary | Accepted |
| [0022](0022-workflow-oriented-cli.md) | Workflow-Oriented CLI With A Flat Loop And Explicit Domains | Accepted |
| [0023](0023-versioned-structured-output-for-cli-automation.md) | Versioned Structured Output For CLI Automation | Accepted |
| [0024](0024-one-action-repo-adoption.md) | One-Action Repo Adoption | Accepted |
