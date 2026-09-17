---
description: Configure provider selection and project-wide compiler behavior in skillset.yaml.
---

# Project Configuration

The root `skillset.yaml` defines a Skillset [workspace](../glossary.md#workspace). Authored skills, agents, instructions, plugins, and shared inputs live under its [source root](../glossary.md#source-root), `.skillset/`.

A small manifest can select providers and keep the default [build](../glossary.md#build) policy explicit:

```yaml
compile:
  targets: [claude, codex, cursor]
  build: updated
  session_start_hook: auto
  unsupportedDestination: error
```

The [workspace-config schema and maximal example](../reference/schemas/README.md) are the exhaustive contract. The sections below cover the choices most projects need to make.

## Select Providers

`compile.targets` establishes the root provider plan; each selected provider becomes a [target](../glossary.md#target). It accepts `claude`, `codex`, and `cursor`. When it is omitted, Skillset uses the default provider plan and builds every supported provider rendering for portable source.

Root provider blocks such as `claude`, `codex`, and `cursor` configure output details and inherit that plan unless explicitly enabled or disabled. Lower-level plugin and [source-unit](../glossary.md#source-unit) provider toggles can opt a provider back in where the source contract supports it. A bare top-level `targets` key is invalid. See [target overrides](target-overrides.md) for the full [cascade](../glossary.md#cascade).

## Choose Build Behavior

`compile.build` accepts `updated` or `all` and defaults to `updated`. Updated mode selects missing or changed [generated output](../glossary.md#generated-output); all mode selects every configured generated file. The command-line `--updated` and `--all` options override the manifest for one run.

Builds are plan-first and write only when confirmed with `--yes`. See the generated [`skillset build` reference](../reference/cli/build.md) for the current command and flags.

## Handle Unsupported Destinations

`compile.unsupportedDestination` controls what happens when a source unit cannot reach a requested [destination](../glossary.md#destination) without an unsupported or lossy result:

- `error` is the default and blocks the build.
- `warn` and `skip` soften unsupported or lossy results and preserve diagnostics.
- `force` permits those results while retaining their provenance.

Failed [render results](../glossary.md#render-result) block every policy. Check current provider behavior in the [support matrix](../reference/support-matrix.md) before softening this setting.

## Configure Generated Metadata and Prompt Arguments

`compile.skillset.metadata` defaults to `true`. Set it to `false` to suppress the compiler-owned `metadata.version` and `metadata["skillset.schema"]` fields on rendered skills. Authored provider metadata remains intact.

`compile.features.promptArguments` also defaults to `true`. Set it to `false` to reject Skillset-owned `{{$ARGUMENTS...}}` expressions. See the [preprocessing reference](../reference/source/preprocessing.md) for expression and target behavior.

`compile.instruction_front_page` accepts `claude-dir` (the default) or
`repo-root`. The setting is validated now so the instruction front-page
renderer can consume one stable spelling; current builds do not move a file in
response to it yet.

`compile.session_start_hook` accepts `auto`, `on`, or `off` and defaults to
`auto`. `on` composes the Skillset SessionStart command into the project-local
Claude and Codex hook files. `off` removes only that command while preserving
other entries. `auto` enables the composition only when every enabled project
hook destination is ignored by Git.

## Select Plugin Content for This Project

`plugins.internal_use` selects plugin content for this project and reports the
selection plan. Selected live skills render as project-use copies; other plugin
components do not accompany them. Omitting the setting selects none. A boolean
selects all or none; the object form can select whole plugins, individual live
skills, and drafts:

```yaml
plugins:
  internal_use:
    plugins: [review-tools]
    skills:
      review-tools: [review, "!proofread"]
    drafts:
      review-tools: [future-review]
```

Selections are unions and exclusions always win. Quote exclusions as
`"!name"`. A negative-only list means everything in that scope except the
named entries. Selecting and excluding the same unit is an error, and excluding
a whole plugin also excludes its skills and drafts. Reordering lists does not
change the result. Provider-specific `skills` filters apply after this
workspace selection.

The root `drafts` list can mark standalone skills with `skill:<id>` and plugin
skills with `plugin.<plugin-id>.skill:<id>`. A plugin-local `drafts` list can
mark that plugin's skills with `skill:<id>`. Other source-unit selector forms
are rejected because draft status currently belongs only to skills. The
`skillset explain` reports `config` as the origin. Selected live plugin skills
are copied into every enabled fixed provider skill root. Workspace skills keep
their leaf name; colliding plugin copies use `<plugin-id>-<leaf>`, and the
render result records `internal-use-name-conflict`. Workspace drafts render
beside live project skills as `draft-<leaf>`. For selected plugin skills,
omitting `plugins.internal_use.drafts.<plugin>` inherits each selected live
skill's same-container draft; `true` or a list selects drafts explicitly, and
`false` excludes them. The string policy `only` emits only drafts in the
selected plugin content, while `override` emits a paired draft at its live
sibling's project name and leaves selected live skills without drafts
unchanged. A whole-plugin selection brings unpaired drafts into either mode;
an individual live-skill selection brings only its same-container pair.
Selection and exclusions resolve before either policy, so excluding a live
skill also excludes its paired draft and no policy restores excluded content.

Workspace drafts, side-by-side plugin drafts, `only`-mode drafts, and unpaired
`override` drafts use `draft-<leaf>` for their directory and frontmatter name.
A paired `override` draft instead uses its live sibling's effective project-use
name. Every rendered project draft prefixes its description with
`[SKILLSET DRAFT] ` and writes boolean `metadata.internal: true` even when
`internal_marker` is `false`.
Pairing requires an equal leaf in the same workspace or plugin container.
Project-use lock entries record the canonical source unit, effective name,
selection rule, and target owner; project drafts additionally record draft
origin, applied draft policy, and the same-container shipped sibling when one
exists. Drafts never enter plugin packages or marketplace output.
`internal_marker` defaults to `true` for live project-use copies; set it to
`false` to omit their marker.
Referenced skill resources travel with copies. Other plugin-level hooks,
unrelated shared trees, MCP servers, and executables are not hydrated:
selecting the whole plugin or a skill with its own hook attachment reports the
unhydrated dependency. An unrelated file in a shared directory does not make
an individually selected skill depend on it.

Target-eligible adaptive hook attachments on a selected project draft are
rejected because project draft copies cannot hydrate them; they are never
silently dropped.

## Plan Plugin Package Paths

`plugins.output` parses package placement now. The default is
`plugins/[name]`; custom placement remains a check error until package placement
support lands. The four expansion forms are:

| Configuration | Plugin `toolbox` expands to |
| --- | --- |
| `plugins/` | `plugins/toolbox/` |
| `plugins/[name]/dist` | `plugins/toolbox/dist/` |
| `[name]` | `toolbox/` |
| `.` | the repository root |

Paths are workspace-relative, use forward slashes, and may contain at most one
`[name]` token. `{{name}}`, `$PROJECT_ROOT`, absolute paths, and traversal are
invalid. A target block such as `plugins.output.codex` may override `path` and
may parse the future `name` and `combine` keys; those keys remain unsupported
until their owning package-placement features land.

## Configure Other Workspace Features

The manifest also hosts project-wide configuration for [agents](../reference/features/agents.md), [changes](../reference/features/changes.md), [dependencies](../reference/features/dependencies.md), [distributions](../reference/features/distributions.md), [marketplaces](../reference/features/marketplaces.md), and [support constraints](../reference/features/supports.md). Follow those feature pages for behavior and the generated workspace schema for exact field shapes.

## Validate and Inspect

Run [`skillset check`](../reference/cli/check.md) after changing the manifest. Use [`skillset lookup`](../reference/cli/lookup.md) for finite values and schema facts; for example:

```bash
skillset lookup workspace --field compile.targets --values
```

New manifests include a YAML language-server comment pointing at the current workspace schema. Do not add a parallel `$schema` field to authored YAML.
