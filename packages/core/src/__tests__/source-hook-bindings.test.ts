import { describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillset } from "../build";
import { moveSource, planSourceMove } from "../source-move";
import { planSourceRename, renameSource } from "../source-rename";

const live = ".skillset/skills/demo";
const plugin = ".skillset/plugins/tools/skills/demo";
const rootHook = ".skillset/hooks/check.json";
const pluginHook = ".skillset/plugins/tools/hooks/check.json";
const skill = (hooks = "  SessionStart:\n    - hook: check\n") =>
  `---\nname: demo\ndescription: Demo.\n${hooks ? `hooks:\n${hooks}` : ""}---\n\nDemo.\n`;
const hook = (command: string) => JSON.stringify({ events: ["SessionStart"], run: { command } });

async function fixture(files: Record<string, string>) {
  const root = await createTestFixtureRoot("source-hook-bindings-");
  for (const [path, content] of Object.entries({
    "skillset.yaml": "skillset:\n  name: binding-test\ncompile:\n  targets: [claude]\n",
    ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
    ...files,
  })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await buildSkillset(root);
  return root;
}

async function snapshot(root: string, prefix = ""): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshot(root, path));
    else if (entry.isFile()) files[path] = (await readFile(join(root, path))).toString("base64");
  }
  return files;
}

describe("source lifecycle preserves adaptive hook bindings", () => {
  for (const reverse of [false, true]) {
    test(`rejects ${reverse ? "plugin-to-workspace" : "workspace-to-plugin"} shadowing without writes`, async () => {
      const from = reverse ? plugin : live;
      const to = reverse ? live : plugin;
      const root = await fixture({ [`${from}/SKILL.md`]: skill(), [rootHook]: hook("echo ROOT"), [pluginHook]: hook("echo PLUGIN") });
      const before = await snapshot(root);
      const request = { rootPath: root, from, to };
      await expect(planSourceMove(request)).rejects.toThrow("hook binding");
      await expect(moveSource({ ...request, expectedPlanHash: "untrusted" })).rejects.toThrow("hook binding");
      expect(await snapshot(root)).toEqual(before);
    });
  }

  test("rejects a hook rename that shadows an attachment in an untouched skill", async () => {
    const from = ".skillset/plugins/tools/hooks/other.json";
    const root = await fixture({ [`${plugin}/SKILL.md`]: skill(), [rootHook]: hook("echo ROOT"), [from]: hook("echo PLUGIN") });
    const before = await snapshot(root);
    await expect(planSourceRename({ rootPath: root, from, to: pluginHook })).rejects.toThrow("hook binding");
    expect(await snapshot(root)).toEqual(before);
  });

  test("protects carried draft attachments even when the live skill has no hook", async () => {
    const root = await fixture({ [`${live}/SKILL.md`]: skill(""), ".skillset/skills/_drafts/demo/SKILL.md": skill("  SessionStart:\n    - hook: check\n      providers: [codex]\n"), [rootHook]: hook("echo ROOT"), [pluginHook]: hook("echo PLUGIN") });
    await expect(planSourceMove({ rootPath: root, from: live, to: plugin })).rejects.toThrow("hook binding");
  });

  test("protects an unmoved draft from a newly shadowing renamed hook", async () => {
    const from = ".skillset/plugins/tools/hooks/other.json";
    const root = await fixture({ [`${plugin}/SKILL.md`]: skill(""), ".skillset/plugins/tools/skills/_drafts/demo/SKILL.md": skill(), [rootHook]: hook("echo ROOT"), [from]: hook("echo PLUGIN") });
    await expect(planSourceRename({ rootPath: root, from, to: pluginHook })).rejects.toThrow("hook binding");
  });

  test("preserves root bindings in both move directions with auto and duplicate attachments", async () => {
    const root = await fixture({ [`${live}/SKILL.md`]: skill("  auto:\n    - hook: check\n    - hook: check\n"), [rootHook]: hook("echo ROOT") });
    for (const [from, to] of [[live, plugin], [plugin, live]] as const) {
      const request = { rootPath: root, from, to };
      const plan = await planSourceMove(request);
      await moveSource({ ...request, expectedPlanHash: plan.planHash });
    }
    expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("echo ROOT");
  });

  test("keeps live and draft local definitions separate while moving both", async () => {
    const root = await fixture({ [`${live}/SKILL.md`]: skill(), [`${live}/hooks/check.json`]: hook("echo LIVE"), ".skillset/skills/_drafts/demo/SKILL.md": skill("  SessionStart:\n    - hook: check\n      providers: [codex]\n"), ".skillset/skills/_drafts/demo/hooks/check.json": hook("echo DRAFT"), [pluginHook]: hook("echo PLUGIN") });
    const request = { rootPath: root, from: live, to: plugin };
    const plan = await planSourceMove(request);
    await moveSource({ ...request, expectedPlanHash: plan.planHash });
    expect(await readFile(join(root, "plugins/tools/skills/demo/SKILL.md"), "utf8")).toContain("echo LIVE");
    expect(await readFile(join(root, ".skillset/plugins/tools/skills/_drafts/demo/hooks/check.json"), "utf8")).toBe(hook("echo DRAFT"));
  });

  test("compares identity even when base commands match and only provider overrides differ", async () => {
    const root = await fixture({
      [`${live}/SKILL.md`]: skill("  auto:\n    - hook: check\n      providers: [codex]\n      status: draft\n"),
      [rootHook]: JSON.stringify({ events: ["SessionStart"], run: { command: "echo SAME" }, claude: { run: { command: "echo ROOT" } } }),
      [pluginHook]: JSON.stringify({ events: ["SessionStart"], run: { command: "echo SAME" }, claude: { run: { command: "echo PLUGIN" } } }),
    });
    await expect(planSourceMove({ rootPath: root, from: live, to: plugin })).rejects.toThrow("hook binding");
  });

  test("leaves an unrelated unresolved draft alone but rejects moving it", async () => {
    const draft = ".skillset/plugins/tools/skills/_drafts/demo/SKILL.md";
    const root = await fixture({ [`${plugin}/SKILL.md`]: skill(""), [draft]: skill(), ".skillset/shared/old.md": "Shared.\n" });
    const request = { rootPath: root, from: ".skillset/shared/old.md", to: ".skillset/shared/new.md" };
    const plan = await planSourceRename(request);
    await renameSource({ ...request, expectedPlanHash: plan.planHash });
    expect(await readFile(join(root, draft), "utf8")).toBe(skill());
    await expect(planSourceMove({ rootPath: root, from: plugin, to: live })).rejects.toThrow("hook binding");
  });

  test("permits a definition rename with its attachment rewrite", async () => {
    const root = await fixture({ [`${live}/SKILL.md`]: skill(), [rootHook]: hook("echo ROOT") });
    const request = { rootPath: root, from: rootHook, to: ".skillset/hooks/renamed.json" };
    const plan = await planSourceRename(request);
    await renameSource({ ...request, expectedPlanHash: plan.planHash });
    expect(await readFile(join(root, `${live}/SKILL.md`), "utf8")).toContain("hook: renamed");
    expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("echo ROOT");
  });
});
