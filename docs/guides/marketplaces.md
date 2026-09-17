---
description: Declares a curated plugin catalog, verifies entry readiness, and renders provider-native marketplace indexes without activating them.
---

# Build and Verify a Plugin Marketplace

A marketplace repository owns catalog membership and presentation. Each plugin repository continues to own its plugin source, version authority, release evidence, and provider [targets](../glossary.md#target). A declaration is ready only after its [generated output](../glossary.md#generated-output) is current and verified.

ChatGPT is the product name for OpenAI's plugin bundle and marketplace surfaces. [Agent Plugins](../reference/features/plugins.md) is the portable package standard that can form the core of a ChatGPT bundle; it does not define `.agents/plugins/marketplace.json`, marketplace policy, installation, or activation.

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

### Choose the ChatGPT catalog

ChatGPT has one repository catalog path, `.agents/plugins/marketplace.json`, so an ordinary build selects at most one declared catalog whose targets include `codex`. If more than one declared catalog targets `codex`, the build stops before writing. If none does, Skillset derives one implicit catalog from every enabled local Codex plugin in source order. A declared catalog preserves its plugin-entry order and can include reviewed OpenAI-native entry settings under `codex`:

```yaml
marketplaces:
  outfitter:
    title: Outfitter plugins
    targets: [codex]
    plugins:
      - plugin: local-tools
        codex:
          policy:
            installation: AVAILABLE
            authentication: ON_INSTALL
      - plugin: remote-tools
        repo: github:outfitter-dev/remote-tools
        ref: main
        codex:
          source:
            source: git-subdir
            url: https://github.com/outfitter-dev/remote-tools.git
            path: ./plugins/remote-tools
            ref: main
```

The generated native source union is closed:

| `source` | Required fields | Optional fields | Meaning |
| --- | --- | --- | --- |
| `local` | `path` | — | Materialized plugin directory in this repository |
| `url` | `url` | `path`, `ref`, `sha` | Plugin at a Git repository root or optional subpath |
| `git-subdir` | `url`, `path` | `ref`, `sha` | Plugin below a Git repository root |
| `npm` | `package` | `version`, `registry` | JavaScript package-registry source |

Local generated paths start with `./` and resolve from the repository or selected marketplace root, not from `.agents/plugins/`; a bare `./...` value is the shorthand local source form. Git URLs accept HTTPS, SSH/SCP, `github:`, absolute-path, and `file:///` forms. An optional Git `path` starts with `./` and is repository-root-relative; `git-subdir` requires it. Npm registry URLs must be credential-free HTTPS; Git credentials stay in ordinary Git configuration and are never copied into generated diagnostics or evidence.

`policy.installation` accepts `AVAILABLE`, `INSTALLED_BY_DEFAULT`, or `NOT_AVAILABLE` and defaults to `AVAILABLE`. `policy.authentication` accepts `ON_INSTALL` or `ON_USE` and defaults to `ON_INSTALL`. Omitted `policy.products` means unrestricted; an explicit empty list remains an explicit deny-all. Product values are `atlas`, `chatgpt`, and `codex` in Skillset source and render to the native uppercase values.

The configured entry `id` becomes the native catalog `name`; without one, it defaults to `plugin`. For local entries, the materialized package manifest supplies version, description, keywords, author, and homepage. Catalog source can supply remote fallbacks and owns category, policy, and reviewed nested `interface` overrides. A legacy entry `displayName` is accepted only as input and normalizes to `interface.displayName`. Local interface assets must resolve to contained files materialized under the package's `assets/`, `scripts/`, or `src/` roots. Remote Git and npm entries omit path-based `composerIcon`, `logo`, `logoDark`, and `screenshots`, because a catalog listing cannot make those paths portable. Catalog metadata never redirects package-owned skills, MCP servers, apps, or hooks.

[OpenAI's administrator import documentation](https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github) also describes entry `pluginId` for moving an existing workspace plugin under GitHub marketplace management. That is a workspace migration identifier, not part of Skillset's SET-530 source mapping; use the administrator workflow when that migration is required.

## Build Local Plugin Output First

Preview, write, and verify the provider bundles owned by the current repository:

```bash
skillset build
skillset build --yes
skillset check --only outputs
```

Catalog declaration and source resolution are not enough. Every selected entry must also be [renderable](../glossary.md#render), generated, and verified before Skillset can emit a provider marketplace entry.

The confirmed ordinary build owns `.agents/plugins/marketplace.json` alongside the generated ChatGPT bundles. The file is reproducible output: change `skillset.yaml` or canonical plugin source, rebuild, and review the result instead of hand-editing the catalog.

### Claude local catalog paths

All local provider entries point to the shared package root. With the default placement, `local-tools` uses `./plugins/local-tools`; manifests inside that package select each provider's native metadata. Skillset leaves `metadata.pluginRoot` out when each entry already names its complete source, so consumers do not rebase the path a second time.

An explicit `marketplaces` declaration is also the supported workaround for an older implicit Claude catalog that still contains a generated `metadata.pluginRoot`. Declare the local plugin under a Claude catalog, rebuild, and use the resulting catalog before upgrading the compiler. Do not shorten the source to `./local-tools`: the catalog resolves from the repository root and the generated package remains at `./plugins/local-tools`.

Marketplace entries point to a plugin bundle, not an individual `SKILL.md`. A consumer can select one discovered skill with its `--skill` option. Its default discovery depth and any `--full-depth` expansion remain consumer behavior; Skillset's catalog keeps the plugin boundary and does not promote every nested source file into a catalog entry.

## Check Readiness

Check every catalog or one named catalog:

```bash
skillset marketplace check
skillset marketplace check outfitter --json
```

The command does not write the marketplace repository, provider indexes, external plugin repositories, or runtime settings. External resolution can contact the declared remote and populate or refresh Skillset's owned XDG remote cache. Floating `latest`, `ref`, or `version` policies are resolved again rather than trusting a warm cache; an exact matching `sha` can reuse verified cached evidence.

Ordinary [build](../glossary.md#build) and check commands remain network-free. The generated [`marketplace` reference](../reference/cli/marketplace.md) owns exact command syntax.

## Preview and Write Provider Indexes

Use JSON mode for a guaranteed non-interactive preview. It may resolve external source into the owned cache, but it does not write the catalog index or lock:

```bash
skillset marketplace update outfitter --json
```

Then authorize the reviewed repository writes:

```bash
skillset marketplace update outfitter --yes
```

The confirmed update writes the [provider-native](../glossary.md#provider-native) Claude marketplace index and marketplace provenance in the existing `skillset.lock`. It refuses unresolved source, stale or missing plugin bundles, unsupported targets, and pinned revision mismatches. If an input changes after preview, the transaction is refused instead of applying a stale plan.

Review and commit the index and lock changes. `marketplace update` does not mutate an external plugin repository, publish the marketplace repository, install or trust a plugin, prove [activation](../glossary.md#activation), or write user-level provider configuration.

## Know the Provider Outcomes

An ordinary build renders the ChatGPT catalog at `.agents/plugins/marketplace.json`, Cursor's `.cursor-plugin/marketplace.json`, and supported provider bundles. `marketplace update` remains a deliberate Claude-only workflow: it can write `.claude-plugin/marketplace.json` plus marketplace lock provenance, but it does not write the ChatGPT or Cursor indexes.

Supported local clients discover a repo catalog at `$REPO_ROOT/.agents/plugins/marketplace.json`. `codex plugin marketplace add <source>` is a different operation: it explicitly registers and tracks a local or Git marketplace source in Codex runtime configuration. Generating the repository catalog does not run that command or mutate configuration.

Use the [provider reference](../reference/providers/README.md) and generated [support matrix](../reference/support-matrix.md) for current support instead of inferring parity from the catalog's `targets` list.

## Keep Distribution Separate

A marketplace selects which plugins appear in provider catalog indexes. A [distribution](../reference/features/distributions.md) describes where an already-built rendering could sync after build. Distribution is currently plan-only, and marketplace update is not a substitute sync or publication command.

Catalog generation makes packages discoverable to a compatible consumer. It does not install, trust, enable, activate, register, sync, upload, or publish a marketplace or plugin. Those actions remain explicit provider or administrator workflows with their own authority.

For unresolved repositories, missing targets, stale output, or lock-policy mismatches, start with [troubleshooting](../troubleshooting.md). The exhaustive [marketplace feature reference](../reference/features/marketplaces.md) owns resolution, readiness states, diagnostics, and provenance fields.
