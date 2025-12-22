# Agent Skills Reference

This directory contains reference documentation for the **Agent Skills** open standard and how various AI coding tools implement it.

## Official Standard

The canonical specification lives at **[agentskills.io](https://agentskills.io/)**:

- [Overview](https://agentskills.io/) — Introduction to Agent Skills
- [Specification](https://agentskills.io/specification) — Full technical spec
- [Integration Guide](https://agentskills.io/integrate-skills) — How to integrate skills into your agent

## What is a Skill?

A skill is a **directory** containing:

| File/Folder | Purpose |
|-------------|---------|
| `SKILL.md` | **Required.** YAML frontmatter + Markdown body defining the skill |
| `scripts/` | Optional executable scripts the skill can invoke |
| `references/` | Optional supporting documentation |
| `assets/` | Optional static files (images, templates, etc.) |

## Progressive Disclosure

Most implementations follow **progressive disclosure** to minimize context usage:

1. **Startup**: Load only `name` + `description` from frontmatter
2. **Activation**: Load full `SKILL.md` body when the agent decides it's relevant
3. **Execution**: Load supporting files (`scripts/`, `references/`) only when referenced

## Integration Patterns

Skills integrate with agents via two patterns:

| Pattern | Description |
|---------|-------------|
| **Filesystem-based** | Model reads skill files directly via shell/file access |
| **Tool-based** | Agent exposes tools that "activate" skills programmatically |

## Documentation Index

| Document | Contents |
|----------|----------|
| [skills-compatibility.md](./skills-compatibility.md) | Adopting tools, compatibility matrix, path conventions |
| [skills-implementations.md](./skills-implementations.md) | Per-product implementation details |
| [skills-invocations.md](./skills-invocations.md) | Invocation methods and activation patterns |

## Adopting Tools

The following products have adopted Agent Skills:

- Claude (claude.ai, API, Claude Code)
- GitHub Copilot
- VS Code (Copilot)
- OpenAI Codex
- Cursor
- Amp
- Letta
- Goose
- OpenCode

See [skills-compatibility.md](./skills-compatibility.md) for the full compatibility matrix.
