---
description: Installs Skillset through the native global, Homebrew, GitHub asset, Bun, CI, local dependency, or contributor route with exact runtime requirements.
---

# Install Skillset

For everyday use, install the global `skillset` command once, then invoke it directly in any repository:

```bash
npm install --global skillset
skillset init
```

The npm package installs a small Node launcher plus the native package for the current platform. It does not download code from an install script and does not require Bun.

## Choose a distribution

| Route | Install requirement | Command runtime | Best fit |
| --- | --- | --- | --- |
| npm global native | Node 18 and npm | Node 18 launcher; no Bun | Cross-platform default and a system-wide `skillset` command |
| Homebrew native | Homebrew on macOS | Neither Bun nor Node | Native macOS command managed by Homebrew |
| GitHub native asset | Archive and checksum tools | Neither Bun nor Node | Direct, package-manager-free native installation |
| Bun global | Bun 1.3.14 or newer | Bun 1.3.14 or newer | A global command using the smaller JavaScript distribution |
| Bun one-shot | Bun 1.3.14 or newer | Bun 1.3.14 or newer | CI or occasional use without a global install |
| Bun development dependency | Bun 1.3.14 or newer | Bun 1.3.14 or newer | A repository-pinned CLI version |
| Contributor checkout | Git, curl, and the repository bootstrap | Bun 1.3.14 or newer | Developing Skillset itself |

`@skillset/cli` is the complete Skillset command surface in the slimmer Bun distribution. It is not a reduced CI product. The native and Bun distributions use the same command contract.

## npm global native

```bash
npm install --global skillset
skillset --version
```

The installed `skillset` entry requires Node 18 or newer to select and launch the platform package. The selected compiler executable is native and does not require Bun. Supported packages cover macOS arm64/x64, Linux arm64/x64 glibc, and Windows x64; an unsupported platform fails with an actionable diagnostic instead of downloading a fallback.

## Homebrew native

```bash
brew install outfitter-dev/tap/skillset
skillset --version
```

The formula selects the immutable macOS arm64 or x64 release archive and verifies its checksum. The resulting command requires neither Bun nor Node at runtime. Homebrew installation remains separate from Skillset's repository-output and provider-activation authority.

## Direct GitHub native asset

Download the archive for your platform from the [Skillset releases](https://github.com/outfitter-dev/skillset/releases) page:

- `skillset-v<version>-darwin-arm64.tar.gz`
- `skillset-v<version>-darwin-x64.tar.gz`
- `skillset-v<version>-linux-arm64-glibc.tar.gz`
- `skillset-v<version>-linux-x64-glibc.tar.gz`
- `skillset-v<version>-windows-x64.zip`

Replace `<version>` with the release version. Verify the archive against `skillset-v<version>-SHA256SUMS` and confirm its GitHub attestation with `gh attestation verify <archive> --repo outfitter-dev/skillset`. The release's `skillset-v<version>-manifest.json` records the complete five-target inventory. Extract the one `skillset` executable (`skillset.exe` on Windows) and place it on `PATH`. Direct native execution requires neither Bun nor Node.

## Bun global or one-shot

Install the complete Bun distribution globally:

```bash
bun add --global @skillset/cli
skillset --version
```

Or run it without a persistent install:

```bash
bunx @skillset/cli --version
bunx @skillset/cli init
```

Both routes require Bun 1.3.14 or newer at command runtime.

## Repository development dependency

Pin the complete Bun distribution in a repository when that repository should own the CLI version:

```bash
bun add --dev @skillset/cli
bunx @skillset/cli init
```

Use the global native command for the shortest interactive path. Use a development dependency when lockfile-level reproducibility matters more than a system-wide command.

## Continuous integration

The smaller CI download is the Bun distribution:

```bash
bunx @skillset/cli check --ci
```

If the runner already uses Node and native startup is preferred, install the native npm route instead:

```bash
npm install --global skillset
skillset check --ci
```

Pin the chosen package version in production CI. See [Continuous Integration](../guides/continuous-integration.md) for the generated workflow and repair boundary.

## Develop Skillset itself

From a contributor checkout, use the repository bootstrap. It installs the pinned Bun version when needed, installs dependencies, and runs repository setup:

```bash
./scripts/bootstrap.sh repo
bun run check
```

Contributor bootstrap and repository development require Bun; installing or running a released native compiler does not.

## Installation is not activation

Installing the compiler only makes the `skillset` command available. `skillset build --yes` writes reviewed provider-native files inside the repository; it still does not enable them in a provider or change user-level configuration.

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](build-versus-activation.md).
