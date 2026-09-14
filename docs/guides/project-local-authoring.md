---
description: Author skills, instructions, and project agents for working inside a repository without creating a plugin.
---

# Configure Agents for Working in a Project

A project can use Skillset only for its own development instructions, skills, and agent roles. A plugin manifest, marketplace, or distributable bundle is not required. Keep root `skillset.yaml` beside `.skillset/`, author the source families you need, and build the project-local destinations.

## Start with local source

```text
skillset.yaml
.skillset/
  rules/
    project.md
  skills/
    review-change/
      SKILL.md
  agents/
    reviewer.md
```

For example, root `skillset.yaml` can contain only workspace identity:

```yaml
skillset:
  name: my-project
```

Omitting `compile.targets` enables Claude, Codex, and Cursor. Applicable Agent Instructions, Agent Skills, and Agent Plugins standards are inherent: no `compile.agents` setting or replacement `agents` switch is needed or accepted. A workspace without plugin source does not need a plugin package merely to use local skills or instructions.

Create source with the ordinary authoring commands:

```bash
skillset init --yes
skillset new skill review-change --yes
skillset new instruction project --yes
skillset new agent reviewer --scope repo --yes
```

Edit the generated source scaffold before building. Put durable project guidance in `.skillset/rules/project.md`, the review workflow in `.skillset/skills/review-change/SKILL.md`, and the reusable agent role in `.skillset/agents/reviewer.md`.

For a new child repository, `skillset create my-project --yes` also adds its initial working guidance as `.skillset/rules/skillset-workflow.md`. It leaves root `AGENTS.md` for the first confirmed build, so the initial guide and your own instructions share the same canonical source and generated ownership.

## Understand the destinations

| Authored input | Standard output | Provider output |
| --- | --- | --- |
| Unscoped `.skillset/rules/project.md` | Root `AGENTS.md` | Root `CLAUDE.md`; Cursor `.cursor/rules/project.mdc`; Codex consumes compatible `AGENTS.md` |
| Path-scoped instruction rules | Scoped `AGENTS.md` files | Claude and Cursor path-scoped rules |
| `.skillset/skills/review-change/` | `.agents/skills/review-change/` | Claude and Cursor skill directories; Codex may share the standard skill and add native sidecars |
| `.skillset/agents/reviewer.md` | No portable agent-role standard | Provider-native project agents, including `.claude/agents/reviewer.md` and `.codex/agents/reviewer.toml` |

`AGENTS.md` and `.agents/skills/` remain applicable when a provider is disabled. For example, root `claude: false` controls Claude output without disabling the standards baseline. Project-agent roles and Codex-specific settings are separate from that baseline; see the [Codex provider guide](../reference/providers/codex.md).

Claude-enabled unscoped instructions aggregate into root `CLAUDE.md`. Instructions with `paths` remain separate files under `.claude/rules/`, so Claude loads each instruction once. Existing unmanaged root guidance remains protected by collision checks; move or adopt it into canonical source before asking Skillset to own that destination. The [instruction reference](../reference/features/instructions.md) owns the supported mapping.

## Build local files separately from plugin bundles

In a workspace containing only local source, the ordinary build is sufficient:

```bash
skillset build
skillset build --yes
skillset check --only outputs
```

When the same workspace also contains plugin source, combine the `repo` and `project` destination scopes to leave plugin bundle destinations out of that operation:

```bash
skillset build --scope repo,project
skillset build --scope repo,project --yes
```

`repo` selects skill roots; `project` selects instructions, project agents, and provider-native project files. These scopes filter destinations, not source audiences: eligible plugin-owned skills also participate in the inherent repository Agent Skills output. A scoped build is therefore not a private-versus-public content boundary. See [Build Scopes](../reference/features/build-scopes.md).

## Keep hooks explicit

`.skillset/hooks/` holds adaptive hook definitions with explicit attachments. A directory of hook files does not automatically enable a project-wide runtime hook. Attach a supported hook to its owning skill, agent, or plugin, and consult the [hook support contract](../reference/features/hooks.md) before assuming a provider can enforce it. Codex has no faithful adaptive skill-local or project-agent hook destination today.

Use `.skillset/_claude/`, `.skillset/_codex/`, and `.skillset/_cursor/` for reviewed provider-native project files. Building those files and enabling them in a runtime are separate operations.

## Existing root-level content

Root `skills/`, `hooks/`, and `rules/` are not additional automatic source roots in the current compiler. Importing an existing skills directory copies it into canonical `.skillset/skills/`; it does not establish a live link to the original directory:

```bash
skillset import ./skills --kind skills --root .
```

Explicit repository source pointers currently exist for selected plugin features, including `mcp.source` and `bin.source`. There is no general `skills.source` or `hooks.source` contract. See [Feature Source Pointers](../reference/features/feature-source-pointers.md) for the implemented boundaries.

Keep authored source distinct from generated destinations, especially when a repository also distributes skills or plugins. Changing a provider output path does not change where Skillset discovers authored source.
