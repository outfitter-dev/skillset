import { expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { buildSkillset } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { initSkillset } from "../setup";
import { adoptSkillset } from "../adopt";
import { createInteractiveSession } from "../interactive-session";
import { ScriptedPromptAdapter } from "../prompt-adapter";
import { formatterIgnoreSuggestions } from "../formatter-ignore-suggestions";
import { formatInteractiveInitPlan, runInteractiveInit } from "../init-interactive";
import { runSkillsetCli } from "./contract-test-helpers";

async function fixture(files: Record<string, string> = {}) {
  const root = await createTestFixtureRoot("init-formatter-");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

for (const [file, formatter] of [
  [".oxfmtrc.json", "oxfmt"], [".oxfmtrc.jsonc", "oxfmt"],
  [".prettierrc", "prettier"], [".prettierrc.js", "prettier"],
  [".prettierignore", "prettier"], ["biome.json", "biome"], ["biome.jsonc", "biome"],
] as const) {
  test(`init offers ${formatter} entries when ${file} exists without editing it`, async () => {
    const content = "// Preserve literal config bytes.\r\n";
    const root = await fixture({ [file]: content });
    const before = await stat(join(root, file));
    for (const write of [false, true]) {
      const report = await initSkillset({ rootPath: root, useGitRoot: false, write });
      const advice = report.formatterSuggestions!;
      expect(advice).toHaveLength(1);
      expect(advice[0]!.formatter).toBe(formatter);
      expect(advice[0]!.detectedPaths).toEqual([file]);
      expect(advice[0]!.patterns).toContain(".skillset/**");
      expect(advice[0]!.patterns).toContain("**/skillset.lock");
      expect(advice[0]!.snippet).toContain("skillset.lock");
      expect(report.files.map((entry) => entry.path)).not.toContain(file);
      expect(await readFile(join(root, file), "utf8")).toBe(content);
      expect((await stat(join(root, file))).mtimeMs).toBe(before.mtimeMs);
    }
  });
}

test("formatter detection is deterministic, grouped, root-only and file-only", async () => {
  const root = await fixture({ ".prettierrc": "{}", ".prettierignore": "keep", ".oxfmtrc.json": "{}", "nested/biome.json": "{}", "biome.json.bak": "{}" });
  await mkdir(join(root, "biome.json"));
  const report = await initSkillset({ rootPath: root, useGitRoot: false });
  expect(report.formatterSuggestions!.map((item) => item.formatter)).toEqual(["oxfmt", "prettier"]);
  expect(report.formatterSuggestions![1]!.detectedPaths).toEqual([".prettierignore", ".prettierrc"]);
  const empty = await initSkillset({ rootPath: await fixture(), useGitRoot: false });
  expect(empty.formatterSuggestions).toEqual([]);
});

test("effective targets and project roots shape suggestions without ignoring the whole project root", async () => {
  const root = await fixture({ ".oxfmtrc.json": "{}", "skillset.yaml": "compile:\n  targets: [cursor]\ncursor:\n  projectRoot: vendor/cursor config\n", "AGENTS.md": "# Authored native guidance\n" });
  const report = await initSkillset({ rootPath: root, useGitRoot: false });
  const advice = report.formatterSuggestions![0]!;
  expect(advice.patterns).toContain("vendor/cursor config/agents/**");
  expect(advice.patterns).toContain("vendor/cursor config/rules/**");
  expect(advice.patterns).toContain(".cursor/skills/**");
  expect(advice.patterns).toContain(".agents/skills/**");
  expect(advice.patterns).not.toContain(".claude/skills/**");
  expect(advice.patterns).not.toContain("vendor/cursor config/**");
  expect(advice.patterns).not.toContain("AGENTS.md");
  expect(advice.patterns).not.toContain("**/AGENTS.md");
  expect(advice.notes.join(" ")).toContain("after adoption");
  expect(JSON.parse(advice.snippet).ignorePatterns).toEqual(advice.patterns);
});

test("existing lock-owned nested instructions are suggested as files, never the workspace root", async () => {
  const root = await fixture({ ".prettierignore": "", "skillset.yaml": "compile:\n  targets: [codex]\n  session_start_hook: off\n", ".skillset/rules/api/guide.md": "API guidance.\n" });
  await buildSkillset(root);
  const report = await initSkillset({ rootPath: root, useGitRoot: false });
  const advice = report.formatterSuggestions![0]!;
  expect(advice.patterns).toContain("api/AGENTS.md");
  expect(advice.patterns).not.toContain("**");
  expect(advice.patterns).not.toContain("./**");
});

test("adoption and its pre-confirmation display retain formatter advice", async () => {
  const root = await fixture({ "biome.json": "{}", ".claude/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nDemo.\n" });
  const report = await adoptSkillset(root, { write: false, targets: ["claude"] });
  const advice = report.formatterSuggestions![0]!;
  expect(advice.formatter).toBe("biome");
  expect(JSON.parse(advice.snippet).files.includes).toContain("!.skillset/**");
  const output = formatInteractiveInitPlan({ kind: "adopt", report, adoptionCandidates: report.candidates, candidates: [], discoveredCandidates: report.candidates, include: [], location: root, targets: ["claude"] });
  expect(output).toContain("Formatter ignore suggestions");
  expect(output).toContain(advice.snippet);
  expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
});

test("init JSON and text expose suggestions without adding formatter writes", async () => {
  const root = await fixture({ ".prettierrc": "{}" });
  const preview = await runSkillsetCli("init", "--root", root, "--json");
  expect(preview.exitCode).toBe(0);
  const data = JSON.parse(preview.stdout).data;
  expect(data.report.formatterSuggestions[0].destination).toBe(".prettierignore");
  expect(data.writes).toEqual([]);
  const plain = await runSkillsetCli("init", "--root", root);
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toContain("Formatter ignore suggestions");
  expect(await Bun.file(join(root, ".prettierignore")).exists()).toBe(false);
});


test("native islands use configured project roots and unsafe glob paths are left for review", async () => {
  const root = await fixture({ ".oxfmtrc.json": "{}", "skillset.yaml": "compile:\n  targets: [claude]\nclaude:\n  projectRoot: vendor/config\n", ".skillset/_claude/hooks/script.sh": "echo ok\n" });
  const report = await initSkillset({ rootPath: root, useGitRoot: false });
  expect(report.formatterSuggestions![0]!.patterns).toContain("vendor/config/hooks/**");
  expect(report.formatterSuggestions![0]!.patterns).toContain(".claude/rules/**");
  expect(report.formatterSuggestions![0]!.patterns).not.toContain("vendor/config/rules/**");
  await writeFile(join(root, "skillset.yaml"), "compile:\n  targets: [cursor]\ncursor:\n  projectRoot: vendor/[config]\n");
  const unsafe = await initSkillset({ rootPath: root, useGitRoot: false });
  expect(unsafe.formatterSuggestions![0]!.patterns.some((path) => path.includes("[config]"))).toBe(false);
  expect(unsafe.formatterSuggestions![0]!.notes.join(" ")).toContain("formatter escaping");
});

test("adoption apply retains formatter bytes and does not report them as writes", async () => {
  const root = await fixture({ ".prettierignore": "# keep\r\n", ".claude/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nDemo.\n" });
  const before = await stat(join(root, ".prettierignore"));
  const report = await adoptSkillset(root, { write: true, targets: ["claude"] });
  expect(report.ok).toBe(true);
  expect(report.formatterSuggestions![0]!.formatter).toBe("prettier");
  expect(report.writtenPaths).not.toContain(".prettierignore");
  expect(await readFile(join(root, ".prettierignore"), "utf8")).toBe("# keep\r\n");
  expect((await stat(join(root, ".prettierignore"))).mtimeMs).toBe(before.mtimeMs);
});


test("interactive decline displays advice before confirmation and leaves the repository unchanged", async () => {
  const root = await fixture({ ".oxfmtrc.json": "{}\n" });
  const adapter = new ScriptedPromptAdapter([{ kind: "confirm", value: false }]);
  const session = createInteractiveSession({ adapter, env: { CI: "false" }, input: Object.assign(new PassThrough(), { isTTY: true as const }), output: Object.assign(new PassThrough(), { isTTY: true as const }) });
  if (!session) throw new Error("expected session");
  let shown = "";
  const result = await runInteractiveInit({ directory: undefined, rootExplicit: true, rootPath: root, initAdopt: [], setupIncludes: [], setupTargets: ["codex"] }, session, { printPlan(plan) {
    expect(adapter.prompts).toHaveLength(0);
    shown = formatInteractiveInitPlan(plan);
  } });
  adapter.assertComplete();
  expect(shown).toContain("Formatter ignore suggestions");
  expect(result.reason).toBe("write confirmation declined");
  expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
  expect(await readFile(join(root, ".oxfmtrc.json"), "utf8")).toBe("{}\n");
});

test("invalid optional lock evidence is disclosed without granting paths or blocking suggestions", async () => {
  const root = await fixture({ ".prettierrc": "{}", "skillset.lock": "{invalid" });
  const advice = (await formatterIgnoreSuggestions(root, "compile:\n  targets: []\n", true))[0]!;
  expect(advice.patterns).toContain("**/skillset.lock");
  expect(advice.patterns).not.toContain("AGENTS.md");
  expect(advice.notes.join(" ")).toContain("Could not use skillset.lock");
});
