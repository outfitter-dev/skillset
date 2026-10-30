---
skillset:
  preprocess: false
name: skillset-maintain
description: Build, check, inspect, reconcile and repair an established Skillset workspace. Use for generated drift, missing output baseline, source changes, output hand edits and recovery. Not for new repository initialization, adoption/import, machine installation or publication.
resources:
  scripts:
    - plugin:scripts/preflight.sh
    - plugin:scripts/preflight.ps1
  assets:
    - plugin:assets/compatibility.env
  references:
    - plugin:references/capability-design.md
    - plugin:references/commands-and-checks.md
    - plugin:references/import-and-rules.md
    - plugin:references/preflight-and-recovery.md
    - plugin:references/root-guidance-adoption.md
    - plugin:references/source-authoring.md
    - plugin:references/public-handoffs.md
---

# Skillset Maintain

Use this skill for an established Skillset workspace's build, check, inspect, drift, reconciliation and recovery. New repository setup or adoption/import belongs to `skillset-init`; installing the CLI/plugin belongs to the `skillset` router. Missing generated output alone is a first-build condition, not permission to initialize again.

## Start With Observations

Run this skill's own read-only helper from the requested repository: `sh "<skill-directory>/scripts/preflight.sh" "." repo`, or on Windows `& "<skill-directory>/scripts/preflight.ps1" -Root "." -Scope repo`. If shell execution is unavailable, inspect manually; do not bypass policy. Missing, incompatible or unknown CLI status routes to [preflight and recovery](references/preflight-and-recovery.md). The exact compatibility contract qualifies entry previews only; inspect command-specific help before deeper operations.

Use the [ownership and handoff table](references/public-handoffs.md). Preserve existing task authority across handoffs; report a manual fallback honestly if skill invocation is unavailable.

## Establish Ownership and Baseline

Inspect `skillset status --root .` and relevant diagnostics. Use `skillset explain <path> --root .` before changing a managed path. Edit canonical source under `.skillset/` or `skillset.yaml`; in native-root mode edit authored root `AGENTS.md` directly, with no conflicting `.skillset/RULES.md`. [Source authoring](references/source-authoring.md) covers the ownership boundary.

For a first build, or when `check` reports no baseline:

```bash
skillset build --root .
# After reviewing the preview and confirming write authority:
skillset build --yes --root .
skillset check --root .
skillset check --only outputs --root .
```

Bare `build` previews; `check` validates and never creates the missing baseline. If diagnostics or collisions prevent a safe write, resolve them before applying. Preserve unmanaged originals. After changing source, preview again, apply only the approved plan, then repeat the checks. Do not report a nonzero check as clean.

## Inspect and Repair

Use `skillset diff --root .` for pending output and the [commands and checks](references/commands-and-checks.md) reference for the specific repair. Preview `skillset build --repair --root .`; distinguish stale/missing output from hand edits or diverged source. Preserve intentional destination edits through explicit reconciliation; never silently discard them. Resolve authored conflicts before asking `skillset resolve` to repair generated conflicts. Restore only a reviewed backup, then check again.

Stop at the requested maintenance result: report actual source/output changes, checks, unresolved diagnostics and handoff needs. Generated files and a clean check do not prove installation, trust, activation, model effectiveness, or publication. Unbuilt specialist flows use the shared handoff table, not invented tools.
