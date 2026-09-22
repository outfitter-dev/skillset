import { describe, expect, spyOn, test } from "bun:test";

import type { DraftCommandCore } from "../draft-cli";
import { runDraftCommand } from "../draft-cli";

const request = {
  jsonOutput: false,
  rootPath: "/workspace",
  shippedPath: ".skillset/skills/demo",
  yes: false,
} as const;

const createCore = (): {
  readonly calls: {
    readonly expectedPlanHash?: string;
    readonly operation: "apply" | "plan";
  }[];
  readonly value: DraftCommandCore;
} => {
  const plan = {
    from: request.shippedPath,
    generatedOperations: [
      {
        content: new Uint8Array([0, 17, 255]),
        kind: "create" as const,
        mode: 0o755 as const,
        path: ".agents/skills/draft-demo/SKILL.md",
      },
    ],
    operations: [
      {
        from: request.shippedPath,
        kind: "copy" as const,
        to: ".skillset/skills/_drafts/demo",
      },
      { kind: "update" as const, path: ".skillset/changes/ledger.jsonl" },
    ],
    planHash: "sha256:draft-plan",
    selector: "skill:demo",
    sourceHash: `sha256:${"1".repeat(64)}`,
    to: ".skillset/skills/_drafts/demo",
    warnings: [],
  };
  const calls: { expectedPlanHash?: string; operation: "apply" | "plan" }[] =
    [];
  return {
    calls,
    value: {
      draftSource: (input) => {
        calls.push({
          expectedPlanHash: input.expectedPlanHash,
          operation: "apply",
        });
        return Promise.resolve({
          ...plan,
          writtenPaths: [plan.to, ".skillset/changes/ledger.jsonl"],
        });
      },
      planSourceDraft: () => {
        calls.push({ operation: "plan" });
        return Promise.resolve(plan);
      },
    },
  };
};

describe("SET-587 draft command", () => {
  test("previews the fork baseline and exact apply command without mutation", async () => {
    const fake = createCore();
    let output = "";
    await runDraftCommand(request, {
      core: fake.value,
      write: (value) => {
        output += value;
      },
    });

    expect(fake.calls).toEqual([{ operation: "plan" }]);
    expect(output).toContain(
      "would copy: .skillset/skills/demo -> .skillset/skills/_drafts/demo"
    );
    expect(output).toContain(`fork baseline: sha256:${"1".repeat(64)}`);
    expect(output).toContain("plan: sha256:draft-plan");
    expect(output).toContain("skillset draft .skillset/skills/demo --yes");
  });

  test("acknowledges and applies the exact displayed plan hash", async () => {
    const fake = createCore();
    let output = "";
    await runDraftCommand(
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
      { expectedPlanHash: "sha256:draft-plan", operation: "apply" },
    ]);
    expect(output).toContain(
      "wrote copy: .skillset/skills/demo -> .skillset/skills/_drafts/demo"
    );
    expect(output).toContain("skillset: wrote 2 workspace paths");
  });

  test("emits a finite JSON plan without ledger content", async () => {
    const fake = createCore();
    let output = "";
    const write = spyOn(process.stdout, "write").mockImplementation((value) => {
      output += String(value);
      return true;
    });
    try {
      await runDraftCommand(
        { ...request, jsonOutput: true },
        { core: fake.value }
      );
    } finally {
      write.mockRestore();
    }
    const result = JSON.parse(output) as {
      data: {
        plan: {
          generatedOperations: readonly {
            readonly kind: string;
            readonly path: string;
          }[];
        };
      };
    };
    expect(result).toMatchObject({
      command: "draft",
      data: { planHash: "sha256:draft-plan", state: "planned", writes: [] },
      kind: "plan",
      ok: true,
    });
    expect(result.data.plan.generatedOperations).toEqual([
      { kind: "create", path: ".agents/skills/draft-demo/SKILL.md" },
    ]);
    expect(output).not.toContain('"content":');
    expect(output).not.toContain('"mode":');
  });
});
