import { expect, test } from "bun:test";

import { contractFixture, runSkillsetCli } from "./contract-test-helpers";

test("SET-732: explain marks never-written outputs, names the blocker, and lists configured targets only", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: explain-output-state
compile:
  targets:
    - claude
    - codex
`,
    ".skillset/plugins/toolkit/skillset.yaml": `
skillset:
  name: toolkit
`,
    ".skillset/plugins/toolkit/hooks/hooks.json":
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo pre"}]}]}}\n',
  });

  const explain = await runSkillsetCli("explain", "plugins/toolkit/hooks/hooks.json", "--root", root);
  expect(explain.exitCode).toBe(0);
  expect(explain.stdout).toContain("    bundle file: plugins/toolkit/hooks/hooks.json");
  expect(explain.stdout).toContain("    target state: planned (not written)");
  expect(explain.stdout).not.toContain("target state: sync");
  expect(explain.stdout).toContain("  blocked by:");
  expect(explain.stdout).toContain("plugin-hooks -> hooks unsupported");
  expect(explain.stdout).not.toContain("plugin-manifests -> plugin-manifest rendered");
  expect(explain.stdout).not.toMatch(/^ {4}cursor: /mu);
});
