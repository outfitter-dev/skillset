# Layout

`skillset` expects content repositories to separate portable source from
generated target outputs:

```text
.skillset/
  config.yaml
  shared/
    assets/
    references/
    scripts/
    templates/
  skills/
    <skill-name>/
      SKILL.md
      references/
  plugins/
    <plugin-name>/
      config.yaml
      README.md
      skills/
        <skill-name>/
          SKILL.md
          references/
      commands/
      agents/
      hooks/
      assets/
      scripts/
plugins-claude/
  .skillset.lock
  README.md
  .claude-plugin/
    marketplace.json
  plugins/
    <plugin-name>/
      .claude-plugin/
        plugin.json
      skills/
plugins-codex/
  .skillset.lock
  README.md
  plugins/
    <plugin-name>/
      .codex-plugin/
        plugin.json
      skills/
.claude/
  skills/
    .skillset.lock
    <skill-name>/
      SKILL.md
.agents/
  skills/
    .skillset.lock
    <skill-name>/
      SKILL.md
```

The generated target roots are meant to be usable as plugin repositories or as
inputs to a future publish/sync step. They are not source truth.

This compiler repo uses that same layout for its own source:

- `.skillset/skills/skillset-claude-development` is a Claude-only internal
  standalone skill for compiler development.
- `.skillset/skills/skillset-codex-development` is a Codex-only internal
  standalone skill for compiler development.
- `.skillset/plugins/skillset` is the user-facing plugin that explains how to
  use `skillset`.

Plugin output roots and standalone skill output roots can be configured from
root `.skillset/config.yaml`:

```yaml
skillset:
  outputs:
    plugins:
      claude: plugins-claude
      codex: plugins-codex
    skills:
      claude: .claude/skills
      codex: .agents/skills
```

Import helpers write only to `.skillset/`:

```bash
skillset import skill /path/to/SKILL.md --root .
skillset import plugin /path/to/plugin-dir --root .
```
