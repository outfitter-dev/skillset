import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const GUIDANCE_PATHS = [
  ".skillset/plugins/skillset/skills/use-skillset/SKILL.md",
  "plugins/skillset/claude/skills/use-skillset/SKILL.md",
  "plugins/skillset/codex/skills/use-skillset/SKILL.md",
  "plugins/skillset/cursor/skills/use-skillset/SKILL.md",
] as const;

test("runtime activation guidance reserves proof claims for declared tests", async () => {
  for (const path of GUIDANCE_PATHS) {
    const guidance = await readFile(join(ROOT, path), "utf8");
    expect(guidance).toContain(
      "Declared tests can add `activation[].runtime.claims`"
    );
    expect(guidance).toContain(
      "Eval runs cannot declare activation claims or mint proof receipts."
    );
    expect(guidance).toContain(
      "Current structured runtime evidence supports only `mcp-server` claims"
    );
    expect(guidance).not.toContain("eval cases can add `skillset.claims`");
  }

  const featureGuide = await readFile(
    join(ROOT, "docs/reference/features/runtime-activation-readiness.md"),
    "utf8"
  );
  expect(featureGuide).toContain(
    "Cursor account status is not treated as evidence that any particular MCP server is authenticated"
  );
  expect(featureGuide).not.toContain(
    "| Cursor | Authentication | `cursor-agent status --format json`"
  );
  expect(featureGuide).not.toContain(
    "| Cursor | MCP authentication evidence | `cursor-agent status --format json`"
  );
});
