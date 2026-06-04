---
title: Skillset ADR Authoring
description: Author, update, and manage Skillset ADRs. Use when creating new ADRs, promoting drafts, updating the ADR index, renaming or renumbering ADRs, or when the user mentions ADR, architecture decision, or decision record.
version: 0.1.0
---

# Skillset ADR Authoring

ADRs document the significant design decisions behind Skillset: choices that, if reversed, would change the source contract, target lowering model, compiler promises, or authoring workflow.

## Core Principles

Read `docs/tenets.md` before writing or changing an ADR. Every ADR must be consistent with the tenets, or it must explicitly argue for changing them.

Use these tenets as the review lens:

- **Source-first loadouts.** Authors write portable source once, then Skillset lowers it faithfully to target-native Claude and Codex output.
- **Source is the product.** `.skillset/` is the authored truth; generated Claude/Codex trees are reproducible projections.
- **One meaning, one key.** Portable source keys should describe one semantic concept, not duplicate provider vocabulary.
- **Lower intent, not filenames.** Near matches are modeled from the author's intended outcome, then lowered in the target-native way.
- **Target truth beats fake portability.** Unsupported target behavior must be visible through diagnostics, opt-outs, or explicit target-native escape hatches.
- **Builds do not imply trust.** Build output may define plugins, hooks, skills, and instructions, but activation is separate.
- **Drift should become visible early.** Stale output, unsupported lowering, malformed locks, and unmanaged destinations should fail before runtime surprises.

When an ADR proposes something new, test it against these questions. Does it reduce repeated authoring? Does it preserve target-native truth? Does it make unsupported behavior easier to see? Does it keep activation separate from compilation?

## Before Writing

Read related ADRs before drafting. Use `docs/adrs/decision-map.json` or browse `docs/adrs/` and `docs/adrs/drafts/` to find records that touch similar concerns. Good ADRs build on the existing decision graph: they reference specific sections of prior ADRs, link to their headings, and explain how the new decision compounds with, specializes, or supersedes what is already decided.

When your ADR relates to an existing one:

- Link to it in References with a one-line description of the relationship.
- Link to specific headings when referencing a particular decision.
- Explain whether you are extending, specializing, or building on the prior decision.
- If you contradict a prior ADR, call that out explicitly and use the supersedes mechanism.

## Script

All ADR operations go through the skill-local `scripts/adr.ts` helper when available.

Destructive commands preview by default. Pass `--yes` to apply changes.

```bash
# Create a new draft (applies immediately because it is non-destructive)
bun scripts/adr.ts create --title "Compile Target Selection"

# Preview a promote, then apply
bun scripts/adr.ts promote compile-target-selection
bun scripts/adr.ts promote compile-target-selection --yes

# Update title, slug, status, or number
bun scripts/adr.ts update source-first-loadouts --title "Source-First Loadouts"
bun scripts/adr.ts update 013 --renumber 0013
bun scripts/adr.ts update compile-target-selection --slug compile-targets
bun scripts/adr.ts update compile-targets --status proposed --yes

# Demote a numbered ADR back to drafts
bun scripts/adr.ts demote 0014 --yes

# Auto-fix common issues (number padding, cross-refs)
bun scripts/adr.ts fix
bun scripts/adr.ts fix --yes

# Validate format and consistency
bun scripts/adr.ts check

# Regenerate decision maps and draft index
bun scripts/adr.ts map
```

The script handles file creation, git moves, title/slug/number updates, index rebuilding, decision-map generation for numbered and draft ADRs, and cross-reference updates.

For manual ADR management without the script, see [assets/adr-management.md](assets/adr-management.md).

## Titles

1. MUST use an H1 `#`.
2. MUST lead with `ADR-NNNN` unless in `draft` status, which omits the number.
3. MUST be descriptive enough to recall without opening the file. A good title makes a claim or names the durable decision, not just the topic.
4. Prefer a single clear phrase over `Topic - Explanation` structure. A subtitle is a fallback when the short title cannot stand alone.
5. A project-specific name is fine when the concept is established. A generic noun needs to say what the decision is.

Examples:

- Good: "Source-First Loadouts"
- Good: "Deterministic Target Projections"
- Good: "Compile Target Selection"
- Good: "Unsupported Lowering Must Be Provenanced"
- Avoid: "Targets"
- Avoid: "Config"
- Avoid: "Codex and Claude"

## Locations

- Numbered: `docs/adrs/NNNN-slug.md`
- Drafts: `docs/adrs/drafts/YYYYMMDD-slug.md`
- Index: `docs/adrs/README.md`
- Template: `docs/adrs/template.md`
- Numbered decision map: `docs/adrs/decision-map.json`
- Draft decision map: `docs/adrs/drafts/decision-map.json`
- Tenets: `docs/tenets.md`

## Statuses

| Status | Location | Numbered | Meaning |
| --- | --- | --- | --- |
| `draft` | `docs/adrs/drafts/` | No | Decision proposed, open for discussion |
| `proposed` | `docs/adrs/` | Yes | Decision refined, ready for review |
| `accepted` | `docs/adrs/` | Yes | Decision approved, guides implementation |
| `rejected` | `docs/adrs/` | Yes | Decision considered and declined, with reasoning preserved |
| `superseded` | `docs/adrs/` | Yes | Replaced by a later ADR, with successor linked |

## Frontmatter

```yaml
---
id: NNNN
slug: short-kebab-slug
title: Title in Title Case
status: proposed
created: YYYY-MM-DD
updated: YYYY-MM-DD
owners: ['[galligan](https://github.com/galligan)']
# depends_on: [0, compile-target-selection]
---
```

`depends_on` accepts numbered ADR IDs and draft slugs (the filename without date prefix and `.md`). Use integers for numbered ADRs and slugs for drafts. The decision map renders these as graph edges.

## Content

### Minimal ADR

```markdown
# ADR-NNNN: Descriptive Title

## Context

What problem, tension, or drift prompted the decision.

## Decision

What we chose and why. Include concrete source or output examples when they make the decision clearer.

## Consequences

What this enables, what it constrains, and what remains open.

## References

- [Tenets](../tenets.md) - governing design principles.
```

### Detailed ADR

```markdown
# ADR-NNNN: Descriptive Title

## Context

## Decision

The decision in one declarative sentence.

### Focused Subsection

Use subsections when the reasoning has distinct parts.

## Non-Goals

What this ADR is not trying to solve.

## Consequences

### Positive

What this enables.

### Tradeoffs

Known costs or constraints we accept.

### Risks

Uncertain outcomes we are watching, with mitigation.

## Non-Decisions

Explicitly deferred decisions.

## References
```

## Reference Format

```markdown
For numbered ADRs:
- [ADR-NNNN: Title](NNNN-slug.md) - one-line relationship

For draft ADRs:
- ADR: Title (draft) - one-line relationship

For docs:
- [Doc title](../path.md) - one-line relationship
```

## Style Guide

### Voice

- **Declarative, not tentative.** State the decision. If there is uncertainty, name it as a risk or non-decision.
- **Conversational but precise.** Write like a sharp maintainer explaining what future agents and contributors must preserve.
- **Active voice.** Skillset derives, lowers, validates, rejects, emits, and explains. Authors declare, opt out, and review.
- **First person sparingly.** Use it in Context when grounding the problem in real experience. Drop it in Decision.

### Structure

- **Context tells a story.** Start with the pressure that made the decision necessary, not abstract background.
- **Decision subsections start with a one-sentence thesis.** The first sentence should stand alone as a summary.
- **Show the concrete failure.** Explain what breaks without the decision: duplicated config, silent target skips, fake portability, stale output, or unsafe activation.
- **Code examples are primary evidence.** Source and generated-output snippets often explain the contract better than prose.
- **Claims must be backed up.** Reference code, docs, ADRs, official docs, or live verification. If you cannot back a claim, soften or remove it.

### Patterns To Use

- "This means:" lists after a principle.
- "The test:" heuristics that future agents can apply.
- Good/Bad examples for contract shape.
- Tables for structured tradeoffs.
- Footnotes for external references.
- Heading links for internal cross-references.

### Patterns To Avoid

- No hedging.
- No restating the title.
- No wall-of-text paragraphs.
- No future benefit claims without present justification.
- No "as mentioned above"; link directly.
- No disparaging other tools or agent surfaces.
- No numbered headings; descriptive headings preserve stable markdown anchors.

### Consequences Style

- Positive items are capabilities, not restatements.
- Tradeoffs are honest. Name what we gave up.
- "What this does NOT decide" is useful to future authors. Be specific and explain why it is deferred.

### Vocabulary

Use accepted Skillset vocabulary consistently:

- `source`, not generated output, when discussing `.skillset/`.
- `target` or `provider`, not runtime, when discussing Claude/Codex build destinations.
- `lowering`, not copying, when source intent becomes target-native output.
- `projection`, not source truth, for generated Claude/Codex files.
- `compile.targets`, not bare `targets`, for root provider selection.
- `compile.unsupported`, not silent fallback, for unsupported lowering policy.
- `provenance`, not comments, for lock/doctor evidence.

Read `docs/tenets.md` before writing. Every ADR must be consistent with the tenets.

### Tone Calibration

Read the draft aloud. If it sounds like a corporate design document, rewrite it. If it sounds like a blog post, tighten it. The target is the precision of a spec with the readability of a well-written README: someone who knows the domain deeply explaining the reasoning to someone who will have to live with the consequences.
