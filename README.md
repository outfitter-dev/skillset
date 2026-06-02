# Skillset

`skillset` compiles portable agent plugin and skill source into target-native Claude and Codex outputs.

It is currently local/private tooling for `galligan/agents`.

This repo also self-hosts a small `.skillset/` source tree:

- standalone internal skills for developing the compiler in Claude and Codex;
- one generated `skillset` plugin that teaches agents how to use the compiler.

## Usage

From a content repo:

```bash
skillset build
skillset lint
skillset check
```

The default contract is:

- source root: `.skillset/`
- root config: `.skillset/config.yaml`
- plugin source: `.skillset/plugins/<plugin-name>/`
- standalone skill source: `.skillset/skills/<skill-name>/`
- Claude plugin repo output: `plugins-claude/`
- Codex plugin repo output: `plugins-codex/`
- Claude standalone skill output: `.claude/skills`
- Codex standalone skill output: `.agents/skills`

Use explicit paths when building another repo:

```bash
skillset build --root /Users/mg/Developer/galligan/agents
skillset check --root /Users/mg/Developer/galligan/agents
skillset build --root /tmp/example --source custom-source --dist generated
```

`--dist` is a compatibility override for plugin outputs. Without it, plugin outputs default to `plugins-claude/` and `plugins-codex/`. Source config can also set explicit output roots in target output objects such as `claude.plugins.path` or `codex.skills.path`.

## Import

Seed source from an existing skill or plugin:

```bash
skillset import skill /path/to/SKILL.md --root /path/to/content-repo
skillset import skill /path/to/skill-dir --root /path/to/content-repo --name custom-name
skillset import plugin /path/to/plugin-dir --root /path/to/content-repo
```

Imports copy files into `.skillset/skills/<name>` or `.skillset/plugins/<name>`. Plugin imports write plugin-local `skillset.yaml`. Import does not install, trust, symlink, publish, mutate registries, or change user-level Claude/Codex config.

## Source Contract

Root source metadata lives at `.skillset/config.yaml`.

Each plugin lives at `.skillset/plugins/<plugin-name>/` and has its own `skillset.yaml`. Portable plugin fields live under `skillset`; target-specific overrides live under top-level `claude` and `codex` blocks. Skill source frontmatter can use top-level `title`, `summary`, `description`, `version`, `implicit_invocation`, and `allowed_tools`; the compiler derives target-native `name`, `description`, generated metadata, Claude frontmatter, and Codex `agents/openai.yaml` policy where supported.

Use `skillset.name` as the stable machine identity. `skillset.id` is accepted as a compatibility alias for older source. Do not use `targets:`.

Generated output strips source-only keys such as `skillset`, `claude`, `codex`, `agents`, `implicit_invocation`, `allowed_tools`, and `targets`. Generated skills receive only lightweight metadata:

```yaml
metadata:
  version: 0.1.0
  generated: skillset@0.1.0
```

Generated roots also receive `.skillset.lock` files with deterministic provenance and hashes.

Portable skill policy can be shared or targeted:

```yaml
implicit_invocation:
  claude: false
  codex: false
allowed_tools:
  claude:
    - Read
    - Grep
  codex: false
```

`implicit_invocation` lowers to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. `allowed_tools` lowers to Claude `allowed-tools`; Codex has no confirmed skill-local allowed-tools equivalent, so Codex-enabled source must omit `allowed_tools.codex` or set it to `false`.

## Self-Hosted Outputs

In this repo, run:

```bash
bun run skillset:build
bun run skillset:lint
bun run skillset:check
bun run check
```

Self-hosted source lives under `.skillset/`. Generated outputs are:

- `.claude/skills/skillset-claude-development`
- `.agents/skills/skillset-codex-development`
- `plugins-claude/plugins/skillset`
- `plugins-codex/plugins/skillset`

These are repo-local generated artifacts. Do not symlink them into global Claude/Codex config or publish them as part of normal compiler development.
