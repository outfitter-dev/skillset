---
skillset:
  preprocess: false
title: Skillset
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

| Intent | Available route | Specialist ownership |
| --- | --- | --- |
| New workspace or existing unmanaged material | Review reuse/provider scope; preview `skillset init --root .`; read [import and rules](references/import-and-rules.md) or [root guidance adoption](references/root-guidance-adoption.md) only as needed. | `skillset-init` is planned, not bundled. |
| Existing workspace health or drift | Start with `skillset status --root .`, `skillset check --root .`, or `skillset diff --root .`; read [commands and checks](references/commands-and-checks.md) for the relevant repair. | `skillset-maintain` and `skillset-help` are planned, not bundled. |
| Author reusable source | Read [source authoring](references/source-authoring.md); edit canonical source and preview output. | Use this bundled reference until specialists ship. |
| Static provider activation information | `skillset lookup activation mcp --compat codex` reports static evidence, not runtime proof. | Detailed claims and tests are in [commands and checks](references/commands-and-checks.md). |
| User-scope distribution, temporary links, settings suggestions, or migration lifecycle | Inventory the requested material and establish the desired scope; verify the actual CLI help before proposing a command. | User sync, link/unlink, settings and migration routes are not qualified here; `skillset-agent-settings` is planned, not bundled. |
| Generic provider settings or disposable one-off | Use the provider's native workflow if it meets the request. | No Skillset workspace needed. |

Read only the reference needed for the selected route. Do not pretend a planned specialist is available. The shared [preflight and recovery](references/preflight-and-recovery.md) reference owns CLI recovery for every route.

## Preserve Authority

Preview before writes. Inspect diagnostics and preserve unmanaged originals. Source edits belong under `.skillset/` or in `skillset.yaml`; use explicit reconciliation for destination edits. Build does not install, enable, trust, or activate provider output. Missing CLI, drift, and a generated plan do not authorize those actions or a package installation.
