---
skillset:
  preprocess: false
name: skillset-provider-capabilities
description: Explain and compare provider capabilities, native field names, semantic equivalents, portability, target overrides, and fidelity loss across Claude, Codex, Cursor, Agent Skills, Agent Instructions, and Agent Plugins. Use for a desired behavior or native concept that needs a canonical Skillset representation or an honest provider-only, unavailable, or unknown outcome. Not for ordinary init/build/check/repair, machine installation, generic account settings, or contributor evidence maintenance.
resources:
  references:
    - plugin:references/provider-capabilities.md
    - plugin:references/source-authoring.md
    - plugin:references/public-handoffs.md
---

# Skillset Provider Capabilities

Explain the authoring boundary before recommending a representation. A faithful provider-only implementation is a valid result. Do not create a workspace or inspect repository files merely to answer a comparison question.

## Choose Evidence

1. Identify the desired behavior or exact native field/concept, the providers being compared, and whether the user is asking about portable source, generated destinations, activation, or observed effectiveness. Ask for the missing distinction if it changes the answer.
2. When a known installed CLI is available and execution is permitted, inspect `skillset lookup --help` for the capability subject and comparison flags, then use read-only `skillset lookup capability <concept-or-exact-alias> --compat <targets> --json`. Quote aliases as arguments. Require a successful `skillset.cli.result@1` envelope with `command: lookup`, `data.subject: capability`, and the requested targets and capability rows. A version/preflight result alone does not qualify this command. Never install or download tooling just to answer the comparison.
3. If the CLI is absent, unsupported, blocked, or returns unusable data, read only the relevant sections of the bundled [provider capability reference](references/provider-capabilities.md). Name the evidence source as a bundled snapshot. Its `current` evidence status means matching bundled authority pins, not current internet evidence. Do not combine rows from different snapshots silently.
4. Match semantic IDs or exact aliases in either direction. An alias can name multiple concepts; show the choices and resolve intent rather than selecting one arbitrarily. No matching concept, stale evidence, or absent semantic judgment means unknown. Preserve reported provider-only and unavailable outcomes; do not fabricate a fallback or infer equivalence from similar filenames.

## Answer Consistently

Keep the answer focused on the requested concepts and providers:

- **Semantic intent:** the behavior being compared and any unresolved ambiguity.
- **Skillset representation:** the reported canonical source shape and contracts, or that no canonical representation is established. Use [source authoring](references/source-authoring.md) for the authoring workflow; do not invent a field from an alias.
- **Provider realizations:** each target's recorded destination and realization, distinguishing destination support from semantic fidelity.
- **Fidelity and limitations:** retain the reported classification, semantic scope and relevant limitations. Unknown does not mean supported or unsupported. Partial or synthesized output needs its qualification.
- **Evidence:** identify installed-CLI or bundled-snapshot evidence, authority pin/status and available public provider sources. Do not route the user into contributor code or evidence-maintenance workflows.
- **Next action:** recommend portable source only where justified, an explicit provider override or provider-native island where more faithful, or further evidence before authoring. Explain what cannot currently be concluded.

Build output and static capability evidence do not prove provider installation, activation, tool enforcement, or model effectiveness. Actual provider tests need separate authority and evidence.

## Hand Off Without Expanding Authority

Use the [ownership and handoff table](references/public-handoffs.md). Send repository setup/adoption to `skillset-init` and build/check/drift to `skillset-maintain`. Machine installation belongs to the `skillset` router only when requested. Design/config/review specialists are not bundled; use available source guidance and carry the selected concept, targets, fidelity limits and evidence into the user's next authorized task. If another skill cannot be invoked, state the manual handoff honestly.
