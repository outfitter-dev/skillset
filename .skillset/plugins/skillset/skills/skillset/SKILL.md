---
skillset:
  preprocess: false
title: Skillset
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
description: Manage reusable skills, agents, rules, hooks, and plugins across Claude, Codex, and Cursor with the Skillset compiler. Use for skillset.yaml or .skillset/ workspaces, creating or adopting reusable agent artifacts, cross-provider distribution, provider projections, generated drift, builds, checks, and repairs. Consider existing SKILL.md, AGENTS.md, CLAUDE.md, .claude/, .codex/, or .cursor/ artifacts when the task involves reuse or shared source. Not for generic provider configuration alone; direct provider-native authoring may be simpler for a disposable one-off.
version: 0.1.0
name: skillset
---

# Skillset

Use this skill for reusable agent artifacts, existing Skillset workspaces, and shared source across providers. Existing filenames are inspection cues, not permission to adopt them. Resolve reuse and ownership intent before creating a workspace. A disposable one-off can stay provider-native; generic account, model, or editor settings alone do not need Skillset.

## Observe Before Routing

Run the bundled read-only preflight from the requested repository, using this skill's actual installed path:

- POSIX: `sh "<skill-directory>/scripts/preflight.sh" "." repo`
- Windows PowerShell: `& "<skill-directory>/scripts/preflight.ps1" -Root "." -Scope repo`

For an explicit user-scope request, pass `user` instead of `repo`; this records intent and does not scan or change the home directory. The helpers need no compiler or language runtime. If shell execution is unavailable or blocked by policy, inspect workspace markers and command availability manually; report CLI compatibility as unknown and follow [preflight and recovery](references/preflight-and-recovery.md). Do not bypass execution policy.

`compatible` means only the exact version and entry-preview operations in the bundled contract are qualified. Missing, incompatible, or unknown CLI status routes to recovery. Mixed `skillset.yaml` / `.skillset/` evidence needs inspection, not automatic initialization. Artifact presence alone establishes neither ownership nor portability.

## Choose One Route

When choosing what to author, use the [capability-design guide](references/capability-design.md) to select the smallest useful artifact, write a precise description, and assess provider boundaries. The same guide is shared with the init specialist; it does not require creating a new skill or plugin.

Use the shared [ownership and handoff table](references/public-handoffs.md). Choose `skillset-init` for a new repository workspace or reviewed adoption/import, and `skillset-maintain` for build/check/drift/recovery in an established workspace. Transfer the repository path, source ownership, preflight observations, requested outcome, and authorized writes. If the runtime cannot invoke another bundled skill, read that skill's instructions and follow the same ownership boundary; do not claim a tool handoff occurred.

Missing CLI or machine installation stays with this router's [preflight and recovery](references/preflight-and-recovery.md). For authoring, read [source authoring](references/source-authoring.md); for import details, [import and rules](references/import-and-rules.md) and [root guidance adoption](references/root-guidance-adoption.md); for checks, [commands and checks](references/commands-and-checks.md). Design/config/eval/review/audit/publish/help/settings specialists are not bundled. Route to the table's available guidance and report unsupported work honestly.

## Preserve Authority

Preview before writes. Inspect diagnostics and preserve unmanaged originals. Inspect ownership before editing root guidance. Source edits normally belong under `.skillset/` or in `skillset.yaml`; in native-root mode, edit the authored root `AGENTS.md` directly and do not create a conflicting `.skillset/RULES.md`. Use explicit reconciliation for edits to managed destinations. Build does not install, enable, trust, or activate provider output. Missing CLI, drift, and a generated plan do not authorize those actions or a package installation.
