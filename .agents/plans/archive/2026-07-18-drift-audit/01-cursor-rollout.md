# 01 — Cursor first-class rollout is half-landed

The largest drift cluster. Cursor was made a default compile target
(`DEFAULT_TARGET_NAMES` includes it, `packages/schema/src/contracts.ts:11-12`)
and the registry/feature-registry treat it as first-class — but multiple code
paths, docs, and the governing ADR itself lag. Every finding here is the same
event: a three-provider cutover that stopped at two in scattered places.

## Code gaps

### 01.1 — `readProviders` drops `cursor` from hook-attachment provider lists (confirmed, HIGH — [SET-314](https://linear.app/outfitter/issue/SET-314/fix-readproviders-silently-dropping-cursor-from-hook-attachment-provider-lists))
- `packages/core/src/adaptive-hook-attachments.ts:127-131` filters with
  `item === "claude" || item === "codex"`.
- Schema accepts all three (`packages/schema/src/validate.ts:1055-1102` uses
  `targetNames`). Definition-level reader is correct
  (`packages/core/src/resolver.ts:704` via `isTargetName`).
- Amplifier: `adaptive-hook-classifier.ts:134-136` treats missing providers as
  "all targets" — so `providers: ["cursor"]` becomes **all providers** (opposite
  of intent) and `["claude","cursor"]` silently loses cursor. No diagnostic.
- **Fix:** `value.filter(isTargetName)`. Regression test for cursor-only
  attachment.

### 01.2 — `_cursor` island source dir is documented but never loaded (confirmed, HIGH)
- `PROVIDER_SOURCE_DIRS` defines `cursor: "_cursor"`
  (`packages/core/src/resolver.ts:91-95`) and `feature-registry.ts:961`
  documents `.skillset/_cursor/**` as valid sourceShape; the legacy-layout
  rejector iterates all three.
- But `loadProjectIslands` (`resolver.ts:366-376`) calls `loadTargetIsland` only
  for claude and codex — at project AND plugin scope. Files in `_cursor/` are
  silently ignored.
- **Fix:** loop `targetNames()` in the loader — or, if cursor islands are
  deliberately unsupported, remove cursor from `PROVIDER_SOURCE_DIRS` and the
  documented sourceShape and add an explicit diagnostic. Decide which.

### 01.3 — `CURSOR_NATIVE_EVENT_BY_CANONICAL` hand-maintained; falls back to wrong casing (confirmed, HIGH)
- `packages/core/src/hook-capabilities.ts:74-98` hardcodes the 23-entry
  canonical↔lowerCamel map; registry already owns the canonical list
  (`packages/registry/src/hook-evidence.ts:193-215`) with the note
  "native-event-names-are-lower-camel" (mechanical `lowerFirst`).
- `nativeHookEventName` falls through `?? event`, so a registry-added cursor
  event renders **PascalCase into Cursor `hooks.json`** — silently malformed
  provider output.
- **Fix:** derive from `CURSOR_HOOK_EVIDENCE.events` + `lowerFirst`; delete the
  literal map.

### 01.4 — `?? ".cursor"` else-branch fallbacks in 4 copies of target→root mapping (confirmed, MEDIUM)
- `targetProjectRoot` duplicated at `packages/core/src/render.ts:1222-1227`,
  `packages/core/src/render-result-collector.ts:769-771`,
  `apps/skillset/src/test-runner.ts:1296-1298`; `defaultProjectRoot` at
  `packages/core/src/resolver.ts:1428-1431`. All end in a `: ".cursor"` else —
  any future 4th target silently maps to `.cursor`.
- Adjacent: agent extension `codex ? "toml" : "md"` duplicated at
  `resolver.ts:1425` and `test-runner.ts:1281`.
- **Fix:** one `targetRecord`-derived helper in `targets.ts` (see note 04 — this
  is also a derive-don't-enumerate finding).

## Governance gap

### 01.5 — Cursor is default-enabled while its ADR draft explicitly forbids that (confirmed, decided-needed, HIGH)
- `DEFAULT_TARGET_NAMES = TARGET_NAMES` (`packages/schema/src/contracts.ts:11-12`);
  `docs/target-surfaces.md:66` says Cursor participates in the default plan.
- `docs/adrs/drafts/20260702-cursor-is-a-first-class-provider.md` (status:
  draft) states it "does not make Cursor the default target… That default
  belongs to the final parity gate."
- Tenet tension: several Cursor tools-policy realizations are metadata-only /
  advisory (`packages/core/src/tools-realization.ts:254-303`), so default
  derivation can emit weaker-than-native output the author didn't request.
- **Decision needed:** either declare the parity gate met and amend+promote the
  ADR, or pull cursor from `DEFAULT_TARGET_NAMES` until it is. Everything else
  in this note is mechanical; this one is the product call.

## Docs gaps (feature-doc target tables lag Cursor; details in note 03)

### 01.6 — Significant: `commands.md`, `hooks.md`, `skills.md`, `instructions.md`, `layout.md` (rendering sections), `quickstart.md` build-output listings (confirmed)
- All present Claude+Codex as the whole story while cursor rows exist in
  `feature-registry.ts` (e.g. commands cursor `pass_through` :440-444, skills
  cursor `native` :632-642/:928-938, instructions cursor `transformed` :714-718).
- `quickstart.md:88-113` never mentions that a fresh build also writes
  `.cursor/skills/...` — first-run surprise.

### 01.7 — Moderate: `agents.md`, `mcp-servers.md`, `resources.md`, `plugins.md` (confirmed)

### 01.8 — Minor: `marketplaces.md`, `executables.md` (cursor bin unsupported is undocumented), `target-native-islands.md` support table (confirmed — note 01.2 decides what's true for islands)

### 01.9 — Hardcoded "claude, codex, or cursor" strings bypass `TARGET_LIST_TEXT` (confirmed, LOW)
- `packages/core/src/resolver.ts:1166,1169`; `apps/skillset/src/try-cli.ts:131,156`;
  `apps/skillset/src/test-interactive.ts:139`;
  `apps/skillset/src/source-arg-values.ts:34`.
- **Fix:** interpolate `TARGET_LIST_TEXT` (canonical:
  `packages/core/src/targets.ts:12`).

## Batch shape
Decide 01.5 first. Then one sweep: 01.1–01.4 + 01.9 (code), 01.6–01.8 (docs,
largely derivable from `feature-registry.ts` — see note 03.9 for the idea of
generating the target tables). Add the target-literal guard from note 04.8 to
prevent recurrence.
