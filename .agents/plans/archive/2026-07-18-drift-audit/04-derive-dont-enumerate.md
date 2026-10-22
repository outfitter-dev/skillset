# 04 — Hand-enumerated subsets where a derived source of truth exists

The repo has a real single-source spine (`packages/schema/src/contracts.ts` →
`packages/core/src/targets.ts` re-exports; registry evidence feeding
capabilities) and most code uses it. These are the bypasses. The failure shape
is consistent: enumerate literals (often a subset), or if/else with a fallback
branch, instead of importing/iterating the derived structure. Ranked by drift
risk. Cursor-specific instances live in note 01 (01.1-01.4, 01.9); this note
holds the rest plus the prevention mechanism.

### 04.1 — Core config key sets duplicate schema contracts, already diverged (confirmed, HIGH)
- Full detail in note 02.5. The exemplar: same file already imports
  `COMPILE_BUILD_MODES` from schema (`config.ts:2`) while re-hardcoding
  `UNSUPPORTED_DESTINATION_POLICIES` three lines later (:52).

### 04.2 — `SEMVER_PATTERN` defined 4× (confirmed, LOW-MEDIUM)
- `packages/schema/src/contracts.ts:8` (string), `packages/schema/src/validate.ts:33`,
  `packages/core/src/remote-repository-reference.ts:2`,
  `packages/core/src/versioning.ts:15`.
- **Fix:** one canonical string in schema; derive RegExps.

### 04.3 — Retired CLI surface encoded twice: arrays + independent regexes (confirmed, MEDIUM)
- `scripts/cli-contract.ts:17-40` (`RETIRED_CLI_COMMANDS`/`RETIRED_CLI_FLAGS`)
  vs `scripts/cli-surface-guard.ts:14-23` (`RETIRED_SURFACE` regex re-encoding
  the same lists). Retiring/un-retiring requires editing both.
- **Fix:** build the guard regexes from the exported arrays.
- Context: the rest of the CLI parity machinery is well-derived — this is the
  exception, not the rule.

### 04.4 — `targetProjectRoot`/`defaultProjectRoot` ×4 + agent-extension ternary ×2 (confirmed, MEDIUM)
- Detail in note 01.4. Fix home: `targets.ts` helper backed by
  `targetRecord`, mirroring `PROVIDER_SOURCE_DIRS` (`resolver.ts:91`).

### 04.5 — `formatList` copied across 3 packages (confirmed, LOW)
- `packages/core/src/targets.ts:30`, `packages/schema/src/validate.ts:1303`,
  `apps/skillset/src/new-source.ts:471`. Cosmetic drift risk only.

### 04.6 — `DISTRIBUTION_RUNTIME_TARGETS` lockstep map without a coverage guard (confirmed, LOW)
- `packages/core/src/config.ts:58-62` maps targets to a subset of the 8
  `SKILLSET_RUNTIME_IDS` (`feature-registry.ts:44-53`). Genuinely non-derivable
  relation — but a new runtime id is silently un-distributable until the map is
  updated (`readDistributionRuntime` rejects, `config.ts:939-941`).
- **Fix:** coverage test asserting every runtime id appears in exactly one
  target's list (or is explicitly excluded).

### 04.7 — Test-count/output-count expectations baked into prose, not guards (observed, info)
- The retro-style counts ("76 generated outputs", "209-test contract file") are
  fine in retros, and the real guards (`skillset:check:outputs`,
  cli-contract parity) are derived — no action; recorded to close the loop on
  the hunt item.

### 04.8 — Prevention: guard against raw target literals outside designated modules (proposal, the batch-closer)
- The `readProviders` class recurs because nothing stops a new
  `"claude" | "codex"` comparison from compiling. The repo already has
  precedent guards (`terminology-guard`, `cli-surface-guard`,
  `package-ownership-guard`).
- **Direction:** a `target-literal-guard` script: outside an allowlist
  (`contracts.ts`, `targets.ts`, `hook-evidence.ts`, provider-format definition
  files, test files), flag string literals `"claude"|"codex"|"cursor"` used in
  comparisons/arrays. Noisy to bootstrap, cheap to keep. Alternative: oxlint
  custom rule if the guard-script pattern is preferred repo-wide.

### Verified non-findings (precision notes)
- `provider-format-conformance.ts` and `tools-realization.ts:254-303` provider
  literals are legitimate per-provider format/policy definitions, not parallel
  copies.
- Frontmatter key contracts embedding provider keys among unrelated keys is
  inherent to mixed key lists; low priority.

## Batch shape
One "single-sourcing" PR: 04.1 + 04.2 + 04.3 + 04.4 + 04.5 (mechanical,
test-protected), then 04.8 as the guard that keeps it fixed. 04.6 is a
one-test add-on.
