---
description: Compare Skillset provider realizations by semantic capability or native alias and consume results from a pinned Git commit.
---

# Provider Capability Comparison

Use [`skillset lookup capability`](cli/lookup.md) to compare how Skillset realizes a capability. Query a stable ID such as `skill-invocation` or an exact native alias such as `allow_implicit_invocation`. A shared alias such as `SKILL.md` can return more than one concept. Omit the query to list all capabilities, or use `--compat` to select providers.

For an agent-guided comparison, invoke `skillset-provider-capabilities` from the public Skillset plugin. The `use-skillset` skill routes comparison questions there. The specialist can answer from the bundled snapshot without a CLI or workspace; its answers describe the snapshot's pinned evidence, not live provider behavior.

## Consume A Pinned Result

Choose a full commit SHA containing this comparison command. Use the Bun version in that revision's `.bun-version` and install its locked dependencies. This example runs the pinned CLI from a separate, empty consumer directory:

```bash
set -e
ref=YOUR_FULL_SKILLSET_GIT_COMMIT_SHA
git clone https://github.com/outfitter-dev/skillset.git skillset-source
git -C skillset-source checkout --detach "$ref"
test "$(git -C skillset-source rev-parse HEAD)" = "$ref"
repo="$(cd skillset-source && pwd)"
(cd "$repo" && bun install --frozen-lockfile)
mkdir skillset-consumer
(
  cd skillset-consumer
  bun "$repo/apps/skillset/src/cli.ts" lookup capability allow_implicit_invocation \
    --compat claude,codex --json > comparison.json
  jq -er '.data.capabilities[] | [.capabilityId, .target, .fidelity] | @tsv' comparison.json
)
```

Lookup needs no network access after dependency installation. JSON results use the `skillset.cli.result@1` envelope; read `data.capabilities` and identify a row by its `capabilityId`, `featureId`, and `target`. In the initial crosswalk, the example reports `equivalent` for Claude's inverted flag and `exact` for Codex's direct flag. The claim is about invocation eligibility, not whether a model invokes a skill.

## Interpret The Comparison

Read a row's `semanticScope` and `limitations` alongside its fidelity. The canonical source shape and schema contract describe how to author the portable intent. The destination and realization describe what Skillset can emit; a native format, metadata file, or successful build does not prove runtime activation, enforcement, or effectiveness.

Fidelity is `exact` for direct semantics, `equivalent` for a different representation that preserves intent, `partial` when only a subset survives, or `synthesized` when Skillset combines or relocates native features. `provider-only` identifies a useful provider-specific capability; `unavailable` is a reviewed absence. `unknown` means there is no current scoped judgment, not that a capability is unsupported. Evidence IDs point to the feature registry, pinned provider records, and reviewed implementation evidence.

This crosswalk compares representative capability families. For individual hook events, matchers, handlers, or reverse aliases, use the separately versioned [hook catalog](registry/README.md).
