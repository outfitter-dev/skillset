# Import Existing Source

> Detailed guidance follows the current compiler source. The router's exact CLI qualification covers only [entry previews](preflight-and-recovery.md); check command-specific help before using deeper operations.

For a whole existing repository, preview `skillset init`, then use `skillset init --adopt all --yes` for selected source import and isolated output review. Inspect the report with `skillset report show <id>`: Build (isolated) counts mirror writes, and Cutover lists live unmanaged collisions. Preserve or relocate those originals only after approving replacements. For root guidance, follow [guided root adoption](root-guidance-adoption.md); the compiler never chooses which authored document is stronger.

```bash
skillset import /path/to/SKILL.md --root .
skillset import /path/to/skill-dir --root .
skillset import /path/to/skills-root --kind skills --root .
skillset import /path/to/plugin-dir --root .
skillset import /path/to/plugins-root --kind plugins --root .
skillset import claude --root .
skillset import codex --root .
skillset import cursor --root .
skillset import agents --root .
```

`skillset import <path>` infers `skill`, `skills`, `plugin`, or `plugins` from the filesystem. Use `--kind` when a directory is ambiguous. Passing `SKILL.md` imports the full containing skill directory, including sibling `references/`, `scripts/`, `assets/`, `.codex/`, and other sidecars. The provider shortcuts import from provider skill roots such as `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, or `~/.agents/skills`; skills-root imports de-dupe symlinked skill directories by real path. Plugin imports write plugin-local `skillset.yaml`, synthesizing a minimal one when importing an Agent Plugins package with root `plugin.json` or a native plugin with `.claude-plugin/plugin.json` or `.cursor-plugin/plugin.json`. Legacy `.codex-plugin/plugin.json` remains a compatibility input whose supported meaning must map into the typed OpenAI boundary before modern ChatGPT output is written. Imports do not publish, install, symlink, trust, mutate registries, or change user-level config. When the destination has a buildable Skillset root, import reuses init's version-baseline machinery so imported versions become starting release-state truth rather than a fake release or one-time inline-version migration.

## Rules

- Use root `compile.targets` for provider selection. Do not use bare top-level `targets:`.
- Keep target adapter config in provider-specific blocks such as `claude`, `codex`, or `cursor`; use `defaults.<target>` only as shorthand for target defaults.
- Use provider-specific model keys such as `claude.model`, `codex.model`, `cursor.model`, or target defaults for model choices; top-level skill `model` warns in v1.
- Keep `compile.unsupportedDestination` on its fail-loud `error` default unless a bounded migration or provider-drift exception needs `warn`, `skip`, or `force`. Non-error policies must retain warning diagnostics and lock provenance, and failed render results always block.
- Use `skillset.name` for root/plugin explicit identity. `skillset.id` is unsupported.
- Do not hand-edit generated outputs as source truth. Native root `AGENTS.md` is authored source and is edited directly.
- Keep Claude-only dynamic placeholders out of Codex-enabled skills unless a target-safe fallback exists.
