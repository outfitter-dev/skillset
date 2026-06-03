# Proposals

Design proposals and research notes for not-yet-implemented Skillset work. These
are decision-tier docs (per [Tenets](../tenets.md) → Documentation Tiers): they
explain what is proposed and why, before any implementation. A proposal can be
superseded; the tenets govern it.

- [Agent / Subagent Source Model](agent-source-model.md) (SET-13): research +
  recommendation to defer a portable agent-role abstraction in v1; keep Claude
  `agents/` target-native, Codex agents deferred.
- [Changelog and Versioning](changelog-and-versioning.md) (SET-11): a
  changesets-style changelog/version-bump workflow and a plan for
  `skillset changes`.
- [Global / XDG Managed Installs](global-installs.md) (SET-12): where global
  Skillset state lives and how install/sync stay separate from `build` so build
  never implies trust.
