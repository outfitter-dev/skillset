import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { buildSkillset, verifySkillsetResult } from "@skillset/core";

import { addChangeEntry } from "../change-workflow";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";

const REPO_ROOT = join(import.meta.dir, "../../../..");

// ADR-0045 conformance: two branches that change different source units, each
// rebuilt and recorded with a change entry, merge with git's ordinary text
// merge under this repository's own .gitattributes. The result needs no
// `skillset resolve`: it verifies, rebuilding it changes nothing, and change
// coverage still passes. Both merge directions and a restack are checked,
// because GitHub's server-side merge, a local merge, and `gh stack rebase`
// each see the branches from a different side.
test("ADR-0045 branches that change different units merge as plain text", async () => {
  const root = await fixture();

  for (const direction of [
    ["edit-a", "edit-b"],
    ["edit-b", "edit-a"],
  ] as const) {
    const [into, from] = direction;
    await runTestGit(root, "switch", "--quiet", "--detach", into);
    await runTestGit(root, "merge", "--quiet", "--no-edit", from);
    await expectCleanMergedTree(root);
  }

  await runTestGit(root, "switch", "--quiet", "-c", "restacked", "edit-b");
  await runTestGit(root, "rebase", "--quiet", "edit-a");
  await expectCleanMergedTree(root);
});

async function expectCleanMergedTree(root: string): Promise<void> {
  expect(await runTestGit(root, "ls-files", "--unmerged")).toBe("");
  expect((await verifySkillsetResult(root)).ok).toBe(true);
  const before = await runTestGit(root, "rev-parse", "HEAD^{tree}");
  await buildSkillset(root);
  await runTestGit(root, "add", "--all");
  expect(await runTestGit(root, "write-tree")).toBe(before);
  const check = await runCli("change", "check", "--root", root, "--since", "base");
  expect(check.exitCode, check.stderr).toBe(0);
}

async function fixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot("skillset-plain-merge-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await writeFile(join(root, ".gitattributes"), await readFile(join(REPO_ROOT, ".gitattributes"), "utf8"), "utf8");
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: plain-merge\n  version: 0.1.0\nclaude: true\ncodex: true\ncursor: false\n",
    "utf8"
  );
  for (const name of ["alpha", "beta", "gamma"]) {
    await mkdir(join(root, `.skillset/skills/${name}`), { recursive: true });
    await writeFile(join(root, `.skillset/skills/${name}/SKILL.md`), skill(name, `Baseline ${name}.`), "utf8");
  }
  await mkdir(join(root, ".skillset/plugins/tools/skills/delta"), { recursive: true });
  await writeFile(join(root, ".skillset/plugins/tools/skillset.yaml"), "skillset:\n  name: tools\n  license: MIT\n", "utf8");
  await writeFile(join(root, ".skillset/plugins/tools/skills/delta/SKILL.md"), skill("delta", "Baseline delta."), "utf8");
  await buildSkillset(root);
  await initializeTestGitRepository(root, { disposableRoot });
  await runTestGit(root, "branch", "base");

  await branch(root, "edit-a", [
    { path: ".skillset/skills/alpha/SKILL.md", scope: "skill:alpha", text: skill("alpha", "Alpha from A.") },
  ]);
  await branch(root, "edit-b", [
    { path: ".skillset/skills/gamma/SKILL.md", scope: "skill:gamma", text: skill("gamma", "Gamma from B.") },
    { path: ".skillset/plugins/tools/skills/delta/SKILL.md", scope: "plugin.tools.skill:delta", text: skill("delta", "Delta from B.") },
  ]);
  return root;
}

async function branch(
  root: string,
  name: string,
  edits: readonly { readonly path: string; readonly scope: string; readonly text: string }[]
): Promise<void> {
  await runTestGit(root, "switch", "--quiet", "-c", name, "base");
  for (const edit of edits) {
    await writeFile(join(root, edit.path), edit.text, "utf8");
  }
  await addChangeEntry(root, {
    bump: "patch",
    reason: { kind: "inline", value: `Record the ${name} branch's change in its own pending event file.` },
    scopes: edits.map((edit) => edit.scope),
  });
  await buildSkillset(root);
  await runTestGit(root, "add", "--all");
  await runTestGit(root, "commit", "--quiet", "-m", name);
}

function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill.\n---\n\n${body}\n`;
}

async function runCli(...args: readonly string[]): Promise<{ readonly exitCode: number; readonly stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { exitCode, stderr: `${stderr}${await new Response(proc.stdout).text()}` };
}
