import { describe, expect, spyOn, test } from "bun:test";

import { runRenameCommand } from "../rename-cli";
import type { RenameCommandCore } from "../rename-cli";

const request = {
  from: ".skillset/skills/old",
  jsonOutput: false,
  rootPath: "/workspace",
  to: ".skillset/skills/new",
  yes: false,
} as const;

const createCore = (): {
  readonly calls: {
    readonly expectedPlanHash?: string;
    readonly operation: "apply" | "plan";
  }[];
  readonly value: RenameCommandCore;
} => {
  const plan = {
    from: ".skillset/skills/old",
    generatedOperations: [
      { kind: "delete" as const, path: ".claude/skills/old/SKILL.md" },
      { kind: "create" as const, path: ".claude/skills/new/SKILL.md" },
    ],
    kind: "standalone-skill",
    operations: [
      {
        from: ".skillset/skills/old",
        kind: "move" as const,
        to: ".skillset/skills/new",
      },
      {
        content: "private source body",
        kind: "update" as const,
        path: ".skillset/agents/reviewer.md",
      },
    ],
    planHash: "sha256:rename",
    to: ".skillset/skills/new",
    warnings: ["resources.to is generated output and was preserved"],
  };
  const calls: {
    expectedPlanHash?: string;
    operation: "apply" | "plan";
  }[] = [];
  return {
    calls,
    value: {
      planSourceRename: () => {
        calls.push({ operation: "plan" });
        return Promise.resolve(plan);
      },
      renameSource: (input) => {
        calls.push({
          operation: "apply",
          ...(input.expectedPlanHash === undefined
            ? {}
            : { expectedPlanHash: input.expectedPlanHash }),
        });
        return Promise.resolve({
          ...plan,
          applied: true,
          writtenPaths: [
            ".skillset/skills/new",
            ".skillset/agents/reviewer.md",
          ],
        });
      },
    },
  };
};

describe("SET-370 source rename command", () => {
  test("renders a preview without calling the mutation API", async () => {
    const fake = createCore();
    let output = "";

    await runRenameCommand(request, {
      core: fake.value,
      write: (value) => {
        output += value;
      },
    });

    expect(fake.calls).toEqual([{ operation: "plan" }]);
    expect(output).toContain(
      "would move: .skillset/skills/old -> .skillset/skills/new"
    );
    expect(output).toContain("would update: .skillset/agents/reviewer.md");
    expect(output).toContain(
      "would delete generated: .claude/skills/old/SKILL.md"
    );
    expect(output).toContain(
      "would create generated: .claude/skills/new/SKILL.md"
    );
    expect(output).toContain("warning: resources.to is generated output");
    expect(output).toContain("plan: sha256:rename");
    expect(output).toContain(
      "skillset rename .skillset/skills/old .skillset/skills/new --yes"
    );
  });

  test("recomputes the preview and applies that exact plan hash with --yes", async () => {
    const fake = createCore();
    let output = "";

    await runRenameCommand(
      { ...request, yes: true },
      {
        core: fake.value,
        write: (value) => {
          output += value;
        },
      }
    );

    expect(fake.calls).toEqual([
      { operation: "plan" },
      { expectedPlanHash: "sha256:rename", operation: "apply" },
    ]);
    expect(output).toContain(
      "wrote move: .skillset/skills/old -> .skillset/skills/new"
    );
    expect(output).toContain("skillset: wrote 2 workspace paths");
    expect(output).not.toContain("preview only");
  });

  test("emits the finite JSON plan and change envelope", async () => {
    const fake = createCore();
    let output = "";
    const write = spyOn(process.stdout, "write").mockImplementation((value) => {
      output += String(value);
      return true;
    });

    try {
      await runRenameCommand(
        { ...request, jsonOutput: true },
        { core: fake.value }
      );
    } finally {
      write.mockRestore();
    }

    expect(JSON.parse(output)).toMatchObject({
      changes: [
        {
          action: "move",
          path: ".skillset/skills/new",
          reason: "from .skillset/skills/old",
          state: "planned",
        },
        {
          action: "update",
          path: ".skillset/agents/reviewer.md",
          state: "planned",
        },
        {
          action: "delete",
          path: ".claude/skills/old/SKILL.md",
          reason: "generated output",
          state: "planned",
        },
        {
          action: "create",
          path: ".claude/skills/new/SKILL.md",
          reason: "generated output",
          state: "planned",
        },
      ],
      command: "rename",
      data: {
        planHash: "sha256:rename",
        state: "planned",
        writes: [],
      },
      kind: "plan",
      ok: true,
    });
    expect(output).not.toContain("private source body");
  });
});
