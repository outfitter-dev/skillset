import { describe, expect, spyOn, test } from "bun:test";

import type { MoveCommandCore } from "../move-cli";
import { runMoveCommand } from "../move-cli";

const request = {
  from: ".skillset/plugins/tools/skills/demo",
  jsonOutput: false,
  rootPath: "/workspace",
  to: ".skillset/skills/demo",
  yes: false,
} as const;

const createCore = (): {
  readonly calls: { readonly expectedPlanHash?: string; readonly operation: "apply" | "plan" }[];
  readonly value: MoveCommandCore;
} => {
  const plan = {
    from: request.from,
    generatedOperations: [
      { kind: "delete" as const, path: "plugins/tools/claude/skills/demo/SKILL.md" },
      { kind: "create" as const, path: ".claude/skills/demo/SKILL.md" },
    ],
    kind: "plugin-to-workspace",
    notices: [
      "removed plugins.internal_use selection for plugin.tools.skill:demo; workspace skills are not selected implicitly",
    ],
    operations: [
      { from: request.from, kind: "move" as const, to: request.to },
      { content: "private", kind: "update" as const, path: "skillset.yaml" },
    ],
    planHash: "sha256:move",
    to: request.to,
    warnings: [],
  };
  const calls: { expectedPlanHash?: string; operation: "apply" | "plan" }[] = [];
  return {
    calls,
    value: {
      moveSource: (input) => {
        calls.push({ expectedPlanHash: input.expectedPlanHash, operation: "apply" });
        return Promise.resolve({ ...plan, applied: true, writtenPaths: [request.to, "skillset.yaml"] });
      },
      planSourceMove: () => {
        calls.push({ operation: "plan" });
        return Promise.resolve(plan);
      },
    },
  };
};

describe("SET-588 move command", () => {
  test("previews all effects and the internal-use removal without applying", async () => {
    const fake = createCore();
    let output = "";
    await runMoveCommand(request, {
      core: fake.value,
      write: (value) => { output += value; },
    });
    expect(fake.calls).toEqual([{ operation: "plan" }]);
    expect(output).toContain(`would move: ${request.from} -> ${request.to}`);
    expect(output).toContain("would update: skillset.yaml");
    expect(output).toContain("notice: removed plugins.internal_use selection");
    expect(output).toContain(`skillset move ${request.from} ${request.to} --yes`);
  });

  test("applies the exact displayed plan hash with --yes", async () => {
    const fake = createCore();
    let output = "";
    await runMoveCommand({ ...request, yes: true }, {
      core: fake.value,
      ledgerLock: (_rootPath, operation) => operation(),
      write: (value) => { output += value; },
    });
    expect(fake.calls).toEqual([
      { operation: "plan" },
      { expectedPlanHash: "sha256:move", operation: "apply" },
    ]);
    expect(output).toContain(`wrote move: ${request.from} -> ${request.to}`);
    expect(output).toContain("skillset: wrote 2 workspace paths");
  });

  test("emits a finite JSON plan without private source content", async () => {
    const fake = createCore();
    let output = "";
    const write = spyOn(process.stdout, "write").mockImplementation((value) => {
      output += String(value);
      return true;
    });
    try {
      await runMoveCommand({ ...request, jsonOutput: true }, { core: fake.value });
    } finally {
      write.mockRestore();
    }
    expect(JSON.parse(output)).toMatchObject({
      command: "move",
      data: {
        notices: [expect.stringContaining("plugins.internal_use")],
        planHash: "sha256:move",
        state: "planned",
        writes: [],
      },
      kind: "plan",
      ok: true,
    });
    expect(output).not.toContain("private");
  });
});
