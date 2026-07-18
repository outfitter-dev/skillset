import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  formatInteractiveCreatePlan,
  normalizeCreateName,
  runInteractiveCreate,
} from "../create-interactive";
import { createInteractiveSession } from "../interactive-session";
import { ScriptedPromptAdapter } from "../prompt-adapter";

const tty = () => Object.assign(new PassThrough(), { isTTY: true as const });

function scriptedSession(
  answers: ConstructorParameters<typeof ScriptedPromptAdapter>[0]
) {
  const adapter = new ScriptedPromptAdapter(answers);
  const session = createInteractiveSession({
    adapter,
    env: { CI: "false" },
    input: tty(),
    output: tty(),
  });
  if (session === undefined) throw new Error("expected interactive session");
  return { adapter, session };
}

describe("SET-312 named repository create", () => {
  test("asks name then CWD-default parent and defaults to all providers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillset-create-declined-"));
    const { adapter, session } = scriptedSession([
      { kind: "input", value: "Team Loadout" },
      { kind: "input", value: cwd },
      { kind: "select", value: "all" },
      { kind: "checkbox", value: ["ci"] },
      { kind: "confirm", value: false },
    ]);
    let plan = "";

    const result = await runInteractiveCreate(
      {
        name: undefined,
        parentExplicit: false,
        parentPath: cwd,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      { printPlan: (value) => (plan = formatInteractiveCreatePlan(value)) }
    );

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "input",
      "input",
      "select",
      "checkbox",
      "confirm",
    ]);
    const location = adapter.prompts[1];
    if (location?.kind !== "input") throw new Error("expected parent prompt");
    expect(location.prompt.default).toBe(cwd);
    const providers = adapter.prompts[2];
    if (providers?.kind !== "select") throw new Error("expected provider prompt");
    expect(providers.prompt.default).toBe("all");
    expect(providers.prompt.choices.map((choice) => choice.name)).toEqual([
      "All supported providers (Recommended)",
      "Choose specific providers",
    ]);
    expect(result.reason).toBe("write confirmation declined");
    expect(result.report.rootPath).toBe(join(cwd, "team-loadout"));
    expect(plan).toContain(`Create repository ${join(cwd, "team-loadout")}`);
    expect(plan).toContain("Initialize a local Git repository");
    expect(await readdir(cwd)).toEqual([]);
  });

  test("specific providers open the derived provider picker", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillset-create-providers-"));
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "specific" },
      { kind: "checkbox", value: ["codex"] },
      { kind: "confirm", value: false },
    ]);
    await runInteractiveCreate(
      {
        name: "demo",
        parentExplicit: true,
        parentPath: cwd,
        setupIncludes: [],
        setupTargets: undefined,
      },
      session,
      { printPlan: () => undefined }
    );
    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "select",
      "checkbox",
      "confirm",
    ]);
    const picker = adapter.prompts[1];
    if (picker?.kind !== "checkbox") throw new Error("expected provider picker");
    expect(picker.prompt.choices.map((choice) => choice.value)).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
  });

  test("explicit values skip matching prompts and confirmed create initializes Git", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillset-create-written-"));
    const { adapter, session } = scriptedSession([
      { kind: "confirm", value: true },
    ]);
    const result = await runInteractiveCreate(
      {
        name: "demo",
        parentExplicit: true,
        parentPath: cwd,
        setupIncludes: [],
        setupTargets: ["codex"],
      },
      session,
      { printPlan: () => undefined }
    );
    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual(["confirm"]);
    expect(result.reason).toBe("written");
    expect(await Bun.file(join(cwd, "demo/skillset.yaml")).exists()).toBe(true);
    expect(await Bun.file(join(cwd, "demo/.git/HEAD")).exists()).toBe(true);
  });

  test("normalizes a display name into the child directory identity", () => {
    expect(normalizeCreateName("Team Loadout")).toBe("team-loadout");
    expect(normalizeCreateName("teamLoadout")).toBe("team-loadout");
  });
});
