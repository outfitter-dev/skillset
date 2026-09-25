import { describe, expect, it } from "bun:test";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildSkillsetResult, diffSkillsetResult } from "../build";
import { supportsGeneratedFileModes } from "../generated-file-mode";
import { resolveRepoOperationalCachePath } from "../operational-cache";
import { renderProjectSessionStartHooks, SESSION_START_COMMAND } from "../render-project-hooks";
import { loadBuildGraph } from "../resolver";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const CONFIG = `
skillset:
  name: project-hooks-build
claude: true
codex: false
cursor: false
compile:
  session_start_hook: on
`;

const SKILL = `---
name: demo
description: Demo skill.
---

Body.
`;

describe("project SessionStart hooks at the build destination", () => {
  it("composes an isolated build from the mirror, not the live settings file", async () => {
    const { root, xdg, mirror } = await isolatedFixture();
    const live = '{"foreign":"live"}\n';
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude/settings.json"), live);

    const first = await buildSkillsetResult(root, { isolated: true, xdg });
    expect(first.outputState.blockers).toEqual([]);
    expect(first.ok).toBe(true);
    const mirrored = await readFile(join(mirror, ".claude/settings.json"), "utf8");
    expect(mirrored).toContain(SESSION_START_COMMAND);
    expect(mirrored).not.toContain('"live"');
    expect(await readFile(join(root, ".claude/settings.json"), "utf8")).toBe(live);
  });

  it("keeps foreign mirror edits across repeated isolated builds without a live file", async () => {
    const { root, xdg, mirror } = await isolatedFixture();
    expect((await buildSkillsetResult(root, { isolated: true, xdg })).ok).toBe(true);
    const settingsPath = join(mirror, ".claude/settings.json");
    const edited = (await readFile(settingsPath, "utf8")).replace("{", '{\n  "foreign": "mirror",');
    await writeFile(settingsPath, edited);

    const second = await buildSkillsetResult(root, { isolated: true, xdg });
    expect(second.outputState.blockers).toEqual([]);
    expect(second.ok).toBe(true);
    expect(await readFile(settingsPath, "utf8")).toBe(edited);
    expect(await Bun.file(join(root, ".claude/settings.json")).exists()).toBe(false);
  });
});

describe("project SessionStart hooks the graph no longer renders", () => {
  it("removes the owned entry and its lock claim when a target is disabled", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-disabled-");
    const config = CONFIG.replace("codex: false", "codex: true");
    await Bun.write(join(root, "skillset.yaml"), config);
    await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), SKILL);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    expect(await readFile(join(root, ".codex/hooks.json"), "utf8")).toContain(SESSION_START_COMMAND);

    await writeFile(join(root, "skillset.yaml"), config.replace("codex: true", "codex: false"));
    const result = await buildSkillsetResult(root);
    expect(result.outputState.blockers).toEqual([]);
    expect(result.ok).toBe(true);
    expect(await readFile(join(root, ".codex/hooks.json"), "utf8")).not.toContain(SESSION_START_COMMAND);
    expect(await readFile(join(root, ".claude/settings.json"), "utf8")).toContain(SESSION_START_COMMAND);
    const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8")) as {
      readonly items: ReadonlyArray<{ readonly kind: string; readonly outputPath: string }>;
    };
    expect(lock.items.filter((item) => item.kind === "settings-entry").map((item) => item.outputPath)).toEqual([
      ".claude/settings.json",
    ]);
    expect((await diffSkillsetResult(root)).data.changed).toEqual([]);
  });

  it("removes the owned entry from a project root the target moved away from", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-moved-");
    await Bun.write(join(root, "skillset.yaml"), CONFIG);
    await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), SKILL);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const graph = await loadBuildGraph(root);
    const moved = {
      ...graph,
      root: {
        ...graph.root,
        targets: {
          ...graph.root.targets,
          claude: { ...graph.root.targets.claude, options: { ...graph.root.targets.claude.options, projectRoot: ".claude-moved" } },
        },
      },
    };

    const rendered = await renderProjectSessionStartHooks(moved);
    const abandoned = rendered.find((hook) => hook.file.path === ".claude/settings.json");
    expect(abandoned?.managed).toBe(false);
    expect(new TextDecoder().decode(abandoned?.file.content)).not.toContain(SESSION_START_COMMAND);
    expect(rendered.find((hook) => hook.file.path === ".claude-moved/settings.json")?.managed).toBe(true);
  });
});

describe("settings island handback", () => {
  it.skipIf(!supportsGeneratedFileModes())("records a lock-legal file mode when the live settings file is private", async () => {
    const root = await createTestFixtureRoot("skillset-project-hooks-handback-mode-");
    await Bun.write(join(root, "skillset.yaml"), CONFIG);
    await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), SKILL);
    await Bun.write(join(root, ".skillset/_claude/settings.json"), '{"foreign":"keep"}\n');
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const settingsPath = join(root, ".claude/settings.json");
    await chmod(settingsPath, 0o600);

    await writeFile(join(root, "skillset.yaml"), CONFIG.replace("session_start_hook: on", "session_start_hook: off"));
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8")) as {
      readonly items: ReadonlyArray<{ readonly fileModes?: Record<string, string>; readonly kind: string; readonly outputPath: string }>;
    };
    const island = lock.items.find((item) => item.kind === "island" && item.outputPath === ".claude/settings.json");
    expect(island?.fileModes).toEqual({ ".claude/settings.json": "0644" });
    expect((await diffSkillsetResult(root)).data.changed).toEqual([]);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
  });
});

async function isolatedFixture(): Promise<{
  readonly mirror: string;
  readonly root: string;
  readonly xdg: { readonly env: Record<string, string>; readonly homeDir: string };
}> {
  const root = await createTestFixtureRoot("skillset-project-hooks-build-");
  await Bun.write(join(root, "skillset.yaml"), CONFIG);
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), SKILL);
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") }, homeDir: root };
  return { mirror: join(resolveRepoOperationalCachePath(root, xdg), "latest"), root, xdg };
}
