---
description: Pinned external-consumer receipt for project-use internal skill markers.
---

# SET-554 Agent Skills Internal Marker Receipt

Recorded 2026-09-16 against `skills@1.5.26`, npm `gitHead`
`d667282815248da03a08a18272b5d2eef9caf77c`.

`bun run conformance:external:skills` creates conventional Agent Skills with
three controls and invokes that exact package through `npx`:

- boolean `metadata.internal: true` is hidden by default;
- string `metadata.internal: "true"` remains visible, proving type sensitivity;
- boolean internal skills become visible when `INSTALL_INTERNAL_SKILLS=1`.

The fixture emits a single receipt line containing the package pin, commit,
and all three observed outcomes. Its temporary source and consumer directories
are removed after the run.
