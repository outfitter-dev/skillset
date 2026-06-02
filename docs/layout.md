# Layout

`skillset` expects content repositories to separate portable source from generated target outputs:

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
      agents/
        openai.yaml
  plugins/
    <plugin-name>/
      skillset.yaml
      README.md
      skills/
        <skill-name>/
          SKILL.md
          references/
          agents/
            openai.yaml
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
      agents/
        openai.yaml
```

The generated target roots are meant to be usable as plugin repositories or as inputs to a future publish/sync step. They are not source truth.

This compiler repo uses that same layout for its own source:

- `.skillset/skills/skillset-claude-development` is a Claude-only internal standalone skill for compiler development.
- `.skillset/skills/skillset-codex-development` is a Codex-only internal standalone skill for compiler development.
- `.skillset/plugins/skillset` is the user-facing plugin that explains how to use `skillset`.

Plugin output roots and standalone skill output roots can be enabled with defaults or configured from root `.skillset/config.yaml`:

```yaml
claude:
  plugins: true
  skills: true

codex:
  plugins:
    - skillset
  skills:
    path: .agents/skills
```

Boolean output settings use the default roots: `plugins-claude/`, `plugins-codex/`, `.claude/skills`, and `.agents/skills`. Arrays select specific plugin or standalone skill names. Object settings can set `path`, `include`, or `enabled: false`.

Plugin-local `README.md` files are copied into each generated target plugin. Shared source inputs such as `.skillset/shared/assets`, `.skillset/shared/scripts`, `.skillset/shared/references`, and `.skillset/shared/templates` are available for source organization; they are not copied into every output unless a source skill or plugin includes them.

## Skill Policy

Skill frontmatter can express normalized policy once and let the compiler lower it into target-native files:

```yaml
implicit_invocation: false
allowed_tools:
  claude:
    - Read
    - Grep
  codex: false
```

Values can be shared (`implicit_invocation: false`) or target-scoped (`implicit_invocation: { claude: false, codex: true }`). `implicit_invocation` lowers to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. If a Codex source skill already has `agents/openai.yaml`, generated policy is merged into it instead of overwriting the rest of the file.

`allowed_tools` lowers to Claude `allowed-tools`. Codex `agents/openai.yaml` supports tool dependencies and invocation policy, but it is not a skill-local equivalent to Claude tool preapproval. For now Codex-enabled skills must leave `allowed_tools.codex` unset or set it to `false`; `skillset lint` rejects shared or Codex-targeted allowed tools until a real Codex permission lowering is validated.

Import helpers write only to `.skillset/`:

```bash
skillset import skill /path/to/SKILL.md --root .
skillset import plugin /path/to/plugin-dir --root .
```
