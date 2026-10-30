# Preflight and Recovery

The helpers beside `scripts/compatibility.env` share one compatibility contract. Its `cli` value is an exact singleton range, currently `=0.30.0`, and its scope is `entry-preview`. Earlier and later releases are unqualified; malformed, prerelease, multiline, or failed version output is unknown. The helpers invoke only the discovered compiler's `--version` and optional platform identification. Runtime availability is observed without executing package managers. As with any PATH command, run the probe only when executing the discovered CLI is appropriate.

## Qualified Entry Operations

The published exact package was exercised for new-workspace `init --root .` without `--yes`, existing-workspace `status --root .`, `check --root .`, `check --only outputs --root .`, `diff --root .`, and static `lookup activation mcp --compat codex`. Status/check can exit nonzero for drift or a missing baseline; report that outcome instead of treating it as clean or automatically building. This qualification does not establish every deeper command in the bundled references, clean-check success for every workspace, or provider execution. Read command-specific help before deeper operations. The newer `lookup capability` route is unavailable in this qualified release.

## Missing, Stale, or Unknown CLI

Recognition and inventory still work without the compiler. Inspect the requested directory for `skillset.yaml`, `.skillset/`, root `SKILL.md`, `AGENTS.md`, `CLAUDE.md`, and provider directories; read only relevant authored files. Both workspace markers absent suggests a candidate new workspace; just one present needs inspection of custom source paths or incomplete setup. A user-scope request is explicit intent, not permission to scan the home directory or alter global configuration.

Present the choices that fit the user's request and existing authorization:

- Persistent install: `npm install --global skillset`. This changes the user's environment; obtain authorization when not already granted, then rerun preflight. The latest release may be outside this guidance's qualified range.
- Ephemeral exact package: `npm exec --yes --package=skillset@0.30.0 -- skillset --version`, followed by `npm exec --yes --package=skillset@0.30.0 -- skillset init --root .` for a new-workspace preview. These exact commands were executed against the published package. They can download code and write a package cache; run only when that is permitted and chosen. The package runner's `--yes` accepts its download prompt; it is not Skillset's applying `--yes`. Do not add the latter to a preview.
- Native alternative: for a disposable skill or provider setting, edit the provider-native authored artifact directly when that satisfies the requested scope. Do not claim cross-provider reuse, compiled checks, or migration happened.

The npm launcher requires Node 18 or later and an available platform binary; Bun is not required. If the required runtime, platform binary, network or registry access is unavailable, report that specific limitation and continue inspection or native work within scope. Never install silently or weaken workspace confirmation, provider trust, or shell execution policy to recover.

The helper output is finite `key=value` observations, not a serialized workspace or approval. It distinguishes config and source-directory presence and reports conventional artifact cues. It does not validate configuration, recurse into files, infer user-level roots, contact a service, or write outputs. All routes reuse this reference and the same two platform helpers; future specialists should link here instead of duplicating recovery rules.
