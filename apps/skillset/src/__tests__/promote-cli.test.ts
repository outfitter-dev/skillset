import { describe, expect, spyOn, test } from "bun:test";

import type { PromoteCommandCore } from "../promote-cli";
import { runPromoteCommand } from "../promote-cli";

const request = {
  draftPath: ".skillset/skills/_drafts/demo",
  jsonOutput: false,
  rootPath: "/workspace",
  yes: false,
} as const;

const createCore = (unrecorded = false): {
  readonly calls: {
    readonly expectedPlanHash?: string;
    readonly operation: "apply" | "plan";
  }[];
  readonly value: PromoteCommandCore;
} => {
  const warning = unrecorded
    ? "no recorded fork baseline for skill:demo#draft; cannot determine whether skill:demo changed since drafting"
    : "shipped skill skill:demo changed since the draft was taken; promotion will replace the current authored bytes";
  const plan = {
    ...(unrecorded ? {} : { baselineSourceHash: `sha256:${"1".repeat(64)}` }),
    changedSinceDraft: unrecorded ? null : true,
    diff: [
      "diff --skillset SKILL.md",
      "--- shipped/SKILL.md",
      "+++ draft/SKILL.md",
    ],
    ...(unrecorded ? {} : { draftEventId: "source-drafted-1" }),
    draftSourceHash: `sha256:${"2".repeat(64)}`,
    from: request.draftPath,
    generatedOperations: [
      {
        content: new Uint8Array([0, 17, 255]),
        kind: "update" as const,
        mode: 0o644 as const,
        path: ".agents/skills/demo/SKILL.md",
      },
    ],
    kind: "paired" as const,
    operations: [
      {
        from: request.draftPath,
        kind: "move" as const,
        to: ".skillset/skills/demo",
      },
      { kind: "delete" as const, path: ".skillset/skills/demo" },
      { kind: "update" as const, path: ".skillset/changes/ledger.jsonl" },
    ],
    planHash: "sha256:promote-plan",
    selector: "skill:demo",
    to: ".skillset/skills/demo",
    warnings: [warning],
  };
  const calls: { expectedPlanHash?: string; operation: "apply" | "plan" }[] =
    [];
  return {
    calls,
    value: {
      planSourcePromotion: () => {
        calls.push({ operation: "plan" });
        return Promise.resolve(plan);
      },
      promoteSource: (input) => {
        calls.push({
          expectedPlanHash: input.expectedPlanHash,
          operation: "apply",
        });
        return Promise.resolve({ ...plan, writtenPaths: [plan.from, plan.to] });
      },
    },
  };
};

describe("SET-587 promote command", () => {
  test("previews paired replacement, diff, and changed-shipped warning", async () => {
    const fake = createCore();
    let output = "";
    await runPromoteCommand(request, {
      core: fake.value,
      write: (value) => {
        output += value;
      },
    });

    expect(fake.calls).toEqual([{ operation: "plan" }]);
    expect(output).toContain("promote paired skill:demo");
    expect(output).toContain(
      "warning: shipped skill skill:demo changed since the draft was taken"
    );
    expect(output).toContain("authored diff:\n    diff --skillset SKILL.md");
    expect(output).toContain("plan: sha256:promote-plan");
    expect(output).toContain(
      "skillset promote .skillset/skills/_drafts/demo --yes"
    );
  });

  test("acknowledges and applies the exact displayed plan hash", async () => {
    const fake = createCore();
    let output = "";
    await runPromoteCommand(
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
      { expectedPlanHash: "sha256:promote-plan", operation: "apply" },
    ]);
    expect(output).toContain(
      "wrote move: .skillset/skills/_drafts/demo -> .skillset/skills/demo"
    );
    expect(output).toContain("skillset: wrote 2 workspace paths");
  });

  test("emits the warning and diff in a finite JSON plan", async () => {
    const fake = createCore();
    let output = "";
    const write = spyOn(process.stdout, "write").mockImplementation((value) => {
      output += String(value);
      return true;
    });
    try {
      await runPromoteCommand(
        { ...request, jsonOutput: true },
        { core: fake.value }
      );
    } finally {
      write.mockRestore();
    }
    const result = JSON.parse(output) as {
      data: {
        plan: {
          diff: readonly string[];
          generatedOperations: readonly {
            readonly kind: string;
            readonly path: string;
          }[];
        };
      };
    };
    expect(result).toMatchObject({
      command: "promote",
      data: {
        plan: { changedSinceDraft: true },
        planHash: "sha256:promote-plan",
        state: "planned",
      },
      kind: "plan",
      ok: true,
    });
    expect(result.data.plan.diff[0]).toBe("diff --skillset SKILL.md");
    expect(result.data.plan.generatedOperations).toEqual([
      { kind: "update", path: ".agents/skills/demo/SKILL.md" },
    ]);
    expect(output).not.toContain('"content":');
    expect(output).not.toContain('"mode":');
  });

  test("reports an unknown change state for a manually paired draft", async () => {
    const fake = createCore(true);
    let output = "";
    const write = spyOn(process.stdout, "write").mockImplementation((value) => {
      output += String(value);
      return true;
    });
    try {
      await runPromoteCommand(
        { ...request, jsonOutput: true },
        { core: fake.value }
      );
    } finally {
      write.mockRestore();
    }
    const result = JSON.parse(output) as {
      data: { plan: { changedSinceDraft: boolean | null; warnings: string[] } };
    };
    expect(result.data.plan.changedSinceDraft).toBeNull();
    expect(result.data.plan.warnings[0]).toContain("no recorded fork baseline");
    expect(output).not.toContain('"draftEventId":');
    expect(output).not.toContain('"baselineSourceHash":');
  });
});
