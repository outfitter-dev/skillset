---
description: Skillset marketplaces declare provider catalogs, verify plugin readiness, and write supported marketplace indexes.
---

# Marketplaces

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `marketplaces` | `implemented` | `native` | `future` | `native` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

A marketplace declares which local or external Skillset plugins belong in provider catalog indexes. The marketplace repository owns catalog membership and presentation; each plugin repository owns source, version authority, generated bundles, and release evidence.

Use the [marketplace guide](../../guides/marketplaces.md) for the complete task flow. A [distribution](distributions.md) instead plans where already-built files could be delivered, and is not a catalog or publication command.

## Declare a Catalog

Marketplace source is a root `skillset.yaml` field:

```yaml
marketplaces:
  outfitter:
    title: Outfitter
    targets: [claude, cursor]
    plugins:
      - plugin: outfitter-core
      - plugin: trails-review
        repo: github:outfitter-dev/trails
        ref: main
```

Catalog ids are lowercase. `targets` defaults to all supported provider [targets](../../glossary.md#target). Every plugin entry requires its logical `plugin` id; optional `id` can give the catalog entry a different id.

No `repo` means `.skillset/plugins/<plugin>/` in the current marketplace repository. An external `repo` must be a credential-free Git reference such as `github:org/repo`, HTTPS, SSH, or SCP syntax. Relative paths and `file:` URLs are rejected in committed source. Credentials remain in ordinary Git or CI configuration.

An external entry may select at most one revision policy:

| Field     | Meaning                                      |
| --------- | -------------------------------------------- |
| `channel` | Floating channel; only `latest` exists today |
| `ref`     | Requested Git ref                            |
| `sha`     | Exact lowercase 40-character commit          |
| `version` | Requested semantic version policy            |

Omitting all four defaults to `channel: latest`. Optional entry `targets` narrows the catalog targets. Exact fields and validation live in the generated [workspace schema](../schemas/README.md).

## Verify Readiness

```bash
skillset marketplace check outfitter
skillset marketplace check outfitter --json
```

Every entry begins at `declared`. An external entry then reports either `floating` or `pinned`; a local entry has no revision-policy state. Both continue through `resolved`, `renderable`, `generated`, `verified`, `locked`, and `marketplace-ready`. A stale lock reports `stale` and ends at `not-ready`; any other failed step also ends at `not-ready` with a structured reason. Merely finding renderable source is insufficient: the selected provider bundle and portable lock proof must be current.

The check is read-only with respect to the marketplace repository, provider indexes, external plugin repositories, and runtime configuration. External resolution can contact the declared remote and populate or refresh Skillset's owned XDG cache. Floating `latest`, `ref`, and `version` policies resolve from the remote on every check; a warm cache is not current evidence. An exact pinned SHA can reuse a matching verified cache or clean known checkout.

Ordinary `build` and `check` remain network-free.

## Preview and Write Provider Indexes

```bash
skillset marketplace update outfitter
skillset marketplace update outfitter --yes
```

Without `--yes`, update previews the complete provider-index and lock plan. A confirmed update revalidates the plan, writes supported provider indexes, and updates marketplace provenance in the existing `skillset.lock`. If local input or a floating remote changes after preview, the atomic transaction refuses without writing output or lock state.

Claude receives `.claude-plugin/marketplace.json`; Cursor receives `.cursor-plugin/marketplace.json`. Codex plugin bundles can be checked for readiness, but Skillset does not currently emit a Codex-owned marketplace index. Codex marketplace configuration and activation remain external.

The generated [`marketplace` reference](../cli/marketplace.md) owns exact syntax.

## Resolution and Cache Boundary

Resolution tries the current repository, then a matching managed known checkout, then deterministic remote acquisition under `$XDG_CACHE_HOME/skillset/remotes/` (or `~/.cache/skillset/remotes/`). The known-checkout index is disposable XDG configuration state, not committed [workspace](../../glossary.md#workspace) authority.

Remote-cache entries are keyed by canonical repository and revision policy. Origin, boundary, Git-directory, and exact-commit checks prevent one corrupt, symlinked, or mismatched entry from being treated as another repository. Marketplace lookup never mutates an external checkout. Successful ordinary workspace commands may maintain the known-checkout index, but a read-only marketplace lookup does not repair that index.

## Errors and Recovery

| Problem | Result | Recovery |
| --- | --- | --- |
| Repository cannot resolve | Entry is `not-ready` | Correct the credential-free repo/ref or Git access |
| Provider bundle is absent | Entry is unbuilt | Build and check the plugin repository first |
| Generated bundle or lock is stale | Entry is unverified | Regenerate from the owning plugin source |
| Requested target is missing | Entry is not renderable | Enable/build a supported target or narrow entry targets |
| Pinned SHA differs | Entry is `not-ready`; no fallback is substituted | Correct the pin or provide matching evidence |
| Cache origin, integrity, or boundary check fails | Entry is `not-ready`; Skillset does not touch another cache/source repo | Remove only the identified disposable cache entry and retry |
| Input changes between preview and apply | Update refuses the stale transaction | Rerun preview and review the new plan |

Marketplace commands never publish a repository, mutate an external plugin repo, install or trust a plugin, or write user-level runtime settings.

## Provenance

The root `skillset.lock` records catalog, entry and plugin ids; requested policy; portable repository/ref/SHA evidence; plugin version; target; [provider-native](../../glossary.md#provider-native) entry; derived output paths; readiness; and catalog output ownership. It never records checkout roots, XDG paths, cache keys, credentials, or local Git URLs.

After a confirmed update records a ready external resolution, ordinary offline output checks can reuse that portable proof while the declaration remains unchanged. Editing the repository, policy, plugin, or target invalidates it and requires another marketplace update.
