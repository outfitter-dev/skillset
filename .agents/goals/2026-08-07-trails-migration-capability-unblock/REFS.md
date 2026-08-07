# References: Trails Migration Capability Unblock

## Goal Sources

- Objective: `/Users/mg/.codex/attachments/a1b87c56-8269-4771-8eca-828985bcd901/goal-objective.md`
- Repository guidance: `AGENTS.md`
- Goal-loop procedure: `/Users/mg/.agents/skills/goal-loop/SKILL.md`
- Local-review procedure: `/Users/mg/.agents/skills/local-review/SKILL.md`
- Graphite procedure: `/Users/mg/.agents/skills/graphite/SKILL.md`
- Skillset development procedure: `.agents/skills/skillset-codex-development/SKILL.md`

## Skillset Work

- SET-396: https://linear.app/outfitter/issue/SET-396/preserve-provider-native-project-agent-references-to-unmanaged-skills
- PR #393: https://github.com/outfitter-dev/skillset/pull/393
- Branch: `set-396-preserve-provider-native-project-agent-references-to`
- Pre-restack head: `05bc116dc45cef36a3861d805c6a3455abc0eabe`
- Final implementation/evidence head before horizon amendment: `b10d3019ef3556688409f7eff0b08ea398df2883`
- Final implementation fix: `752b04c236bd9108c09e126f5132caa075d6ad2b`
- SET-394: https://linear.app/outfitter/issue/SET-394/preserve-executable-modes-in-generated-resource-and-plugin-files
- PR #395: https://github.com/outfitter-dev/skillset/pull/395
- Branch: `set-394-preserve-executable-modes-in-generated-resource-and-plugin`
- Pre-restack head: `c4dbecc3b78d8194723d92c2d4ecc80b8d50af4b`
- Final implementation head: `0567db91d7e93ba9d803f06cf610fed1d4335e11`
- Preflight main: `4ae1177a9ed1823cfb049643b09f923347f337a4`
- npm preflight: `skillset@0.22.0`

## Downstream Contract Evidence

- Trails PR #992: https://github.com/outfitter-dev/trails/pull/992
- TRL-1271: https://linear.app/outfitter/issue/TRL-1271/prove-trails-agent-output-parity-with-standalone-skillset
- TRL-1272: https://linear.app/outfitter/issue/TRL-1272/adopt-canonical-skillset-source-and-lock-provenance-for-trails-agents
- TRL-1273: https://linear.app/outfitter/issue/TRL-1273/cut-trails-skill-sync-and-checks-over-to-standalone-skillset
- TRL-1274: https://linear.app/outfitter/issue/TRL-1274/move-trails-repo-local-plugin-projections-onto-skillset
- TRL-1275: https://linear.app/outfitter/issue/TRL-1275/project-warden-derived-agent-guidance-through-skillset

## Verification Commands

- `/Users/mg/.agents/skills/goal-loop/scripts/check-goal-prompt --no-placeholders <packet>/PROMPT.md`
- `/Users/mg/.agents/skills/goal-loop/scripts/goal-loop-doctor <packet>`
- `bun run test:focused -- <affected-test-files>`
- `bun run typecheck`
- `bun run schema:check`
- `bun run skillset:check`
- `bun run skillset:check:outputs`
- `bun run skillset:check:ci`
- `bun run conformance:fast`
- `bun run changeset:check`
- `bun run package-ownership:guard`
- `bun run terminology:guard`
- `bun run target-topology:guard`
- `bun run check`
- `bun run hooks:pre-push`
- `git diff --check`
