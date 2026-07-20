# Resources

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `resources` | `implemented` | `native` | `native` | `native` |
<!-- skillset:feature-support:end -->

Feature id: `resources`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Resources let skills copy exact shared files or directories into generated skill folders without copying the entire source tree.

## Authoring

Root shared inputs live under `<source-root>/shared/`. Plugin-local shared inputs live under `<source-root>/plugins/<plugin>/shared/`. `<source-root>` is `.skillset/`. Skills opt in through `resources` frontmatter using `shared:` for root shared resources or `plugin:` for plugin-bound skills.

```yaml
resources:
  references:
    - shared:references/common.md
  scripts:
    - plugin:scripts/check.sh
  templates:
    - from: shared:templates/report.md
      to: templates/report.md
```

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Declared resource file | skill-local copied file | skill-local copied file | `portable` / `implemented` | Links and scripts remain relative to the generated skill directory. |
| Declared resource directory | skill-local copied tree | skill-local copied tree | `portable` / `implemented` | Child links through resource URLs rewrite to generated paths. |

## Diagnostics

- Reject undeclared shared resource links and suggest a `resources` entry.
- Reject ambiguous bare links to source resource paths when a custom `to` path is used.
- Reject resource mappings that escape the generated skill directory or overwrite generated files.
- Reject plugin resources from standalone skills.
- Lint declared `scripts/` resources that are missing executable bits.

## Provenance

Resource contents are included in generated skill source hashes and `skillset check --only outputs` drift. Lock entries keep generated file hashes so resource-only changes are visible.

## Tests and Fixtures

Fixtures cover declared file and directory resources, custom `to` paths, link rewriting, escape rejection, collision rejection, plugin-root script diagnostics, executable-script linting, and resource-driven drift.
