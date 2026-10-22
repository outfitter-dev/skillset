import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

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

test("SET-732: explain reports a deleted bundle file as not written even when its manifest exists", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: explain-bundle-member
compile:
  targets:
    - claude
    - codex
`,
    ".skillset/plugins/toolkit/skillset.yaml": `
skillset:
  name: toolkit
  description: "Toolkit plugin container."
`,
    ".skillset/plugins/toolkit/README.md": "# Toolkit\n",
  });
  const build = await runSkillsetCli("build", "--yes", "--root", root);
  expect(build.exitCode).toBe(0);
  await rm(join(root, "plugins/toolkit/README.md"));

  const explain = await runSkillsetCli("explain", "plugins/toolkit/README.md", "--root", root);
  expect(explain.exitCode).toBe(0);
  expect(explain.stdout).toContain("    bundle file: plugins/toolkit/README.md");
  expect(explain.stdout).toContain("    target state: planned (not written)");
  expect(explain.stdout).not.toContain("target state: sync");
});
