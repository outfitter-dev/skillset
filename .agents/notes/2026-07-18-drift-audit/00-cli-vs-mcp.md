# 00 — CLI vs MCP: there is no MCP surface

Status: audited 2026-07-18. The suspected "CLI works one way, MCP doesn't match"
drift **cannot exist yet: Skillset ships no MCP server.** Every "MCP" in the
repo is one of two unrelated things, which is itself the finding — the term is
overloaded enough to make maintainers (and audits) assume a surface exists.

## Findings

### 00.1 — "MCP" is overloaded terminology (confirmed, info)
- `mcp-servers` is a **compiled feature**: Skillset copies/validates a plugin's
  `.mcp.json` into generated output (`packages/core/src/render.ts:733`,
  `docs/features/mcp-servers.md`).
- `mcp` is also a **tools-policy aspect** key alongside `read/search/write/shell`
  (`packages/schema/src/validate.ts:31`).
- No `@modelcontextprotocol` dependency anywhere; only bins are `skillset` and
  `skillset-toolkit` (`apps/skillset/package.json:26-31`).
- **Direction:** one-line clarification in `docs/features/mcp-servers.md` or
  `AGENTS.md`: "Skillset does not expose an MCP server; agent automation uses
  `skillset … --json/--jsonl`."

### 00.2 — The agent-automation contract is versioned structured CLI output, by design (confirmed, info)
- `docs/adrs/drafts/20260712-versioned-structured-output-for-cli-automation.md`
  defines `--json`/`--jsonl` envelopes (`skillset.cli.result@1`,
  `skillset.cli.event@1`, `packages/schema/src/contracts.ts:6-7`), exit classes
  0–4, and `CliChange` states `planned|written|skipped|refused`.
- Parity gates (`scripts/cli-contract-parity.ts`, `scripts/cli-surface-guard.ts`)
  enforce contract ↔ help ↔ parser ↔ structured-output agreement across the
  21-command surface.

### 00.3 — Future-MCP guardrail: derive, don't hand-register (decided-needed, forward-looking)
- The parity surface union (`scripts/cli-contract-parity.ts:19`) has no `"mcp"`
  member; nothing would tie a future MCP tool list back to `CLI_COMMANDS`.
- **Direction:** if an MCP surface is ever proposed, derive its tool list from
  `CLI_COMMANDS` + `CLI_ROUTE_FLAGS`, reuse the same core operations and
  `CliChange`/exit-class model, and extend `validateCliContractParity` with an
  `mcp` surface — never a hand-maintained parallel tool registry. Record this as
  a constraint in the structured-output ADR when it's promoted (see note 03).
