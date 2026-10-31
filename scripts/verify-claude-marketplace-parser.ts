import { readFile } from "node:fs/promises";
import { verifyClaudeMarketplaceParserMember } from "../packages/registry/src/claude-marketplace-parser-evidence";

// This maintainer command reads an already-extracted member. It never invokes it.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === undefined) throw new Error("usage: bun scripts/verify-claude-marketplace-parser.ts <extracted-member-path>");
  const result = verifyClaudeMarketplaceParserMember(await readFile(args[0]));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
