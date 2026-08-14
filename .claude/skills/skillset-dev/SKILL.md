---
description: Route work on the Skillset compiler repository through its tenets, accepted ADRs, and focused contributor skills. Use whenever changing or reviewing Skillset source, compiler behavior, schemas, tests, fixtures, generated output, or contributor workflows.
metadata:
  skillset.schema: "1"
  version: 0.1.0
name: skillset-dev
---

# Skillset Development

## Start With Doctrine

1. Read `AGENTS.md` and `docs/project/tenets.md` before changing a contract or generated-output promise.
2. Find the governing accepted decisions in `docs/adrs/README.md` and `docs/adrs/decision-map.json`, then read the relevant ADRs rather than relying on their titles.
3. If implementation and doctrine disagree, change the implementation or make an explicit decision. Do not reconcile the conflict only in tactical documentation.

## Route The Work

Use the narrowest specialist that owns the change:

- **Compiler behavior, rendering, commands, or package placement:** use `skillset-dev-compiler`.
- **Config, frontmatter, source vocabulary, or shared validation:** use `skillset-dev-schema`.
- **Tests, fixtures, conformance, or verification strategy:** use `skillset-dev-testing`.

Use more than one specialist only when the change crosses their ownership boundaries. Keep one semantic owner and let the other specialist supply verification or integration guidance.

For ADR lifecycle work, use `skillset-adrs`, then follow `docs/adrs/README.md` and the repository ADR helper. For provider evidence, read the official provider material before changing a support claim. Dedicated provider, documentation, and release specialists are separate follow-up work; do not invent them inside another skill.

## Preserve The Boundary

- Contributor material may read, invoke, test, and extend the public Skillset product.
- Public `skillset*` artifacts must never route to or depend on `skillset-dev*`, repository internals, fixtures, or release machinery.
- Edit `.skillset/` and `skillset.yaml` as canonical self-hosted source. Rebuild generated `.agents/`, `.claude/`, `.cursor/`, and `plugins/` output; never hand-edit it as source truth.
- Build does not authorize installation, activation, trust, publication, or user-level provider configuration changes.

## Finish The Loop

Implement the smallest complete change, verify it through the owning specialist, rebuild self-hosted output when source changes, inspect the generated diff, and run the repository aggregate gate before handoff.
