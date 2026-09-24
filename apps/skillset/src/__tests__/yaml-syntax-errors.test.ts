import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";

const MALFORMED_MAPPING = "foo: bar: baz\n";

test("SET-648: status names skillset.yaml for malformed workspace config", async () => {
  const root = await fixture({
    "skillset.yaml": MALFORMED_MAPPING,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
  });

  const result = await runSkillsetCli("status", "--root", root);

  expect(result.exitCode).toBe(1);
  expect(combinedOutput(result)).toMatch(
    /skillset\.yaml is not valid YAML:[\s\S]*line 1[\s\S]*column 6[\s\S]*foo: bar: baz/
  );
});

test("SET-648: status names SKILL.md for malformed skill frontmatter", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: yaml-syntax-root
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/demo/SKILL.md": `---\nname: demo\ndescription: [unclosed\n---\n\nBody.\n`,
  });

  const result = await runSkillsetCli("status", "--root", root);

  expect(result.exitCode).toBe(1);
  expect(combinedOutput(result)).toMatch(
    /SKILL\.md is not valid YAML:[\s\S]*line 2[\s\S]*column/
  );
});

test("SET-648: build keeps parser location when workspace YAML is malformed", async () => {
  const root = await fixture({
    "skillset.yaml": MALFORMED_MAPPING,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
  });

  const result = await runSkillsetCli("build", "--root", root);

  expect(result.exitCode).toBe(1);
  expect(combinedOutput(result)).toMatch(
    /skillset\.yaml is not valid YAML:[\s\S]*line 1[\s\S]*column 6/
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-yaml-cli-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function runSkillsetCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

function combinedOutput(result: {
  readonly stderr: string;
  readonly stdout: string;
}): string {
  return `${result.stdout}\n${result.stderr}`;
}
