# Skillset Plugin

This plugin teaches your coding agent how to use [Skillset](https://github.com/outfitter-dev/skillset), a compiler that turns one source tree of skills, rules, agents, hooks, and plugins into native Claude, Codex, and Cursor output.

## Install the CLI

The skill drives the `skillset` command line tool. Install it from npm:

```bash
npm install --global skillset
skillset --version
```

Homebrew, Bun, and per-repository installs are covered in the [installation guide](https://github.com/outfitter-dev/skillset/blob/main/docs/start/installation.md).

## What the skill covers

The `use-skillset` skill tells the agent how to:

- set up a workspace with `skillset init` and add skills, rules, agents, hooks, and plugins with `skillset new`;
- preview and write generated output with `skillset build` and `skillset build --yes`, and verify it with `skillset check`;
- repair stale, missing, or hand-edited generated files with `skillset build --repair`, `skillset resolve`, and `skillset restore`;
- record changes and cut releases with `skillset change` and `skillset release`;
- import existing provider skills and plugins, and check marketplace catalogs.

The plugin never installs, trusts, or enables anything in your user-level agent config.
