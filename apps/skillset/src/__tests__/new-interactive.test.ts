import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { createInteractiveSession } from "../interactive-session";
import {
  listNewSourceContainers,
  NEW_HOOK_UNAVAILABLE_REASON,
  NEW_SOURCE_KINDS,
  parseSkillPresets,
  SKILL_PRESETS,
} from "../new-source";
import { PromptCancelledError, ScriptedPromptAdapter } from "../prompt-adapter";
import { initSkillset } from "../setup";
import { runNewCommand, type NewCommandRequest } from "../source-cli";

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const ttyOutput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });

function scriptedSession(
  answers: ConstructorParameters<typeof ScriptedPromptAdapter>[0]
) {
  const adapter = new ScriptedPromptAdapter(answers);
  const output = ttyOutput();
  const session = createInteractiveSession({
    adapter,
    env: { CI: "false" },
    input: ttyInput(),
    output,
  });
  if (session === undefined) throw new Error("expected interactive session");
  return { adapter, output, session };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-interactive-"));
  await initSkillset({ cwd: root, rootPath: root, write: true });
  return root;
}

function request(
  rootPath: string,
  overrides: Partial<NewCommandRequest> = {}
): NewCommandRequest {
  return {
    jsonOutput: false,
    newContainer: undefined,
    newId: undefined,
    newKind: undefined,
    newName: undefined,
    newPresets: undefined,
    newScope: undefined,
    options: {},
    positionalName: undefined,
    rootPath,
    yes: false,
    ...overrides,
  };
}

describe("SET-293 derived new-source choices", () => {
  test("kind and preset metadata drive validation and disabled choices", () => {
    expect(NEW_SOURCE_KINDS.map((kind) => [kind.id, kind.enabled])).toEqual([
      ["skill", true],
      ["agent", true],
      ["hook", false],
    ]);
    expect(NEW_SOURCE_KINDS.map((kind) => kind.description)).toEqual([
      "Skill directory, SKILL.md, and optional supporting files",
      "Markdown file with repository-level agent instructions",
      "Adaptive runtime hook",
    ]);
    expect(SKILL_PRESETS.map((preset) => preset.id)).toEqual([
      "minimal",
      "support",
      "references",
      "assets",
      "scripts",
      "evals",
      "reference-file",
      "examples-file",
    ]);
    expect(parseSkillPresets(["support,evals", "support"])).toEqual([
      "support",
      "evals",
    ]);
    expect(() => parseSkillPresets(["missing"])).toThrow(
      "expected --preset minimal, support, references, assets, scripts, evals, reference-file, or examples-file"
    );
  });

  test("bare skill previews conditional prompts and defaults to no writes", async () => {
    const root = await workspace();
    const { adapter, output, session } = scriptedSession([
      { kind: "select", value: "skill" },
      { kind: "input", value: "Docs Expert" },
      { kind: "checkbox", value: ["minimal"] },
      { kind: "confirm", value: false },
    ]);

    await runNewCommand(request(root), { interactiveSession: session });

    adapter.assertComplete();
    expect(Bun.stripANSI(output.read()?.toString() ?? "")).not.toContain(
      "Create source:"
    );
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "select",
      "input",
      "checkbox",
      "confirm",
    ]);
    const kindPrompt = adapter.prompts[0];
    if (kindPrompt?.kind !== "select") throw new Error("expected kind prompt");
    expect(kindPrompt.prompt.message).toBe("Create a new:");
    expect(kindPrompt.prompt.choices.at(-1)).toEqual(
      expect.objectContaining({
        disabled: NEW_HOOK_UNAVAILABLE_REASON,
        value: "hook",
      })
    );
    const identityPrompt = adapter.prompts[1];
    if (identityPrompt?.kind !== "input") {
      throw new Error("expected identity prompt");
    }
    expect(identityPrompt.prompt.message).toBe("Name:");
    expect(
      await Bun.file(
        join(root, ".skillset/skills/docs-expert/SKILL.md")
      ).exists()
    ).toBe(false);
  });

  test("confirmed plugin skill forwards preset and placement without building", async () => {
    const root = await workspace();
    await mkdir(join(root, ".skillset/plugins/acme"), { recursive: true });
    await writeFile(
      join(root, ".skillset/plugins/acme/skillset.yaml"),
      "skillset:\n  name: acme\n"
    );
    const { adapter, session } = scriptedSession([
      { kind: "input", value: "Plugin Helper" },
      { kind: "select", value: "acme" },
      { kind: "checkbox", value: ["support", "evals"] },
      { kind: "confirm", value: true },
    ]);

    await runNewCommand(request(root, { newKind: "skill" }), {
      interactiveSession: session,
    });

    adapter.assertComplete();
    const placementPrompt = adapter.prompts[1];
    if (placementPrompt?.kind !== "select") {
      throw new Error("expected placement prompt");
    }
    expect(placementPrompt.prompt.message).toBe("Destination:");
    expect(placementPrompt.prompt.default).toBe("__workspace__");
    const presetPrompt = adapter.prompts[2];
    if (presetPrompt?.kind !== "checkbox") {
      throw new Error("expected preset prompt");
    }
    expect(presetPrompt.prompt.message).toBe("Include starting surfaces:");
    const skillRoot = join(root, ".skillset/plugins/acme/skills/plugin-helper");
    expect(await Bun.file(join(skillRoot, "SKILL.md")).exists()).toBe(true);
    expect(await Bun.file(join(skillRoot, "SKILL.md")).text()).toContain(
      'title: "Plugin Helper"'
    );
    expect(
      await Bun.file(join(skillRoot, "references/.gitkeep")).exists()
    ).toBe(true);
    expect(await Bun.file(join(skillRoot, "evals/evals.json")).exists()).toBe(
      true
    );
    expect(await Bun.file(join(root, ".claude")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".agents")).exists()).toBe(false);
  });

  test("project agent skips skill-only placement and preset questions", async () => {
    const root = await workspace();
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "agent" },
      { kind: "input", value: "Release Reviewer" },
      { kind: "confirm", value: true },
    ]);

    await runNewCommand(request(root), { interactiveSession: session });

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "select",
      "input",
      "confirm",
    ]);
    expect(
      await Bun.file(
        join(root, ".skillset/agents/release-reviewer.md")
      ).exists()
    ).toBe(true);
  });

  test("explicit kind, id, name, container, and presets skip matching prompts", async () => {
    const root = await workspace();
    await mkdir(join(root, ".skillset/plugins/acme"), { recursive: true });
    await writeFile(
      join(root, ".skillset/plugins/acme/skillset.yaml"),
      "skillset:\n  name: acme\n"
    );
    const { adapter, session } = scriptedSession([
      { kind: "confirm", value: false },
    ]);

    await runNewCommand(
      request(root, {
        newContainer: "acme",
        newId: "docs",
        newKind: "skill",
        newName: "Docs Expert",
        newPresets: ["minimal"],
      }),
      { interactiveSession: session }
    );

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual(["confirm"]);
  });

  test("container discovery shares manifest validation and uses search at scale", async () => {
    const root = await workspace();
    for (let index = 0; index < 8; index += 1) {
      const name = `plugin-${index}`;
      await mkdir(join(root, ".skillset/plugins", name), { recursive: true });
      await writeFile(
        join(root, ".skillset/plugins", name, "skillset.yaml"),
        `skillset:\n  name: ${name}\n`
      );
    }
    expect(await listNewSourceContainers(root)).toHaveLength(8);
    const { adapter, session } = scriptedSession([
      { kind: "input", value: "Search Skill" },
      { kind: "search", value: "plugin-7" },
      { kind: "checkbox", value: ["minimal"] },
      { kind: "confirm", value: false },
    ]);

    await runNewCommand(request(root, { newKind: "skill" }), {
      interactiveSession: session,
    });

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "input",
      "search",
      "checkbox",
      "confirm",
    ]);
  });

  test("workspace placement does not require a valid full build graph", async () => {
    const root = await workspace();
    await mkdir(join(root, ".skillset/plugins/demo"), { recursive: true });
    await writeFile(
      join(root, ".skillset/plugins/demo/skillset.yaml"),
      "skillset:\n  name: demo\n"
    );
    await mkdir(join(root, ".skillset/skills/broken"), { recursive: true });
    await writeFile(
      join(root, ".skillset/skills/broken/SKILL.md"),
      "---\nname: [\n---\n"
    );
    await expect(listNewSourceContainers(root)).rejects.toThrow();
    const { adapter, session } = scriptedSession([
      { kind: "input", value: "Workspace Skill" },
      { kind: "select", value: "__workspace__" },
      { kind: "checkbox", value: ["minimal"] },
      { kind: "confirm", value: false },
    ]);

    const result = await runNewCommand(request(root, { newKind: "skill" }), {
      interactiveSession: session,
    });

    adapter.assertComplete();
    expect(result).toBeUndefined();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "input",
      "select",
      "checkbox",
      "confirm",
    ]);
  });

  test("container discovery and explicit placement share canonical plugin validation", async () => {
    const legacyRoot = await workspace();
    await mkdir(join(legacyRoot, ".skillset/plugins/legacy"), {
      recursive: true,
    });
    await writeFile(
      join(legacyRoot, ".skillset/plugins/legacy/config.yaml"),
      "skillset:\n  name: legacy\n"
    );

    await expect(listNewSourceContainers(legacyRoot)).rejects.toThrow(
      "uses retired plugin config.yaml"
    );
    await expect(
      runNewCommand(
        request(legacyRoot, {
          newContainer: "legacy",
          newKind: "skill",
          positionalName: "Legacy Skill",
          yes: true,
        })
      )
    ).rejects.toThrow("does not exist or has no skillset.yaml");
    expect(
      await Bun.file(
        join(
          legacyRoot,
          ".skillset/plugins/legacy/skills/legacy-skill/SKILL.md"
        )
      ).exists()
    ).toBe(false);

    const malformedRoot = await workspace();
    await mkdir(join(malformedRoot, ".skillset/plugins/malformed"), {
      recursive: true,
    });
    await writeFile(
      join(malformedRoot, ".skillset/plugins/malformed/skillset.yaml"),
      "skillset: [\n"
    );

    await expect(listNewSourceContainers(malformedRoot)).rejects.toThrow();
    await expect(
      runNewCommand(
        request(malformedRoot, {
          newContainer: "malformed",
          newKind: "skill",
          positionalName: "Malformed Skill",
          yes: true,
        })
      )
    ).rejects.toThrow();
    expect(
      await Bun.file(
        join(
          malformedRoot,
          ".skillset/plugins/malformed/skills/malformed-skill/SKILL.md"
        )
      ).exists()
    ).toBe(false);
  });

  test("uninitialized workspaces fail through the existing plan error before confirmation", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-new-uninitialized-"));
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "skill" },
      { kind: "input", value: "Fresh Skill" },
    ]);

    await expect(
      runNewCommand(request(root), { interactiveSession: session })
    ).rejects.toThrow(
      "new requires an initialized Skillset workspace; run skillset init --yes"
    );
    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "select",
      "input",
    ]);
  });

  test("cancellation stays controlled and leaves the source tree untouched", async () => {
    const root = await workspace();
    const controller = new AbortController();
    controller.abort();
    const session = createInteractiveSession({
      env: { CI: "false" },
      input: ttyInput(),
      output: ttyOutput(),
      signal: controller.signal,
    });
    if (session === undefined) throw new Error("expected interactive session");

    await expect(
      runNewCommand(request(root), { interactiveSession: session })
    ).rejects.toThrow(PromptCancelledError);
    expect(
      await Bun.file(join(root, ".skillset/skills/cancelled/SKILL.md")).exists()
    ).toBe(false);
  });

  test("JSON and yes requests bypass an injected prompt session", async () => {
    const root = await workspace();
    const { adapter, session } = scriptedSession([]);

    await runNewCommand(
      request(root, {
        jsonOutput: true,
        newKind: "skill",
        positionalName: "JSON Preview",
      }),
      { interactiveSession: session }
    );
    await runNewCommand(
      request(root, {
        newKind: "skill",
        positionalName: "Yes Write",
        yes: true,
      }),
      { interactiveSession: session }
    );

    adapter.assertComplete();
    expect(adapter.prompts).toEqual([]);
    expect(
      await Bun.file(
        join(root, ".skillset/skills/json-preview/SKILL.md")
      ).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".skillset/skills/yes-write/SKILL.md")).exists()
    ).toBe(true);
  });

  test("CI and non-TTY CLI requests retain the non-interactive preview path", async () => {
    const root = await workspace();
    for (const env of [process.env, { ...process.env, CI: "true" }]) {
      const result = await runCli(
        ["new", "skill", "Piped Skill", "--root", root],
        env
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("write confirmation required");
      expect(result.stdout).not.toContain("Create source:");
    }
    expect(
      await Bun.file(
        join(root, ".skillset/skills/piped-skill/SKILL.md")
      ).exists()
    ).toBe(false);
  });
});

async function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): Promise<{ readonly exitCode: number; readonly stdout: string }> {
  const process = Bun.spawn(
    ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    {
      env,
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  return { exitCode, stdout };
}
