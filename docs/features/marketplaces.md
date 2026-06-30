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

The resolver order is:

1. Current marketplace repo for local entries.
2. Managed user/XDG known-Skillsets index for local checkout convenience.
3. Remote git or cache resolution for CI and portable verification. This is reserved for the update/provenance follow-up work.
4. A structured unresolved diagnostic.

The user/XDG index is managed state, not committed source truth. CI must be able to resolve from committed marketplace source and remote refs without a developer machine's local index.

The known-Skillsets index lives at `$XDG_CONFIG_HOME/skillset/skillsets.json`, falling back to `~/.config/skillset/skillsets.json` when `XDG_CONFIG_HOME` is unset. Skillset updates this managed file opportunistically after successful local workspace commands such as `skillset build --yes`, build previews, `skillset check`, `skillset init --yes`, `skillset create --yes`, and successful `skillset adopt --yes`. Entries record the canonical local checkout path, the effective repo cache key, and normalized repository identities such as `github:outfitter-dev/trails`.

The index never records local filesystem paths in committed marketplace source, never mutates external plugin repos, and never writes Claude or Codex runtime settings. Stale paths are ignored during resolution so a moved or deleted checkout falls through to remote/git resolution instead of poisoning CI or marketplace checks.

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

`skillset marketplace check [name] [--json]` is the read-only verifier. It parses marketplace source, resolves local entries from the current repo, resolves external entries from the managed known-Skillsets index when available, verifies provider target support and generated output freshness, and reports unresolved, stale, unbuilt, and target-missing entries. It does not write provider marketplace files, publish, install, trust, activate anything, mutate external repos, or register local paths in committed source.

The check command exits successfully only when every selected target entry reaches `marketplace-ready`. Unresolved remote refs are reported as `not-ready` until remote/cache acquisition and lock provenance land in the follow-up slices.

`skillset marketplace update` is planned as the explicit write command. It should run the same readiness checks, refuse not-ready entries, render provider-native marketplace indexes, and update existing `skillset.lock` provenance. It must require the usual write posture and must not mutate external plugin repos or runtime/user settings.

## Provenance

Marketplace provenance belongs in existing `skillset.lock` files. There is no separate marketplace lock. Lock/report records should include the marketplace id, entry id, plugin id, source repo, requested channel/ref/version policy, resolved commit SHA/ref, plugin version, provider target, provider-native marketplace source form, derived provider output path, generated output hash, and readiness status.

## Evidence

- [SET-133](https://linear.app/outfitter/issue/SET-133/design-skillset-marketplace-catalogs-and-external-plugin-references) - source contract and command boundary.
- [SET-233](https://linear.app/outfitter/issue/SET-233/add-managed-known-skillsets-index-for-marketplace-repo-resolution) - managed XDG known-Skillsets index for local checkout resolution.
- [SET-234](https://linear.app/outfitter/issue/SET-234/implement-skillset-marketplace-check-readiness-reports) - read-only marketplace readiness reports.
- [Distributions](distributions.md) - related post-build sync planning surface.
- [Runtime Adapters](runtime-adapters.md) - runtime support remains separate from compile targets and marketplace readiness.
