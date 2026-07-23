import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "bun:test";

import { listSkillEvals, normalizeEvalDisplayPath } from "../eval-list";
import { loadBuildGraph } from "../resolver";

const SKILL = `---
name: demo
description: Demo skill.
---

Use this skill.
`;

describe("portable skill eval declarations", () => {
  it("normalizes public repository-relative paths across platforms", () => {
    expect(normalizeEvalDisplayPath(".skillset\\skills\\demo\\SKILL.md")).toBe(
      ".skillset/skills/demo/SKILL.md"
    );
    expect(normalizeEvalDisplayPath(".skillset\\skills\\demo\\evals\\evals.json")).toBe(
      ".skillset/skills/demo/evals/evals.json"
    );
  });

  it("derives a deterministic case-target matrix without invoking a provider", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: eval-root\ncompile:\n  targets: [claude, codex]\n",
      ".skillset/skills/demo/SKILL.md": SKILL,
      ".skillset/skills/demo/evals/evals.json": JSON.stringify({
        skill_name: "demo",
        evals: [
          {
            expected_output: "A summary.",
            files: [],
            id: 1,
            prompt: "Summarize the guidance.",
          },
          {
            expected_output: "A document summary.",
            expectations: [],
            files: ["evals/files/brief.txt", "evals/files/brief.txt"],
            id: 2,
            prompt: "Summarize evals/files/brief.txt.",
            skillset: { targets: ["codex"] },
          },
        ],
      }, null, 2),
      ".skillset/skills/demo/evals/files/brief.txt": "Brief\n",
    });

    const entries = await listSkillEvals(root);

    expect(entries.map(({ evalId, skill, target }) => ({ evalId, skill, target }))).toEqual([
      { evalId: 1, skill: "demo", target: "claude" },
      { evalId: 1, skill: "demo", target: "codex" },
      { evalId: 2, skill: "demo", target: "codex" },
    ]);
    expect(entries[2]).toMatchObject({
      evalPath: ".skillset/skills/demo/evals/evals.json",
      expectations: [],
      files: ["evals/files/brief.txt", "evals/files/brief.txt"],
    });
  });

  it("rejects missing input files and targets that the skill cannot render", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: eval-root\ncompile:\n  targets: [claude]\n",
      ".skillset/skills/demo/SKILL.md": SKILL,
      ".skillset/skills/demo/evals/evals.json": JSON.stringify({
        skill_name: "demo",
        evals: [{
          expected_output: "A summary.",
          files: ["evals/files/missing.txt"],
          id: 1,
          prompt: "Summarize the missing input.",
          skillset: { targets: ["codex"] },
        }],
      }),
    });

    await expect(loadBuildGraph(root)).rejects.toThrow(
      "eval file evals/files/missing.txt does not exist in the skill root; eval target codex is not enabled for the owning skill"
    );
  });
});

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-eval-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, content);
  }
  return root;
}
