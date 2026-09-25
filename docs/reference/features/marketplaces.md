---
description: Skillset marketplaces declare provider catalogs, verify plugin readiness, and write supported marketplace indexes.
---

# Marketplaces

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `marketplaces` | `implemented` | `native` | `native` | `native` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

A marketplace declares which local or external Skillset plugins belong in provider catalog indexes. The marketplace repository owns catalog membership and presentation; each plugin repository owns source, version authority, generated bundles, and release evidence.

ChatGPT is the OpenAI product term for the generated bundle and catalog family. Agent Plugins is the portable package standard used by the bundle core; its root `plugin.json`, `skills/`, and `mcp.json` contract does not define catalog source or policy fields.

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

## ChatGPT Catalog Projection

An ordinary build writes `.agents/plugins/marketplace.json`. Because that is one repository-owned path, Skillset permits at most one declared catalog targeting `codex`. With no such declaration, it derives an implicit catalog from all enabled local Codex plugins in source order. A declared catalog preserves its plugin order.

Each generated entry uses exactly one native source form:

| Kind | Required | Optional |
| --- | --- | --- |
| `local` | `source`, `path` | — |
| `url` | `source`, `url` | `path`, `ref`, `sha` |
| `git-subdir` | `source`, `url`, `path` | `ref`, `sha` |
| `npm` | `source`, `package` | `version`, `registry` |

Local `path` values start with `./` and resolve from the marketplace root, not from `.agents/plugins/`; a bare `./...` source string is shorthand for the same local source object. Git source URLs accept the parser's HTTPS, SSH/SCP, `github:`, absolute-path, and `file:///` forms. An optional Git `path` is repository-root-relative and starts with `./`; `git-subdir` requires it while `url` permits it. Npm registry URLs are credential-free HTTPS, and Git credentials remain outside generated source and evidence.

Native policy is closed and deterministic:

| Field | Accepted values | Default |
| --- | --- | --- |
| `installation` | `AVAILABLE`, `INSTALLED_BY_DEFAULT`, `NOT_AVAILABLE` | `AVAILABLE` |
| `authentication` | `ON_INSTALL`, `ON_USE` | `ON_INSTALL` |
| `products` | `atlas`, `chatgpt`, `codex` in source; native uppercase output | omitted, meaning unrestricted |

An explicit empty `products` list is preserved as deny-all. Policy parsing does not prove the policy was applied by a runtime. OpenAI's GitHub workspace-import flow manages installation and authentication in workspace settings rather than applying repository policy values.

The configured entry `id` is the native catalog `name`; when omitted it defaults to `plugin`. For local entries, the materialized package manifest remains authoritative for package version, description, keywords, author, and homepage, while the catalog owns category, policy, and reviewed interface overrides. Legacy flattened `displayName` is input-only and normalizes to `interface.displayName`. Package component fields such as `skills`, `mcpServers`, `apps`, and `hooks` are not catalog authority. Local interface assets must be contained files actually materialized under the package's `assets/`, `scripts/`, or `src/` roots. Remote Git and npm fallbacks omit `composerIcon`, `logo`, `logoDark`, and `screenshots` because their relative files are not materialized by the catalog.

[OpenAI's GitHub workspace-import flow](https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github) additionally documents `pluginId` for taking over an existing workspace plugin. Skillset does not author that migration-only identifier; it remains an explicit administrator workflow. The current [package and local-marketplace guide](https://developers.openai.com/plugins/build/plugins) is mutable supporting documentation; the registry separately pins the released parser source that fixes Skillset's implemented field boundary.

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

An ordinary build emits the ChatGPT `.agents/plugins/marketplace.json` catalog and Cursor's `.cursor-plugin/marketplace.json`. `marketplace update` remains Claude-only: it writes `.claude-plugin/marketplace.json` and corresponding marketplace provenance after confirmation, but does not write either ordinary-build index.

Compatible local clients discover a repository catalog from `$REPO_ROOT/.agents/plugins/marketplace.json`. Explicit `codex plugin marketplace add` registration instead records a local or Git marketplace source in Codex configuration. Skillset generation performs neither runtime registration nor configuration mutation.

The generated [`marketplace` reference](../cli/marketplace.md) owns exact syntax.

## Resolution and Cache Boundary

Resolution tries the current repository, then a matching managed known checkout, then deterministic remote acquisition under `$XDG_CACHE_HOME/skillset/remotes/` (or `~/.cache/skillset/remotes/`). The known-checkout index is disposable XDG configuration state, not committed [workspace](../../glossary.md#workspace) authority.

Remote-cache entries are keyed by canonical repository and revision policy. Origin, boundary, Git-directory, and exact-commit checks prevent one corrupt, symlinked, or mismatched entry from being treated as another repository. Marketplace lookup never mutates an external checkout. Successful ordinary workspace commands may maintain the known-checkout index, but a read-only marketplace lookup does not repair that index.

A cooperative lock serializes Skillset processes, but the cache key is deterministic, so an outside claimant can still occupy that namespace. Checkout publication therefore uses the host atomic no-replace directory rename: an occupied empty directory, file, or symlink survives unchanged, and hosts that cannot provide the primitive fail closed instead of replacing the destination.

## Errors and Recovery

| Problem | Result | Recovery |
| --- | --- | --- |
| Repository cannot resolve | Entry is `not-ready` | Correct the credential-free repo/ref or Git access |
| Provider bundle is absent | Entry is unbuilt | Build and check the plugin repository first |
| Generated bundle or lock is stale | Entry is unverified | Regenerate from the owning plugin source |
| Requested target is missing | Entry is not renderable | Enable/build a supported target or narrow entry targets |
| Pinned SHA differs | Entry is `not-ready`; no fallback is substituted | Correct the pin or provide matching evidence |
| Cache origin, integrity, or boundary check fails | Entry is `not-ready`; Skillset does not touch another cache/source repo | Remove only the identified disposable cache entry and retry |
| Cache filesystem lacks atomic no-replace rename | Entry is `not-ready`; no checkout is published | Move the XDG cache to a supported local filesystem |
| Cache filesystem rejects the atomic rename (permissions, I/O) | Entry is `not-ready`; no checkout is published | Check the XDG cache directory's permissions and health |
| Input changes between preview and apply | Update refuses the stale transaction | Rerun preview and review the new plan |

Marketplace commands never publish a repository, mutate an external plugin repo, install or trust a plugin, or write user-level runtime settings.

Likewise, an ordinary build only materializes the catalog. It does not register, sync, install, trust, enable, activate, upload, or publish any marketplace or plugin.

## Provenance

The root `skillset.lock` records catalog, entry and plugin ids; requested policy; portable repository/ref/SHA evidence; plugin version; target; [provider-native](../../glossary.md#provider-native) entry; derived output paths; readiness; and catalog output ownership. It never records checkout roots, XDG paths, cache keys, credentials, or local Git URLs.

After a confirmed update records a ready external resolution, ordinary offline output checks can reuse that portable proof while the declaration remains unchanged. Editing the repository, policy, plugin, or target invalidates it and requires another marketplace update.
