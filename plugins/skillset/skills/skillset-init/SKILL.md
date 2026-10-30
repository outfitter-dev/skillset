---
description: Initialize a repository Skillset workspace or adopt/import existing skills, plugins and root guidance into reviewed source. Use for a new workspace or selected existing material. Not for installing the CLI/plugin on a machine, generic provider settings, or routine build/check/drift in an established workspace.
license: MIT
metadata:
  skillset.schema: "1"
  version: 0.1.1
name: skillset-init
---

# Skillset Init

Use this skill for repository setup and reviewed adoption/import. Installing the CLI or plugin on a machine belongs to the `skillset` router, not repository initialization. If the workspace already exists and the task is build/check/drift, hand to `skillset-maintain`.

## Start With Observations

Run this skill's own read-only helper from the requested repository: `sh "<skill-directory>/scripts/preflight.sh" "." repo`, or on Windows `& "<skill-directory>/scripts/preflight.ps1" -Root "." -Scope repo`. If shell execution is unavailable, inspect manually; do not bypass policy. Missing, incompatible or unknown CLI status routes to [preflight and recovery](references/preflight-and-recovery.md). The exact compatibility contract qualifies entry previews only; inspect command-specific help before deeper operations.

Use the [ownership and handoff table](references/public-handoffs.md). Preserve existing task authority across handoffs; report a manual fallback honestly if skill invocation is unavailable.

## Review Repository Setup

1. Establish the requested repository and reuse/provider intent. Inspect `skillset.yaml`, `.skillset/`, existing skills/plugins and root guidance. One workspace marker alone can mean custom source placement or incomplete setup; inspect it before creating anything. A disposable one-off may stay provider-native.
2. Read the [capability-design guide](references/capability-design.md) before choosing an artifact. Preview `skillset init --root .`; inspect the proposed files and diagnostics. A preview is not setup completion.
3. For existing material, follow [import and rules](references/import-and-rules.md). Select the intended candidates; inspect the command's help and applying plan. Import/adoption requires authorization for those writes and preserves unmanaged originals. An isolated build is review evidence, not live cutover.
4. Inspect authored root `AGENTS.md`, root `CLAUDE.md`, and `.claude/CLAUDE.md`. Native-root mode retains authored `AGENTS.md` as source. Claude files are never native sources; follow [guided root adoption](references/root-guidance-adoption.md) for synthesis and reviewed cutover. Do not create `.skillset/RULES.md` alongside native-root source or choose authority by file size.
5. Apply the reviewed setup/import only within the user's authority, using the command's applying confirmation. Preserve recoverable originals and resolve every unmanaged collision explicitly. Do not install, trust or activate generated provider output.
6. Hand to `skillset-maintain` with the repository root, chosen source, remaining collisions, actual writes and pending first build. Setup/import completion does not establish a live generated baseline or provider runtime success.
