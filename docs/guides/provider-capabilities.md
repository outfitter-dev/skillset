---
description: Explains provider capability comparisons using structured lookup and the public capability specialist's generated fallback.
---

# Compare Provider Capabilities

Use the public `skillset-provider-capabilities` skill to start from either a desired behavior or an exact native field/concept. It separates semantic intent, canonical source, provider realization, fidelity, evidence limits and the next authoring action. The `skillset` router hands comparison questions to it while setup and maintenance retain their own workflows.

With a CLI that supports the capability subject, query the local catalog:

```bash
skillset lookup capability skill-invocation --compat claude codex --json
skillset lookup capability "AGENTS.md" --json
```

Exact aliases can match multiple concepts. Keep those choices visible until intent is clear. A generated destination, similar field name or successful build does not establish semantic equivalence, activation or model effectiveness.

Without a usable CLI, the specialist reads its [bundled generated reference](../../plugins/skillset/skills/skillset-provider-capabilities/references/provider-capabilities.md). That reference is a projection of the same catalog, not a separately authored support matrix. Its evidence status describes the bundled authority pins, not a live upstream refresh. Unknown, provider-only and unavailable results remain meaningful outcomes. Do not install a CLI solely to answer a comparison or combine evidence from different snapshots without saying so.

Portable eval declarations cover comparison, ambiguity, unknown evidence, no-CLI fallback and routing boundaries. They are ungraded scenarios; validation and packaging do not demonstrate model selection or response quality. Actual provider trials remain separate evidence.

Continue with [capability design](capability-design.md) or [source authoring](../reference/source/README.md) after choosing a justified representation.
