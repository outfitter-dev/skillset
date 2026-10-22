---
"skillset": patch
"@skillset/cli": patch
---

Source move and pending-change fixes:

- Releasing a reason after `skillset move` retires the old selector from the moved skill's own version instead of the workspace version, so a skill released at 1.2.3 no longer records its retirement as `0.1.0 -> 0.1.1`.
- Moving a skill out of a plugin no longer leaves the source plugin (`plugin:<name>`) uncovered in `change check` and `change refresh`.
- Moving a skill onto a selector that an earlier move in the same release window vacated now associates the removal with the pending reason instead of blocking check, refresh, and release.
- Recovery guidance offers `skillset change migrate` when a legacy entry's only error is stale evidence, since migration succeeds in that case.
- Rewriting authored YAML on move or rename keeps flow lists such as `scopes: [x]` and their comments instead of turning them into block lists.
