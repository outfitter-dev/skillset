# Marketplaces

Feature id: `marketplaces`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Marketplaces describe curated provider catalog intent. A marketplace repo owns catalog membership and marketplace-level presentation, while each plugin repo owns plugin source, version authority, generated provider bundles, and release provenance.

This source contract is intentionally separate from [Distributions](distributions.md). A distribution plan asks where generated files could sync after a build. A marketplace catalog asks which local or external Skillset plugins should appear in provider marketplace indexes once readiness has been proven.

## Source Shape

Marketplace source lives in root `skillset.yaml` under `marketplaces`:

```yaml
marketplaces:
  outfitter:
    title: Outfitter
    targets:
      - claude
      - codex
    plugins:
      - plugin: outfitter-core
      - plugin: trails-review
        repo: github:outfitter-dev/trails
        channel: latest
      - plugin: skillset
        repo: github:outfitter-dev/skillset
        ref: main
```

Catalog ids are lowercase ids. `targets` defaults to every supported provider target. `plugins` is required and each entry requires `plugin`, the logical Skillset plugin id.

Missing `repo` means the plugin is authored in the current marketplace repo under `.skillset/plugins/<plugin>/`. Present `repo` means the plugin is authored by another Skillset repo. Committed marketplace source must use a remote repo reference, not a local filesystem path such as `../trails` or `file:../trails`; local checkout discovery belongs to managed user/XDG state.

Optional plugin entry fields:

| Field | Meaning |
| --- | --- |
| `id` | Catalog entry id when it must differ from the plugin id. Defaults to `plugin`. |
| `repo` | External Skillset repo reference, such as `github:org/repo` or an HTTPS git URL. |
| `channel` | Floating policy such as `latest`; lock provenance must pin the resolved commit/version later. |
| `ref` | Git ref requested by the catalog source. |
| `version` | Version policy requested by the catalog source. |
| `targets` | Provider targets for this entry, narrowing the catalog targets. |

Provider output paths such as `plugins-claude`, `plugins-codex`, `.claude-plugin`, or `.codex-plugin` are not part of the marketplace source contract. Provider-native source forms are derived output details for `marketplace update`.

## Resolution

The planned resolver order is:

1. Current marketplace repo for local entries.
2. Managed user/XDG known-Skillsets index for local checkout convenience.
3. Remote git or cache resolution for CI and portable verification.
4. A structured unresolved diagnostic.

The user/XDG index is managed state, not committed source truth. CI must be able to resolve from committed marketplace source and remote refs without a developer machine's local index.

## Readiness

Marketplace readiness is explicit:

| State | Meaning |
| --- | --- |
| `declared` | The catalog references an entry. |
| `resolved` | The referenced repo and plugin source were found. |
| `renderable` | Source/config says the requested provider target can be rendered. |
| `generated` | The expected provider plugin bundle exists at the derived output path. |
| `verified` | Generated output matches source, lock, and build expectations. |
| `marketplace-ready` | A provider marketplace entry can be emitted. |
| `not-ready` | Any step failed with a structured reason. |

`resolved` plus `renderable` is not enough. Provider marketplace entries require generated and verified provider output for the selected target/ref/channel.

## Commands

`skillset marketplace check` is planned as the read-only verifier. It should parse marketplace source, resolve local and external plugin entries, verify provider target support and generated output freshness, validate the provider-native marketplace output that would be written, and report unresolved, stale, unbuilt, target-missing, unsupported-provider, version/ref drift, and local-vs-remote differences. It must not write provider marketplace files, publish, install, trust, or activate anything.

`skillset marketplace update` is planned as the explicit write command. It should run the same readiness checks, refuse not-ready entries, render provider-native marketplace indexes, and update existing `skillset.lock` provenance. It must require the usual write posture and must not mutate external plugin repos or runtime/user settings.

## Provenance

Marketplace provenance belongs in existing `skillset.lock` files. There is no separate marketplace lock. Lock/report records should include the marketplace id, entry id, plugin id, source repo, requested channel/ref/version policy, resolved commit SHA/ref, plugin version, provider target, provider-native marketplace source form, derived provider output path, generated output hash, and readiness status.

## Evidence

- [SET-133](https://linear.app/outfitter/issue/SET-133/design-skillset-marketplace-catalogs-and-external-plugin-references) - source contract and command boundary.
- [Distributions](distributions.md) - related post-build sync planning surface.
- [Runtime Adapters](runtime-adapters.md) - runtime support remains separate from compile targets and marketplace readiness.
