# Multi-provider Distribution Example

This source example is for a maintainer distributing the same review skill to Claude, Codex, and Cursor users. One canonical plugin becomes one shared package, with a portable manifest and supported provider-native manifests beside a shared skill tree. It demonstrates compiler output; publication and runtime activation remain separate workflows.

## Build a copy

From the Skillset repository root:

```bash
work="$(mktemp -d)/distribution"
cp -R examples/distribution "$work"
bun ./apps/skillset/src/cli.ts build --root "$work"
bun ./apps/skillset/src/cli.ts build --root "$work" --yes
bun ./apps/skillset/src/cli.ts check --only outputs --root "$work"
```

The first build previews without writing. The second confirms the generated package. This example commits only source; generated output appears in your copy after confirmation. With Skillset installed in a standalone copy, the equivalent commands are `skillset build`, `skillset build --yes`, and `skillset check --only outputs`.

## Inspect the package

```text
plugins/
  review-kit/
    plugin.json
    .claude-plugin/plugin.json
    .cursor-plugin/plugin.json
    skills/review-change/SKILL.md
  skillset.lock
```

`plugin.json` is the portable baseline and carries the Codex/OpenAI native extension. Claude and Cursor add manifests in their own metadata directories; those manifests point to `./skills/`. All three targets share the one skill tree. `plugins/skillset.lock` records generated ownership and provenance. There are no separate Claude, Codex, and Cursor copies of the plugin package.

The build also writes `plugins/README.md`, provider marketplace indexes at `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`, and `.cursor-plugin/marketplace.json`, and a root `skillset.lock` for those workspace outputs. These indexes describe the package; generating them does not publish or install it.

Edit `.skillset/plugins/review-kit/` and rebuild to update the distribution. Use the [publishing guide](../../docs/guides/publishing.md) when choosing a release and publication workflow. A provider-specific addition is useful only when that provider can represent it; the compiler reports unsupported or degraded output rather than making every provider appear equivalent.

The [projection chart](../../docs/start/how-rendering-works.md) explains the baseline and provider axes, and the [support matrix](../../docs/reference/support-matrix.md) records current feature evidence. This minimal skill does not establish parity for hooks, agents, tools, or runtime behavior.

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](../../docs/start/build-versus-activation.md).
