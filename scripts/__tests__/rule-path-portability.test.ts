import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildSkillsetResult } from "@skillset/core";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../test-helpers/git-remote";

test("literal rule directory names survive git add, commit and build", async () => {
  const disposableRoot = await createTestGitFixtureRoot(
    "rule-path-portability-"
  );
  const root = join(disposableRoot, "work");
  const rules = [
    "apps/[.]/src/testing.md",
    "[...]/packages/core/testing.md",
    "app/[slug]/routing.md",
    "app/(marketing)/copy.md",
  ];
  const files: Record<string, string> = {
    "skillset.yaml": "compile:\n  targets: [claude, codex, cursor]\n",
    "apps/api/src/index.ts": "export {};\n",
    "apps/web/src/index.ts": "export {};\n",
    "packages/core/index.ts": "export {};\n",
    "nested/packages/core/index.ts": "export {};\n",
  };
  for (const rule of rules)
    files[`.skillset/rules/${rule}`] = "# Guidance\nKeep tests focused.\n";
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  expect(await initializeTestGitRepository(root, { disposableRoot })).toMatch(
    /^[a-f0-9]{40}$/u
  );
  const tracked = (await runTestGit(root, "ls-files", "-z")).split("\0");
  for (const rule of rules)
    expect(tracked).toContain(`.skillset/rules/${rule}`);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  for (const scope of [
    "apps/api/src",
    "apps/web/src",
    "packages/core",
    "nested/packages/core",
    "app/[slug]",
    "app/(marketing)",
  ]) {
    expect(await readFile(join(root, scope, "AGENTS.md"), "utf8")).toContain(
      "Keep tests focused."
    );
  }
  for (const rule of rules) {
    expect(await Bun.file(join(root, ".claude/rules", rule)).exists()).toBe(
      true
    );
    expect(
      await Bun.file(
        join(root, ".cursor/rules", rule.replace(/\.md$/u, ".mdc"))
      ).exists()
    ).toBe(true);
  }
});
