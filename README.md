# Skillset

`skillset` compiles portable agent plugin source into target-native Claude and
Codex plugin repositories.

It is currently local/private tooling for `galligan/agents`.

## Usage

From a content repo:

```bash
skillset build
skillset lint
skillset check
```

The default contract is:

- source root: `src/`
- generated root: `dist/`
- Claude plugin repo: `dist/claude`
- Codex plugin repo: `dist/codex`

Both generated target roots carry plugins under `plugins/<plugin-id>/`.

Use explicit paths when building another repo:

```bash
skillset build --root /Users/mg/Developer/galligan/agents
skillset check --root /Users/mg/Developer/galligan/agents --source src --dist dist
```

## Source Contract

Root source metadata lives at `src/skillset.yaml`.

Each plugin lives at `src/<plugin-id>/` and has its own `skillset.yaml`.
Portable fields live under `skillset`; target-specific overrides live under
top-level `claude` and `codex` blocks.

Generated output strips source-only keys such as `skillset`, `claude`, `codex`,
`agents`, and `targets`.
