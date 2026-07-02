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
| `channel` | Floating policy such as `latest`; lock provenance pins the resolved commit/version. |
| `ref` | Git ref requested by the catalog source; lock provenance records the exact resolved checkout. |
| `sha` | Exact commit requested by the catalog source. Pinned entries fail when the resolved checkout does not match. |
| `version` | Version policy requested by the catalog source; plugin version authority stays in the plugin repo. |
| `targets` | Provider targets for this entry, narrowing the catalog targets. |

Provider output paths such as `plugins/<plugin>/<provider>`, `.claude-plugin`, or `.codex-plugin` are not part of the marketplace source contract. Provider-native source forms are derived output details for `marketplace update`.

For Claude, local entries render as relative plugin roots such as `./plugins/outfitter-core`. External entries render as provider-native git subdirectory sources that point at the referenced repo and the derived generated Claude plugin bundle path, such as:

```json
{
  "source": "git-subdir",
  "url": "outfitter-dev/trails",
  "path": "plugins/trails-review/claude",
  "sha": "..."
}
```

The authored Skillset source stays repo-shaped (`repo`, `ref`, `sha`, `channel`, `version`) rather than asking users to hand-author provider output roots. Codex plugin bundles are still verified as marketplace entries, but Codex does not currently have a provider-owned generated marketplace index in this repo; Codex marketplace activation/config remains outside `marketplace update`.

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

The check command exits successfully only when every selected target entry reaches `marketplace-ready`. Bare local and known-index entries are treated as current-checkout checks. Explicit `channel`, `ref`, `version`, and `sha` policies must also match `skillset.lock` provenance; stale or absent lock proof blocks readiness. Unresolved remote refs are reported as `not-ready` until remote/cache acquisition lands in the follow-up update slice.

`skillset marketplace update [name] [--yes|--dry-run] [--json]` is the explicit write command. It runs the same source resolution, generated-output verification, and target support checks as `marketplace check`, refuses unresolved/unbuilt/stale generated output, renders provider-supported marketplace indexes, and updates existing `skillset.lock` provenance. Without `--yes`, it previews the files it would write and writes nothing.

`marketplace update` is allowed to refresh absent or stale marketplace lock entries when the referenced source and generated provider output are otherwise ready. It still blocks unresolved sources, stale generated plugin bundles, missing target support, and pinned `sha` mismatches. The command never mutates external plugin repos, publishes marketplaces, installs/trusts/activates plugins, or writes user-level provider runtime settings.

## Provenance

Marketplace provenance belongs in existing `skillset.lock` files. There is no separate marketplace lock. The root lock can carry a top-level `marketplaces.entries` section alongside generated-output `items`; `items` remains the generated-file ownership list, while marketplace entries record catalog readiness and resolved source facts without claiming ownership of external plugin repo files.

Each marketplace lock/report entry records the marketplace id, entry id, plugin id, source repo when present, requested channel/ref/sha/version policy, resolved source kind/path/ref/SHA when known, plugin version, provider target, provider-native marketplace source form, derived provider output path(s), and readiness status. Explicit pinned `sha` entries fail if the resolved checkout SHA is missing or different. Floating entries fail when the current resolution differs from the lock.

## Evidence

- [SET-133](https://linear.app/outfitter/issue/SET-133/design-skillset-marketplace-catalogs-and-external-plugin-references) - source contract and command boundary.
- [SET-233](https://linear.app/outfitter/issue/SET-233/add-managed-known-skillsets-index-for-marketplace-repo-resolution) - managed XDG known-Skillsets index for local checkout resolution.
- [SET-234](https://linear.app/outfitter/issue/SET-234/implement-skillset-marketplace-check-readiness-reports) - read-only marketplace readiness reports.
- [SET-235](https://linear.app/outfitter/issue/SET-235/define-marketplace-ref-policy-and-lock-provenance-for-floating-and) - marketplace ref policy and `skillset.lock` provenance.
- [SET-236](https://linear.app/outfitter/issue/SET-236/implement-skillset-marketplace-update-provider-index-rendering) - `marketplace update` provider index rendering.
- [Distributions](distributions.md) - related post-build sync planning surface.
- [Runtime Adapters](runtime-adapters.md) - runtime support remains separate from compile targets and marketplace readiness.
