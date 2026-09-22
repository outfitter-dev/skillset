import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../../../scripts/test-helpers/git-remote";

import { changeStatus, moveLegacyBaselinePath } from "../change-status";

test("merges overlapping snapshot trees instead of replacing an existing destination directory", async () => {
  const root = await temporaryRoot();
  const from = join(root, "legacy");
  const to = join(root, "canonical");
  await mkdir(join(from, "skills/demo"), { recursive: true });
  await mkdir(join(to, "skills/other"), { recursive: true });
  await writeFile(join(from, "skills/demo/SKILL.md"), "legacy-demo\n");
  await writeFile(join(to, "skills/other/SKILL.md"), "canonical-other\n");

  await moveLegacyBaselinePath(from, to);

  expect(await readFile(join(to, "skills/demo/SKILL.md"), "utf8")).toBe("legacy-demo\n");
  expect(await readFile(join(to, "skills/other/SKILL.md"), "utf8")).toBe("canonical-other\n");
  await expect(readdir(from)).rejects.toMatchObject({ code: "ENOENT" });
});

test("refuses a file occupying a canonical baseline destination", async () => {
  const root = await temporaryRoot();
  const from = join(root, "legacy");
  const to = join(root, "canonical");
  await mkdir(from);
  await writeFile(join(from, "keep.txt"), "from\n");
  await writeFile(to, "destination-file\n");

  await expect(moveLegacyBaselinePath(from, to)).rejects.toThrow(
    `cannot normalize baseline because ${to} already exists`
  );
  expect(await readFile(to, "utf8")).toBe("destination-file\n");
  expect(await readFile(join(from, "keep.txt"), "utf8")).toBe("from\n");
});

test("renames an absent canonical destination inside owned snapshot state", async () => {
  const root = await temporaryRoot();
  const from = join(root, "legacy");
  const to = join(root, "nested/canonical");
  await mkdir(from);
  await writeFile(join(from, "keep.txt"), "moved\n");

  await moveLegacyBaselinePath(from, to);

  expect(await readFile(join(to, "keep.txt"), "utf8")).toBe("moved\n");
  await expect(readdir(from)).rejects.toMatchObject({ code: "ENOENT" });
});

test("normalizes overlapping git-ref trees only inside a discarded snapshot", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: migrating-root
claude: true
codex: false
`,
    "skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo migrated skill.
version: 0.1.0
---

Legacy workspace body.
`,
    ".skillset/skills/other/SKILL.md": `
---
name: other
description: Already canonical skill.
version: 0.1.0
---

Canonical workspace body.
`,
  });
  await commitFixture(root);
  await rm(join(root, "skillset"), { force: true, recursive: true });
  const liveCanonical = join(root, ".skillset/skills/other/SKILL.md");
  const beforeCanonical = await readFile(liveCanonical, "utf8");

  const status = await changeStatus(root, { since: "HEAD" });

  expect(status.baseline).toMatchObject({ kind: "git-ref", ref: "HEAD" });
  expect(status.sourceChanges.map((change) => change.id).toSorted()).toEqual([
    "skill:demo",
  ]);
  expect(status.sourceChanges[0]).toMatchObject({
    id: "skill:demo",
    status: "removed",
  });
  expect(await readFile(liveCanonical, "utf8")).toBe(beforeCanonical);
});

async function fixture(files: Record<string, string>): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-baseline-disposition-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trimStart().trimEnd()}\n`);
  }
  return root;
}

async function commitFixture(root: string): Promise<void> {
  await initializeTestGitRepository(root, {
    disposableRoot: join(root, ".."),
  });
}

async function temporaryRoot(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-baseline-mover-");
  return mkdtemp(join(disposableRoot, "tree-"));
}
