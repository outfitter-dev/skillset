---
description: Declares a curated plugin catalog, verifies entry readiness, and writes the Claude marketplace index deliberately.
---

# Build and Verify a Plugin Marketplace

A marketplace repository owns catalog membership and presentation. Each plugin repository continues to own its plugin source, version authority, release evidence, and provider [targets](../glossary.md#target). A declaration is ready only after its [generated output](../glossary.md#generated-output) is current and verified.

## Declare a Catalog

Add a catalog under root `skillset.yaml`:

```yaml
marketplaces:
  outfitter:
    title: Outfitter
    targets: [claude, codex, cursor]
    plugins:
      - plugin: local-tools
      - plugin: trails-tools
        repo: github:outfitter-dev/trails
        ref: main
```

An entry without `repo` resolves from `.skillset/plugins/<plugin>/` in the marketplace repository. An external entry uses a credential-free remote Git reference, never a relative or `file:` path. Keep credentials in ordinary Git or CI configuration, not committed marketplace source.

An external entry may select at most one revision policy: `channel`, `ref`, `sha`, or `version`. Use the [marketplace feature reference](../reference/features/marketplaces.md) and generated [workspace schema](../reference/schemas/README.md) for the complete contract.

## Build Local Plugin Output First

Preview, write, and verify the provider bundles owned by the current repository:

```bash
bunx skillset build
bunx skillset build --yes
bunx skillset check --only outputs
```

Catalog declaration and source resolution are not enough. Every selected entry must also be [renderable](../glossary.md#render), generated, and verified before Skillset can emit a provider marketplace entry.

## Check Readiness

Check every catalog or one named catalog:

```bash
bunx skillset marketplace check
bunx skillset marketplace check outfitter --json
```

The command does not write the marketplace repository, provider indexes, external plugin repositories, or runtime settings. External resolution can contact the declared remote and populate or refresh Skillset's owned XDG remote cache. Floating `latest`, `ref`, or `version` policies are resolved again rather than trusting a warm cache; an exact matching `sha` can reuse verified cached evidence.

Ordinary [build](../glossary.md#build) and check commands remain network-free. The generated [`marketplace` reference](../reference/cli/marketplace.md) owns exact command syntax.

## Preview and Write Provider Indexes

Use JSON mode for a guaranteed non-interactive preview. It may resolve external source into the owned cache, but it does not write the catalog index or lock:

```bash
bunx skillset marketplace update outfitter --json
```

Then authorize the reviewed repository writes:

```bash
bunx skillset marketplace update outfitter --yes
```

The confirmed update writes the [provider-native](../glossary.md#provider-native) Claude marketplace index and marketplace provenance in the existing `skillset.lock`. It refuses unresolved source, stale or missing plugin bundles, unsupported targets, and pinned revision mismatches. If an input changes after preview, the transaction is refused instead of applying a stale plan.

Review and commit the index and lock changes. `marketplace update` does not mutate an external plugin repository, publish the marketplace repository, install or trust a plugin, prove [activation](../glossary.md#activation), or write user-level provider configuration.

## Know the Provider Outcomes

`marketplace update` can write Claude's `.claude-plugin/marketplace.json`. An ordinary build can render Cursor's `.cursor-plugin/marketplace.json`; the marketplace update command does not write that index. Codex plugin entries are checked for readiness, but Skillset does not currently emit a Codex-owned marketplace index; Codex marketplace configuration and activation remain external.

Use the [provider reference](../reference/providers/README.md) and generated [support matrix](../reference/support-matrix.md) for current support instead of inferring parity from the catalog's `targets` list.

## Keep Distribution Separate

A marketplace selects which plugins appear in provider catalog indexes. A [distribution](../reference/features/distributions.md) describes where an already-built rendering could sync after build. Distribution is currently plan-only, and marketplace update is not a substitute sync or publication command.

For unresolved repositories, missing targets, stale output, or lock-policy mismatches, start with [troubleshooting](../troubleshooting.md). The exhaustive [marketplace feature reference](../reference/features/marketplaces.md) owns resolution, readiness states, diagnostics, and provenance fields.
