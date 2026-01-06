---
name: smoke
description: Run skillset smoke test and analyze findings
---

# Smoke Test Runner

Run the skillset smoke test harness and analyze the results.

## Workflow

1. **Run smoke test**
   - Execute: `bun run test:smoke:ci` (fastest, hook-only validation)
   - Alternative: `bun run test:smoke:cli` for CLI mode
   - Full suite: `bun run test:smoke` (includes Claude + Codex)

2. **Read the report**
   - Reports are at `.skillset-smoke/reports/<runId>/report.json`
   - Find the most recent report by timestamp in `runId`
   - Parse the JSON structure

3. **Analyze findings**
   - Check each step's `status` field: "ok" | "failed" | "skipped"
   - For failed steps:
     - Read `stdoutPath` and `stderrPath` if present
     - Examine `error` field
     - Check `details.evidence` for sentinel validation
   - For successful steps:
     - Verify `details.evidence` shows expected sentinels
     - Confirm skill injection worked

4. **Report results**
   - Summarize overall status (all ok? any failures?)
   - For failures: explain what failed and why
   - For successes: confirm what validated correctly
   - Highlight any unexpected behavior

## Evidence Validation

The smoke test uses sentinel strings to validate skill injection:
- `SENTINEL_ALPHA_123` - from alpha-skill
- `SENTINEL_BETA_456` - from beta-skill

Check `details.evidence` arrays for each step to see if sentinels were found.

## Common Issues

- **Hook failed**: Check if skills were indexed correctly
- **CLI mode failed**: Ensure build completed successfully
- **Evidence missing**: Skill content didn't inject or hook didn't run
- **Timeout**: Increase timeout in smoke script if needed

## Options

Pass arguments to customize behavior:

```bash
bun run test:smoke -- --strict           # Fail on any non-ok
bun run test:smoke -- --no-clean         # Keep previous workspace
bun run test:smoke -- --tools hook       # Run only hook tests
bun run test:smoke -- --hook-mode ci,cli # Both hook modes
```

## Output

Present findings in a clear summary:
- ✅ Steps that passed
- ❌ Steps that failed (with details)
- ⏭️  Steps that were skipped
- Overall status and next actions if failures occurred
