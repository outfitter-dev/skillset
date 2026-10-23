---
id: 44
slug: machine-scope-lifecycle-commands
title: Machine-Scope Lifecycle Commands
status: accepted
created: 2026-10-22
updated: 2026-10-22
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 22, 27, 29, declarative-user-scope-config]
amends: [22, 29]
---

# ADR-0044: Machine-Scope Lifecycle Commands

> Accepted 2026-10-22 as written. Implementation is owned by SET-473 (`install`), SET-479 (`doctor`), and SET-480 (`upgrade`).

## Context

[ADR-0029](0029-global-cli-native-distribution.md#global-installation-is-the-front-door) made a global `skillset` the front door, and the [beta release record](../project/plans/beta-release.md) (Section 04) decided that a Skillset-native command family should own the machine lifecycle around it: placing companion guidance for providers, bringing Skillset and that guidance current together, and inspecting what is installed. Two accepted records stand in the way.

- [ADR-0022](0022-workflow-oriented-cli.md#final-command-roster) fixes the public roster at 25 commands. It has no `install` or `upgrade`, and it [removed `doctor`](0022-workflow-oriented-cli.md#inspection-commands-have-explicit-boundaries) when `status` became the workspace health view.
- [ADR-0029](0029-global-cli-native-distribution.md#what-this-does-not-decide) leaves "a future native self-update command" undecided, and its non-goals include "a general self-update system" and "automatic installation, activation, trust, or user-level provider mutation".

Without a decision, each surface reaches for its own verb. Users already see `update` for provider and compiler format migrations inside a repository. An `update` that also upgraded Skillset would give one key two meanings, against the [one meaning, one key](../project/tenets.md) tenet. The user-scope work in the [Declarative User-Scope Config](drafts/20260604-declarative-user-scope-config.md) draft also writes into provider user directories, so this decision has to say what the machine family owns there and what it does not.

## Decision

Skillset adds a three-command machine-scope family: `install`, `upgrade`, and `doctor`. They act on the machine and its companion integrations, never on a workspace.

### Upgrade is for Skillset, update is for managed objects

- `upgrade` brings Skillset itself and its companion tooling current.
- `update` keeps its ADR-0022 meaning: registered, source-preserving provider and compiler format migrations for the objects a workspace manages.

The test: if the command changes which Skillset version or companion integration is on the machine, it is `upgrade`. If it changes generated or managed objects inside a workspace, it is `update` (or `build`, `reconcile`, or `resolve`, per ADR-0022's drift owners).

### Install places companion guidance through a channel

`skillset install` places companion guidance for a provider through one explicit channel: the provider's own plugin installation, where that provides the complete experience, or a Skillset-owned direct copy. It previews the exact effects, including any provider-native command it would run, and writes only after confirmation. Direct copies are recorded in a companion-channel ownership ledger and are reversible. Symlinks are excluded.

### Upgrade delegates to the installing channel, then verifies

`skillset upgrade` does three things, in order:

1. Detect the channel that installed Skillset (npm global, Homebrew, or a Bun global install) and run that channel's own upgrade command after preview and confirmation. A direct-archive install gets advisory output instead, described below.
2. Bring each companion integration recorded by `install` to the version that matches the new Skillset.
3. Verify by reporting the resulting `skillset --version` and the same facts `doctor` reports.

A direct-archive install from GitHub release assets has no package channel to delegate to. For that install, `upgrade` reports the installed and latest versions, the archive and checksum to fetch, and the manual replacement steps, and writes nothing to Skillset's own executable. It still upgrades recorded companion integrations.

Skillset never downloads or replaces its own executable. This settles ADR-0029's open self-update question without adding the general self-update system ADR-0029 rules out: the package channel stays the only thing that writes Skillset's binary.

### Doctor inspects the machine, read-only

`skillset doctor` reports machine-level availability, version compatibility, the installing channel, and companion-integration ownership. It never writes. It does not judge workspace readiness: `check` remains the readiness gate and `status` the workspace health view, as ADR-0022 decided.

Bringing the name back is deliberate, but its meaning changes: the retired `doctor` was a workspace view, and the new one is machine-scope only. `doctor` stays on the CLI's retired-command list until the machine-scope command ships, so no documentation describes it before then.

### Scope of mutation

`install` and `upgrade` own **companion-channel installation and upgrade operations**. They do not hold exclusive write authority over every provider discovery directory.

| Surface | Owner |
| --- | --- |
| Companion guidance placed by plugin or direct copy | `install`, `upgrade` |
| Skillset's own executable | the installing package channel, invoked by `upgrade` |
| Declared user-scope source rendered into provider user directories | `sync --user` ([Declarative User-Scope Config](drafts/20260604-declarative-user-scope-config.md), SET-560) |
| Unmanaged skills brought under management | `adopt` (SET-563) |
| Global report bundles, XDG caches, and state | their own commands |
| Rootless `lookup`, and new workspaces through `create` and `init` | their own commands |

Each owner writes only the files it records, under its own ownership ledger. Source-render ownership and companion-channel ownership never claim the same path; a collision fails before writing.

### Boundaries that do not move

Installing a companion integration does not build a workspace, trust a plugin, activate a runtime, or edit provider settings ([ADR-0027](0027-runtime-activation-readiness-is-observational.md)). Plugin installation, CLI availability, repository initialization, generated output, and runtime activation stay separate states and are described separately.

### Amendments

- **ADR-0022, final command roster:** add a Machine area with `install`, `upgrade`, and `doctor`, for 28 public commands. The rule that `status` replaces the workspace `doctor` still holds; the new `doctor` is machine-scope only.
- **ADR-0029, What This Does NOT Decide:** the native self-update question is settled by `upgrade` delegating to the installing channel. The non-goal "a general self-update system" stands.

## Consequences

### Positive

- One verb per job: `upgrade` for the tool and `update` for managed objects, so neither help text needs a disclaimer.
- Users get a supported path to companion guidance when a provider plugin is unavailable, without symlinks or silent provider writes.
- Upgrades stay in the channel that installed Skillset, so npm, Homebrew, and Bun keep their own integrity checks and rollback.

### Tradeoffs

- The public roster grows by three commands after ADR-0022 cut it down on purpose.
- `doctor` returns with a different meaning from the command ADR-0022 removed, so old notes that mention it describe something else.
- Channel detection is a new maintenance surface: each supported channel needs an upgrade recipe and a test.

### Risks

- A machine-scope `doctor` could drift back into workspace readiness. Mitigation: it does not read workspace config, and `check` and `status` own every workspace fact.
- Companion ownership and user-scope render ownership could both claim a provider directory. Mitigation: each command writes only paths its own ledger records, and collisions fail before writing.

## Non-Decisions

- The companion-channel ledger format and where it lives under XDG state.
- The exact provider plugin commands each channel runs; those come from pinned provider evidence.
- Removal grammar, which follows once `install` ships.
- The terminology-guard rule that rejects an `update` used for self-upgrade.

## References

- [ADR-0022: Workflow-Oriented CLI With A Flat Loop And Explicit Domains](0022-workflow-oriented-cli.md) - roster amended to add the Machine area.
- [ADR-0027: Runtime Activation Readiness Is Observational](0027-runtime-activation-readiness-is-observational.md) - installation does not imply activation or trust.
- [ADR-0029: Global CLI and Native Distribution](0029-global-cli-native-distribution.md) - self-update question settled by channel delegation.
- ADR: Declarative User-Scope Config (draft) - owns `sync --user` writes into provider user directories.
- [Beta release decision record](../project/plans/beta-release.md) - Section 04 machine-lifecycle decision.
- [Tenets](../project/tenets.md) - one meaning, one key; builds do not imply trust.
