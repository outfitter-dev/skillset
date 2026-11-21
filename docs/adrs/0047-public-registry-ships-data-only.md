---
id: 47
slug: public-registry-ships-data-only
title: The Public Registry Ships Data Only
status: accepted
created: 2026-11-21
updated: 2026-11-21
owners: ['[galligan](https://github.com/galligan)']
amends: [4, 29]
---

# ADR-0047: The Public Registry Ships Data Only

## Context

The v1 hook catalog has a public, commit-pinned JSON contract. JavaScript consumers need the same facts through a package without installing the compiler, depending on private evidence modules, or adopting Skillset's CLI release cadence.

## Decision

`@skillset/registry` is the external name for a data-only package. The private evidence workspace becomes `@skillset/provider-evidence` in place; its provider facts, import boundaries, and behavior do not change.

The tarball exposes the named ESM export `hooks` with standalone TypeScript declarations, plus `hooks.json` and `hooks.schema.json`. It copies the checked-in v1 artifacts byte for byte. TypeScript models a missing dynamic key as possibly undefined. Importing `hooks` evaluates a data literal; it does not read files, use a network, or load compiler code. Other subpaths are not public.

This amendment defines the external contract and permits local packaging and testing. The package remains private and outside the active seven-package release set until separately qualified and activated. It adds no publishing configuration, credentials, or runtime activation.

## Consequences

Git and package consumers get the same catalog without maintaining two evidence inventories. The archive carries both the raw JSON and its ESM representation so Node 18 and Bun can import data without filesystem access or runtime-specific JSON module syntax. Pack checks install the real archive in empty consumers and compare its files with Git.

## References

- [Core Library and CLI Boundary](0004-core-library-boundary.md#decision) — adds one narrow external data contract without exposing the compiler.
- [Global CLI and Native Distribution](0029-global-cli-native-distribution.md#each-package-has-one-role) — distinguishes the registry contract from the CLI release set.
- [Skillset Design Tenets](../project/tenets.md#public-output-stays-closed) — keeps public data independent of contributor-only code.
