---
title: Skillset Provider Capabilities
name: skillset-provider-capabilities
description: Compare provider capabilities, terminology, native fields, semantic equivalents, portability, rendering, relocated output, target overrides, and fidelity loss across Claude, Codex, Cursor, and agent standards. Use for mapping a desired behavior or native field to canonical Skillset source and other targets. Not for routine init, build, check, repair, applying known config, billing, or contributor evidence maintenance.
skillset:
  preprocess: false
---

# Skillset Provider Capabilities

Compare a desired behavior or native field without creating a workspace, reading project files, or activating providers. Keep ordinary setup, build, repair, and applying decided configuration with `use-skillset`.

## Choose Evidence

1. Identify the behavior or exact native term, the targets, and whether the question concerns portable source, generated output, or runtime behavior. Ask for clarification only when it changes the answer.
2. If a known installed CLI is available and shell execution is permitted, check `skillset lookup --help` for capability lookup. Use read-only `skillset lookup capability <id-or-alias> --compat <targets> --json` from a known directory outside any workspace. Pass the concept and known target IDs as literal arguments; never interpolate user text into shell code. Use the bundle if a neutral work directory or safe argument passing is unavailable.
3. Check for `schemaVersion: skillset.cli.result@1`, `ok: true`, `command: lookup`, `data.subject: capability`, and matching rows in `data.capabilities`. If the CLI or its result is unusable, read the relevant sections of the [bundled comparison](references/provider-capabilities.md). Name the evidence source; treat the bundle as a pinned snapshot. Do not mix revisions or install a CLI to answer.
4. Match stable IDs or exact aliases in either direction. Show every candidate when an alias is ambiguous. Report missing, stale, or unreviewed judgments as unknown, not as support or absence.

## Explain The Comparison

- **Intent:** Name the semantic behavior and any unresolved ambiguity.
- **Skillset source:** Give the recorded source shape and contracts, or say there is no established portable representation.
- **Realizations:** For each requested target, describe the recorded native destination and how Skillset renders it. Keep destination support separate from semantic fidelity and standards separate from native behavior.
- **Fidelity and evidence:** Preserve the verdict, scope, relevant limitations, and evidence source. Cite public references or the authority pin; do not send readers to source code, test fixtures, or contributor workflows. A successful build or native metadata does not establish activation, enforcement, or effectiveness.
- **Next action:** Recommend portable source only for the supported intent. Keep an explicit provider override or native form when that is more faithful; do not invent one for an unknown or unavailable result. Carry the chosen representation and limits into the next authorized configuration or review task.
