# Five-Minute Quickstart

This path starts in an existing repo and creates one standalone skill. It proves
the source-first loop without installing, trusting, symlinking, or changing
Claude or Codex runtime configuration.

Use a fresh source repo instead when the repo exists only to author Skillset
loadouts:

```bash
skillset init my-skillset --yes
cd my-skillset
```

Prefer to inspect a complete tiny source tree first? See the
[First Author Example](../examples/first-author/README.md), which includes one
skill and one instruction rule that build to Claude and Codex.

For an existing content repo, stay in that repo and initialize Skillset:

```bash
skillset init --yes
```

That writes the workspace manifest at `skillset.yaml`, source placeholders under
`.skillset/`, tracked change state under `.skillset/changes/`, ignores the
logical `.skillset/cache/` path, and tracks a snapshot ignore sentinel under
`.skillset/snapshots/`. Cache payloads resolve to Skillset's XDG cache bucket;
the logical `.skillset/cache/` path stays visible for reports and command
output. Recovery snapshots stay repo-local under `.skillset/snapshots/` and
store backup payloads in per-run Git object stores.

## Create One Skill

Create a skill source file:

```bash
skillset new skill "Review Notes" --yes
```

The source lands at:

```text
.skillset/skills/review-notes/SKILL.md
```

Open that file and replace the starter body with the guidance the skill should
carry. A minimal skill looks like this:

```markdown
---
name: review-notes
title: Review Notes
description: Use when summarizing meeting notes into decisions, follow-ups, and risks.
---

# Review Notes

Use this skill when a notes document needs to become a short decision log.

## Workflow

- Identify the concrete decisions.
- Pull out follow-ups with an owner when one is named.
- Keep unresolved risks separate from agreed next steps.
```

The directory name is the stable identity. The top-level `name` may stay aligned
with it; `title` is human-facing skill display text; `description` is the
triggering text that renders into both target skill formats.

## Check And Build

Run the source authoring check:

```bash
skillset check
```

Preview generated output:

```bash
skillset build
```

On a fresh repo, the first build plan should list new generated files such as:

```text
.claude/skills/review-notes/SKILL.md
.agents/skills/review-notes/SKILL.md
skillset.lock
```

Write the generated output:

```bash
skillset build --yes
```

Then verify the generated files are current:

```bash
skillset check --only outputs
```

## Inspect The Output

The default layout writes standalone skill output to:

```text
.claude/skills/review-notes/SKILL.md
.agents/skills/review-notes/SKILL.md
```

Each target skill root also gets a `skillset.lock`, and the repo root gets a
`skillset.lock`. Locks carry source paths, output paths, hashes, version state,
target state, and generated metadata policy. They are review evidence for what
Skillset rendered; the source remains `.skillset/skills/review-notes/`.

Skillset does not make the generated skill live in a user runtime. It writes
repo-local target-native files only. Activation, install, trust, and user-level
Claude or Codex configuration stay separate.

## Useful Next Commands

```bash
skillset diff
skillset dev --watch
skillset explain .skillset/skills/review-notes/SKILL.md
skillset explain .claude/skills/review-notes/SKILL.md
skillset doctor
```

Use `diff` to preview generated changes after editing source, `dev --watch` to
rerun source diagnostics and generated-output previews as you save, `explain` to
see why a source or generated path exists, and `doctor` for a broader local
health summary. The watch loop is read-only by default; use
`skillset dev --watch --apply` when you want each clean refresh to write
repo-local generated output with build ownership, backup, and restore safeguards.
Use `skillset build --yes` when you want a single confirmed write instead.

## Share-Ready Checklist

Before sharing a 0.16-era Skillset source repo with another author, make sure:

- `skillset check` passes for source authoring diagnostics.
- `skillset build` shows the generated-output plan you expect.
- `skillset build --yes` has refreshed the repo-local generated output you expect.
- `skillset check --only outputs` passes so checked-in generated output matches source.
- The generated output locations are visible in review, usually `.claude/`,
  `.agents/`, and `skillset.lock` for the default path.
- Runtime activation is deliberately out of band: do not ask authors to install,
  trust, symlink, or mutate user-level provider config as part of this path.
- Hook-dependent sharing stays deferred to the hook guardrail work. If a repo
  has local Git or runtime hooks, document them separately from the compiler
  quickstart.

## Where To Go Deeper

- [Layout](layout.md) covers the workspace layout, generated roots, and
  operational state.
- [Skills](features/skills.md) covers skill frontmatter, resources, rendering,
  diagnostics, and provenance.
- [Workbench Check](features/workbench.md) explains `check` versus `verify`.
- [Dev Watch](features/dev-watch.md) covers the default-preview watch loop and explicit apply mode.
- [CI](features/ci.md) explains the `skillset check --ci` gate and optional workflow.
