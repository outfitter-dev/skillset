# Skillset Audit Hardening Plan

## Objective

Implement the first hardening slice after the Claude audit of `skillset` and
`agents`: prove the currently unexercised source surfaces with a durable fixture,
then fix the highest-value P1/P2 guardrails found by the audit.

The executor should work in `/path/to/skillset`.

## Background

Claude audit run `2b6f6349` concluded the compiler direction is sound, checks
are green, and generated output fidelity is high. The central risk is that many
implemented surfaces are not exercised by real committed source: hooks, rules,
shared resources, `.mcp.json`, `.app.json`, companion directories, and edge-case
resource/rule behavior.

This packet converts that audit into an implementation goal.

## Scope

Required implementation:

1. Add a committed kitchen-sink fixture in the `skillset` repo that exercises
   plugin source surfaces without polluting the maintainer's real `agents` content.
   Prefer a fixture source tree such as `fixtures/kitchen-sink/` or a similarly
   named test fixture that can be copied into temp dirs by tests.
2. Use the fixture to prove at least these surfaces:
   - plugin-local shared resources, including a custom `from` / `to` mapping;
   - at least one bare prose link affected by that custom mapping;
   - Claude and Codex hook definitions;
   - `.mcp.json`;
   - rules that lower to Claude rules and Codex `AGENTS.md`;
   - one companion directory or file that is target-specific, such as Claude
     `commands/` or Codex `.app.json`, if doing so is safe as opaque content.
3. Add hook target-compatibility lint.
   - Codex-enabled plugin hook definitions must fail on Codex-unsupported events
     or handler types.
   - Claude hook validation may stay broader, but target-specific assumptions
     must be documented and tested.
4. Fix or fail loudly for custom `resources.to` plus bare relative links.
   - Either rewrite the bare link to the custom emitted path or reject the
     ambiguous link with a clear diagnostic.
5. Make generated-state guards fail loudly.
   - Corrupt `.skillset.lock` files must not silently disable stale cleanup or
     unmanaged-overwrite protection.
   - Existing path/surface checks must distinguish missing paths from real file
     system errors where practical.
6. Stabilize lock/hash ordering so it is not dependent on host locale collation.
7. Correct local documentation drift found by the audit:
   - future changelog/version workflow belongs to PAT-52;
   - global/XDG managed installs belong to PAT-47;
   - PAT-43 semver/version drift work should be described as done where
     applicable;
   - matrix rows should distinguish implemented surfaces from aspirational ones
     when the current docs could overpromise.

## Non-Goals

- Do not publish, install, trust, or symlink plugins or skills.
- Do not mutate user-level Claude or Codex config.
- Do not add a remote, push, open a PR, or merge unless the maintainer explicitly asks.
- Do not hand-edit generated outputs as source truth.
- Do not migrate `agents` content, legacy GitButler content, Obsidian skills, or
  global skills.
- Do not design a separate `agents` target.
- Do not implement global/XDG managed installs or changelog generation in this
  slice.

## Design Notes

- Keep the kitchen-sink fixture separate from self-hosted `.skillset/` unless
  there is a strong reason to include it in generated plugin output.
- If fixture output snapshots are used, keep them small and deterministic.
- Prefer a shared path/sort helper over repeating prefix or `localeCompare`
  logic.
- Keep Codex tool policy metadata-only unless a real skill-local permission
  surface is proven by current docs.
- Treat `.app.json` as opaque pass-through; do not synthesize undocumented app
  schemas.

## Suggested Implementation Slices

### Slice 1: Fixture And Reproduction

- Add a committed fixture source tree and tests that build it into a temp repo.
- Reproduce or disprove the custom `resources.to` bare-link issue.
- Record fixture decisions in `RETRO.md`.

### Slice 2: P1 Hook Compatibility Lint

- Add a hook lint module or extend existing lint with target-aware hook checks.
- Use official docs or local snapshots for Codex hook event and handler support.
- Add positive and negative tests.

### Slice 3: P2 Guardrails

- Fix `resources.to` behavior or diagnostics.
- Fail loudly on corrupt lock parsing and real file system errors.
- Stabilize sort ordering for lock/hash inputs.
- Add direct tests for changed behavior.

### Slice 4: Docs And Review

- Update docs and generated self-hosted output if docs or `.skillset/` source
  changed.
- Run full checks.
- Request local review for schema/resolver/render/file safety and target
  fidelity.
- Fix all P0/P1/P2 findings or record evidence-based rejection in `RETRO.md`.

## Validation Ladder

Run narrow checks after each slice where useful:

```bash
bun test
bun run typecheck
bun run skillset:lint
bun run skillset:check
```

Before final handoff, run:

```bash
bun run skillset:build
bun run skillset:check
bun run skillset:lint
bun run typecheck
bun test
bun run check
git diff --check
```

If any check is skipped, record the reason in `RETRO.md`.

## Review Protocol

Before final handoff, request a local review with this shape:

```markdown
Overall score: n/5

Summary:
<short judgment>

Findings:
- P0/P1/P2/P3 - <file:line> - <finding>
  Prompt To Fix With AI:
  <fix prompt>

No-findings statement:
<what was inspected and residual risk>
```

Fix all P0/P1/P2 findings before completion, or record an evidence-based
rejection in `RETRO.md`.

## Stop Rules

Stop and ask the maintainer if:

- official Claude/Codex docs or local snapshots contradict the hook-compatibility
  assumptions;
- a fix would require publishing, installing, trusting, symlinking, or mutating
  user-level config;
- a fixture must be added to the `agents` repo instead of `skillset` to be
  meaningful;
- unrelated verification remains broken after one focused retry;
- three attempts do not shrink the same failing surface.

## Completion Contract

Done means:

- fixture exists and exercises the target surfaces;
- P1 hook compatibility lint is implemented and tested;
- P2 resource, fail-open, sort-order, and doc drift items are fixed or explicitly
  rejected with evidence;
- generated output is fresh if any source change requires it;
- full validation passes or skips are justified;
- local review is recorded;
- `RETRO.md` has final tracker, branch, review, verification,
  forbidden-action, risk, and archive-readiness state.
