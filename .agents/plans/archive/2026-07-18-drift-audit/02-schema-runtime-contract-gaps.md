# 02 — Schema accepts what runtime rejects, ignores, or never reads

The recurring contract failure: `@skillset/schema` validates a shape, then core
either throws later, classifies it unsupported, or silently never reads it.
Violates the tenet "drift should become visible early" — the author gets a
green validation and a dead or exploding config. The fixed hook-only-flags
silent-discard bug (SET-310 feedback round) was this class; these are the
remaining live instances.

### 02.1 — Adaptive-hook provider-override blocks: schema-accepted, render-rejected "not supported yet" (confirmed, HIGH, decided-needed)
- Schema allows unit-level `claude:/codex:/cursor:` override objects
  (`packages/schema/src/validate.ts:423-432`); classifier rejects any use
  (`packages/core/src/adaptive-hook-classifier.ts:184-192`).
- This is also the architectural landing spot for "happy path + explicit
  per-provider divergence" (e.g. `events: [SessionStart]` +
  `cursor: {events: [workspaceOpen]}`) — finishing override rendering is the
  alternative to ever building an event-equivalence table (per
  `docs/tenets.md:46` "honestly provider-specific over falsely unified").
- **Direction:** finish it (preferred, unlocks the intent-level authoring
  model) or remove from schema until it renders.

### 02.2 — Adaptive-hook `run.args`/`run.cwd`/`run.env`/`run.script` per-surface gaps (confirmed, MEDIUM)
- Schema `run` allows `args/command/cwd/env/script`
  (`packages/schema/src/validate.ts:1156`); classifier rejects `run.args`/`run.cwd`
  everywhere and `run.env`/`run.script` on the frontmatter surface
  (`adaptive-hook-classifier.ts:195-208`).
- Authoring-time rejection now exists for the CLI path (07-18 fix), but
  hand-written source can still validate then classify unsupported.
- **Direction:** either surface-aware schema validation, or keep runtime
  rejection but ensure `skillset check` reports it as an error, not a silent
  non-render.

### 02.3 — Adaptive-hook `status:` key parsed, stored, never consumed (confirmed, MEDIUM)
- Accepted at `packages/schema/src/validate.ts:423,426`; attachment-level parsed
  into `SourceHookAttachment.status` (`adaptive-hook-attachments.ts:114,123`,
  `types.ts:135`). Zero readers. Unrelated to the classifier's computed
  `AdaptiveHookIntentStatus`.
- **Direction:** delete from schema+types, or wire to gating/diagnostics.

### 02.4 — `codex: { mode: "symlink" }` schema-valid, resolver-throws (confirmed, MEDIUM)
- `packages/core/src/resolver.ts:625-632` throws "not supported yet" on a shape
  `checkTargetBlock` (`validate.ts:792`) accepts. The string-form half of the
  same condition is unreachable for validated source (schema rejects it).
- **Direction:** implement symlink projection or reject in schema; drop the dead
  string branch.

### 02.5 — Core re-hardcodes workspace key sets and has already diverged from schema (confirmed, HIGH)
- Schema `WORKSPACE_CONFIG_KEYS` includes `skillset` and `supports`
  (`packages/schema/src/contracts.ts:25-39`); core
  `WORKSPACE_CONFIG_TOP_LEVEL_KEYS` (`packages/core/src/config.ts:49`) omits
  both. Core's set wins at validation time
  (`config.ts:507-529` emits its own error AND suppresses schema diagnostics at
  :526) — so the two contracts disagree about the same file today.
- Sibling literals: `CONFIG_TOP_LEVEL_KEYS` (:46), `UNSUPPORTED_DESTINATION_POLICIES`
  (:52, identical constant exists in schema `contracts.ts:14`), `SOURCE_ONLY_KEYS`
  (:62). `COMPILE_BUILD_MODES` (:50) is already correctly imported — the pattern
  exists, it's just inconsistently applied.
- **Fix:** import schema contract arrays; build Sets from them; delete locals.
  Determine which of `skillset`/`supports` is actually valid at workspace level
  and make both packages say the same thing.

### 02.6 — Test `output.kind` is a single-value mode (confirmed, LOW)
- Schema pins `kind: {const: "isolated"}` (`packages/schema/src/contracts.ts:367`);
  runner rejects anything else (`apps/skillset/src/test-runner.ts:538-547`). A
  config object encoding zero choice.
- **Direction:** delete until a second mode exists.

### 02.7 — `reconcile` output-wins silently drops generated-side frontmatter edits (plausible, LOW-MEDIUM)
- `packages/core/src/authoring.ts:293-324`: divergence gate compares bodies
  only; write keeps source frontmatter + generated body. A user edit to the
  generated file's frontmatter vanishes without a diagnostic.
- **Direction:** detect frontmatter divergence → refuse or report (consistent
  with the v1 "clean body edits only" posture in
  `docs/features/source-suggestions.md:24-33`).

## Batch shape
02.5 is the anchor (single-sourcing key sets, pairs with note 04). 02.1 is the
one real design decision. 02.2/02.3/02.4/02.6 are small "finish or delete"
calls that could ride one PR. Consider a meta-guard: a test asserting every
schema-accepted key/shape has at least one consumer or an explicit
`planned`-status diagnostic.
