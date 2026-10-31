# @skillset/cli

Bun distribution of the Skillset source-first compiler.

Requires **Bun >=1.4.0** at command runtime. This package provides the complete
`skillset` command surface as a JavaScript bundle for Bun.

Run it without a persistent install:

```bash
bunx @skillset/cli init
```

Or install the command globally with Bun:

```bash
bun add --global @skillset/cli
skillset init
```

For a repository-pinned version:

```bash
bun add --dev @skillset/cli
bunx @skillset/cli check --ci
```

Pin the package version in production CI. The Bun package and native distribution
share the same command contract; this is not a reduced CI edition.

For the native distribution, which does not require Bun, use
`npm install --global skillset`. Its npm launcher requires Node 18 or newer.

Skillset compiles reusable agent skills, rules, and plugin source into portable
artifacts with provider-native output for Claude, Codex, and Cursor. Builds do
not install, trust, or activate provider configuration.

- [Installation routes](https://github.com/outfitter-dev/skillset/blob/main/docs/start/installation.md)
- [Getting started](https://github.com/outfitter-dev/skillset/blob/main/docs/start/quickstart.md)
- [Source and documentation](https://github.com/outfitter-dev/skillset)
- [Report a bug](https://github.com/outfitter-dev/skillset/issues)
