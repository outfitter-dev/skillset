import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestGitFixtureRoot, initializeTestGitRepository } from "../../../../scripts/test-helpers/git-remote";
import { changeCheck } from "../change-entries";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(config: string) {
  const disposableRoot = await createTestGitFixtureRoot("change-reason-policy-");
  roots.push(disposableRoot);
  const root = join(disposableRoot, "repo");
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), config);
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo skill.\n---\nUseful content.\n");
  await writeFile(join(root, ".skillset/changes/abcdef123456.md"), "---\nid: abcdef123456\nbump: patch\nscopes: [skill:demo]\n---\nShort\n");
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}
test("malformed known minimum fails change checking", async () => {
  const content = 'changes:\n  reason:\n    minLength: "2"\n';
  const root = await fixture(content);
  await expect(changeCheck(root, { since: "HEAD" })).rejects.toThrow("minLength must be a positive integer");
});
for (const [config, minimum] of [["{}\n", 40], ["changes:\n  reason: {}\n", 40], ["changes:\n  extra: true\n  reason:\n    minLength: 2\n    extra: true\n", 2], ["changes:\n  reason:\n    minLength: 10\n", 10]] as const) {
  test(`change checking honors configured minimum or default: ${minimum} / ${config}`, async () => {
    const root = await fixture(config);
    const report = await changeCheck(root, { since: "HEAD" });
    const short = report.issues.filter(item => item.code === "change-reason-too-short");
    expect(short).toHaveLength(minimum > 5 ? 1 : 0);
    if (minimum > 5) expect(short[0]?.message).toBe(`reason must be at least ${minimum} characters`);
  });
}
