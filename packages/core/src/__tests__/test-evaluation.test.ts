import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluateSkillsetTestRuntime,
  evaluateSkillsetTestWorkspace,
  loadSkillsetTestDeclaration,
  stageSkillsetTestWorkspace,
  type SkillsetRuntimeProbeRequest,
} from "@skillset/core/internal/test-evaluation";

const SOURCE = `
---
name: demo
description: Demo skill.
---

Demo body.
`;

describe("Core test evaluation", () => {
  it("stages a caller-owned workspace, evaluates static checks, and normalizes fake-probe assertions", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: evaluation-root
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/demo/SKILL.md": SOURCE,
      ".skillset/tests.yaml": `
demo:
  select:
    skills:
      primary: [demo]
  checks:
    projection: true
    files:
      - path: .claude/skills/demo/SKILL.md
        contains: Demo body.
  activation:
    - name: live demo
      prompt: Say demo.
      expect:
        skill: demo
      runtime:
        expect:
          contains: accepted
`,
    });
    const stagingRoot = await mkdtemp(
      join(tmpdir(), "skillset-test-evaluation-")
    );
    const workspacePath = join(stagingRoot, "workspace");
    await mkdir(workspacePath, { recursive: true });

    try {
      const { declaration, graph } = await loadSkillsetTestDeclaration(
        root,
        "demo"
      );
      await stageSkillsetTestWorkspace(root, graph, declaration, workspacePath);
      const evaluation = await evaluateSkillsetTestWorkspace(
        workspacePath,
        graph,
        declaration,
        {
          buildMode: "all",
          sourceDir: graph.sourceDir,
          targetFilter: declaration.targets,
        }
      );
      const requests: SkillsetRuntimeProbeRequest[] = [];
      const runtime = await evaluateSkillsetTestRuntime(
        workspacePath,
        declaration,
        { sourceDir: graph.sourceDir },
        {
          run: async (request) => {
            requests.push(request);
            return {
              command: ["fake", request.target],
              response: "accepted",
              state: "passed",
            };
          },
        }
      );

      expect(evaluation.ok).toBe(true);
      expect(evaluation.checks.map((check) => check.kind)).toEqual([
        "projection",
        "contains",
      ]);
      expect(
        await Bun.file(
          join(workspacePath, ".claude/skills/demo/SKILL.md")
        ).text()
      ).toContain("Demo body.");
      expect(requests).toEqual([
        expect.objectContaining({
          name: "demo-live-demo-claude",
          prompt: "Say demo.",
          promptProvenance: "inline",
          target: "claude",
          workspacePath,
        }),
      ]);
      expect(runtime).toEqual([
        expect.objectContaining({
          assertions: [expect.objectContaining({ kind: "contains", ok: true })],
          ok: true,
          target: "claude",
        }),
      ]);
    } finally {
      await rm(stagingRoot, { force: true, recursive: true });
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports a missing runtime render before invoking the probe", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: missing-runtime-root
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/demo/SKILL.md": SOURCE,
      ".skillset/tests.yaml": `
missing:
  select:
    skills:
      primary: [demo]
  checks:
    projection: true
  activation:
    - prompt: Say missing.
      expect:
        skill: absent
      runtime:
        expect:
          contains: absent
`,
    });
    const stagingRoot = await mkdtemp(
      join(tmpdir(), "skillset-test-evaluation-")
    );
    const workspacePath = join(stagingRoot, "workspace");
    await mkdir(workspacePath, { recursive: true });
    let calls = 0;

    try {
      const { declaration, graph } = await loadSkillsetTestDeclaration(
        root,
        "missing"
      );
      await stageSkillsetTestWorkspace(root, graph, declaration, workspacePath);
      const evaluation = await evaluateSkillsetTestWorkspace(
        workspacePath,
        graph,
        declaration,
        {
          buildMode: "all",
          sourceDir: graph.sourceDir,
          targetFilter: declaration.targets,
        }
      );
      const runtime = await evaluateSkillsetTestRuntime(
        workspacePath,
        declaration,
        { sourceDir: graph.sourceDir },
        {
          run: async () => {
            calls += 1;
            return { command: [], state: "passed" };
          },
        }
      );

      expect(evaluation.ok).toBe(true);
      expect(calls).toBe(0);
      expect(runtime).toEqual([
        expect.objectContaining({
          failureClass: "render",
          ok: false,
          state: "failed",
        }),
      ]);
    } finally {
      await rm(stagingRoot, { force: true, recursive: true });
      await rm(root, { force: true, recursive: true });
    }
  });

  it("remains independent from the CLI app implementation", async () => {
    const sources = await Promise.all([
      readFile(new URL("../test-declaration.ts", import.meta.url), "utf-8"),
      readFile(new URL("../test-evaluation.ts", import.meta.url), "utf-8"),
    ]);
    for (const source of sources) {
      expect(source).not.toContain("apps/skillset");
      expect(source).not.toContain('from "./try"');
      expect(source).not.toContain("node:child_process");
    }
  });
});

async function fixture(
  files: Readonly<Record<string, string>>
): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), "skillset-test-evaluation-fixture-")
  );
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
