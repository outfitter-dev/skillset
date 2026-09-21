---
description: ChatGPT product-bundle apps define manifest discovery, typed component output, conflicts, and current configuration limits.
---

# Apps

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `future-companion-source-pointers` | `planned` | `planned` | `planned` | `planned` |
| `plugin-apps` | `implemented` | `not_applicable` | `pass_through` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

The Codex-selected ChatGPT product bundle can include an `.app.json` app declaration. Skillset resolves the conventional file as typed OpenAI component source for [rendering](../../glossary.md#render), provenance, and [activation](../../glossary.md#activation) planning; there is no user-facing feature-key source pointer.

## Authoring

Place `.skillset/plugins/<plugin>/.app.json` in plugin source when an enabled Codex target should include the ChatGPT app component. It renders at `plugins/<plugin>/.app.json` and is referenced by `extensions.com.openai.apps`. Discovery is automatic. There is no `apps.source`, `app.source`, or `apps: true` source key; those shapes fail config validation.

```text
.skillset/plugins/reviewer/.app.json
```

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `.app.json` | n/a | `.app.json` plus `extensions.com.openai.apps` | `target_native` / `implemented` | Opaque pass-through today. |
| Future `apps.source` | n/a | n/a | `planned` | Reserved for a later adapter if app manifests need feature-key validation and provenance. |

## Diagnostics

- Unknown top-level plugin config keys fail, so unsupported `apps.source` syntax is not silently accepted.
- App manifest pass-through does not install, activate, trust, or mutate Codex runtime configuration.
- If provider source tries to emit a conflicting `.app.json`, divergent output detection fails loudly.

## Provenance

The current `.app.json` pass-through participates in plugin output hashes, generated manifest shape, and the `plugin-feature` lock entry used for activation planning.

## Evidence

The [Codex provider reference](../providers/codex.md) records the provider boundary. Plugin manifest and contract tests verify companion discovery, conflicts, and generated manifest shape.
