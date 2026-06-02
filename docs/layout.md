# Layout

`skillset` expects content repositories to separate portable source from
generated target repositories:

```text
src/
  skillset.yaml
  <plugin-id>/
    skillset.yaml
    README.md
    skills/
      <skill-id>/
        SKILL.md
        references/
    commands/
    agents/
    hooks/
    assets/
dist/
  README.md
  claude/
    README.md
    .claude-plugin/
      marketplace.json
    plugins/
      <plugin-id>/
        .claude-plugin/
          plugin.json
        skills/
  codex/
    README.md
    plugins/
      <plugin-id>/
        .codex-plugin/
          plugin.json
        skills/
```

The generated target roots are meant to be usable as plugin repositories or as
inputs to a future publish/sync step. They are not source truth.
