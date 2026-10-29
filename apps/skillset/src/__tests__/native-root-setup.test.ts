import { expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillset } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { changeStatus, collectSourceInventory } from "../change-status";
import { commitFixture, contractFixture, runGit, runSkillsetCli } from "./contract-test-helpers";
import { createSkillset, initSkillset } from "../setup";

it("init preserves native guidance without scaffolding a competing RULES.md", async () => {
  const root = await createTestFixtureRoot("skillset-native-init-");
  const source = "# Existing guidance\r\n\r\nKeep every byte. {{not_a_skillset_macro}}\r\n";
  await writeFile(join(root, "AGENTS.md"), source);
  const preview = await initSkillset({ rootPath: root, useGitRoot: false });
  expect(preview.nativeAgents).toBe(true);
  expect(preview.files.map((file) => file.path)).not.toContain(".skillset/RULES.md");
  expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
  const result = await initSkillset({ rootPath: root, useGitRoot: false, write: true });
  expect(result.importCandidates.map((candidate) => candidate.path)).not.toContain("AGENTS.md");
  expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("nativeAgents: true");
  await buildSkillset(root);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(source);
});

it("init records native mode in an existing config while retaining comments", async () => {
  const root = await createTestFixtureRoot("skillset-native-existing-init-");
  await writeFile(join(root, "AGENTS.md"), "# Source\n");
  await writeFile(join(root, "skillset.yaml"), "# Keep this note\ncompile:\n  targets: [claude, codex]\n");
  const result = await initSkillset({ rootPath: root, useGitRoot: false, write: true });
  expect(result.files).toContainEqual({ path: "skillset.yaml", status: "update" });
  const config = await readFile(join(root, "skillset.yaml"), "utf8");
  expect(config).toContain("# Keep this note");
  expect(config).toContain("nativeAgents: true");
  expect(await Bun.file(join(root, ".skillset/RULES.md")).exists()).toBe(false);
});

it("init JSON includes native-mode config updates only after confirmed writes", async () => {
  const root = await contractFixture({
    "AGENTS.md": "# Authored\n",
    "skillset.yaml": "compile:\n  targets: [claude, codex]\n",
  });
  const preview = await runSkillsetCli("init", "--root", root, "--json");
  expect(preview.exitCode).toBe(0);
  expect(JSON.parse(preview.stdout).data.writes).toEqual([]);
  expect(await readFile(join(root, "skillset.yaml"), "utf8")).not.toContain("nativeAgents");
  const applied = await runSkillsetCli("init", "--yes", "--root", root, "--json");
  expect(applied.exitCode).toBe(0);
  const result = JSON.parse(applied.stdout).data;
  expect(result.report.files).toContainEqual({ path: "skillset.yaml", status: "update" });
  expect(result.state).toBe("written");
  expect(result.writes).toContain("skillset.yaml");
  expect(result.writes).not.toContain("AGENTS.md");
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# Authored\n");
});

it("create preserves existing native guidance and rejects competing root rules before setup writes", async () => {
  const root = await createTestFixtureRoot("skillset-native-create-");
  await writeFile(join(root, "AGENTS.md"), "# Authored\n");
  await createSkillset({ rootPath: root, useGitRoot: false, write: true });
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# Authored\n");
  expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("nativeAgents: true");
  const conflicting = await contractFixture({
    "AGENTS.md": "# Authored\n",
    ".skillset/rules/root.md": "# Competing\n",
  });
  await expect(initSkillset({ rootPath: conflicting, useGitRoot: false, write: true })).rejects.toThrow("unscoped root rules");
  expect(await Bun.file(join(conflicting, "skillset.yaml")).exists()).toBe(false);
});

it("hashes native source edits against committed and staged baselines", async () => {
  const root = await contractFixture({
    "skillset.yaml": "compile:\n  targets: [codex]\n",
    "AGENTS.md": "# Authored {{literal_macro}}\n",
  });
  await buildSkillset(root);
  await commitFixture(root);
  const before = (await collectSourceInventory(root)).units.find((unit) => unit.id === "rule:RULES");
  expect(before?.sourcePaths).toEqual(["AGENTS.md"]);
  await writeFile(join(root, "AGENTS.md"), "# Edited {{literal_macro}}\n");
  const changed = (await changeStatus(root, { since: "HEAD" })).sourceChanges.find((unit) => unit.id === "rule:RULES");
  expect(changed?.currentHash).toBeDefined();
  expect(changed?.currentHash).not.toBe(before?.hash);
  expect((await changeStatus(root, { since: "HEAD", staged: true })).sourceChanges).toEqual([]);
  await runGit(root, "add", "AGENTS.md");
  expect((await changeStatus(root, { since: "HEAD", staged: true })).sourceChanges).toContainEqual(changed!);
});

it("first build names native guidance and blocked status does not recommend ordinary apply", async () => {
  const root = await contractFixture({
    "skillset.yaml": "compile:\n  targets: [claude, codex]\n",
    "AGENTS.md": "# Authored\n",
  });
  const built = await runSkillsetCli("build", "--yes", "--root", root);
  expect(built.exitCode).toBe(0);
  expect(built.stderr).toContain("AGENTS.md is authored root guidance");
  expect(built.stderr.match(/is authored root guidance/g)).toHaveLength(1);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# Authored\n");
  const blocked = await contractFixture({
    "skillset.yaml": "compile:\n  targets: [claude]\n",
    ".skillset/RULES.md": "# Generated\n",
    ".claude/CLAUDE.md": "# Other authored guidance\n",
  });
  const status = await runSkillsetCli("status", "--root", blocked);
  expect(status.stdout).not.toContain("run skillset build --yes");
  const preview = await runSkillsetCli("build", "--root", blocked);
  expect(preview.exitCode).toBe(1);
  expect(preview.stderr).toContain(".claude/CLAUDE.md");
  expect(preview.stderr).not.toContain("will be backed up");
});
