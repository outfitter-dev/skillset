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
  it("exposes resolved runtime claims on declared activation probes", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: claim-root
compile:
  targets: [codex]
`,
      ".skillset/plugins/tools/.mcp.json": `
{"mcpServers":{"github":{"command":"github-mcp"}}}
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
mcp: true
`,
      ".skillset/tests.yaml": `
claim:
  checks:
    projection: true
  activation:
    - prompt: Check GitHub.
      expect:
        plugin: tools
      targets: [codex]
      runtime:
        claims:
          - capability: mcp-server
            subject: github
        expect:
          contains: github
`,
    });

    try {
      const { declaration } = await loadSkillsetTestDeclaration(root, "claim");
      expect(declaration.activationProbes[0]?.runtime).toMatchObject({
        claims: [{ capability: "mcp-server", subject: "github" }],
        resolvedClaims: [
          {
            claim: { capability: "mcp-server", subject: "github" },
            requirementIds: ["activation:codex:mcp-server:github:proven"],
          },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

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

  it("fails build-only evaluation when projection returns a blocked result", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: blocked-evaluation-root
claude: false
codex: true
cursor: false
`,
      ".skillset/rules/root.md": "# Generated instructions\n",
      ".skillset/tests.yaml": `
blocked:
  checks:
    projection: true
`,
      "AGENTS.md": "# Unmanaged instructions\n",
    });

    try {
      const loaded = await loadSkillsetTestDeclaration(
        root,
        "blocked"
      );
      const { graph } = loaded;
      const declaration = {
        ...loaded.declaration,
        checks: [{ kind: "build" as const }],
      };
      const evaluation = await evaluateSkillsetTestWorkspace(
        root,
        graph,
        declaration,
        {
          buildMode: "all",
          sourceDir: graph.sourceDir,
          targetFilter: declaration.targets,
        }
      );

      expect(evaluation.ok).toBe(false);
      expect(evaluation.buildError).toBe(
        "skillset: build blocked by unmanaged-output-collision"
      );
      expect(evaluation.checks).toEqual([{
        detail: "skillset: build blocked by unmanaged-output-collision",
        kind: "build",
        ok: false,
      }]);
      expect(evaluation.generatedFiles).toBeGreaterThan(0);
      expect(evaluation.rendered.length).toBe(evaluation.generatedFiles);
      expect(evaluation.renderResults.length).toBeGreaterThan(0);
      expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(
        "# Unmanaged instructions\n"
      );
      expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(
        false
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("expects an opted-out Cursor plugin license to be omitted", async () => {
    await expectCursorPluginLicense("none", undefined);
  });

  it("expects a resolved Cursor plugin license in the manifest", async () => {
    await expectCursorPluginLicense("MIT", "MIT");
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

async function expectCursorPluginLicense(
  sourceLicense: "MIT" | "none",
  expectedLicense: "MIT" | undefined
): Promise<void> {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: license-evaluation-root
claude: false
codex: false
cursor: true
`,
    ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  license: ${sourceLicense}
`,
    ".skillset/plugins/tools/skills/demo/SKILL.md": SOURCE,
    ".skillset/tests.yaml": `
plugin-license:
  select:
    plugins: [tools]
  checks:
    pluginManifests: true
`,
  });
  const stagingRoot = await mkdtemp(
    join(tmpdir(), "skillset-test-evaluation-license-")
  );
  const workspacePath = join(stagingRoot, "workspace");
  await mkdir(workspacePath, { recursive: true });

  try {
    const { declaration, graph } = await loadSkillsetTestDeclaration(
      root,
      "plugin-license"
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
    const manifest = JSON.parse(
      await readFile(
        join(workspacePath, "plugins/tools/cursor/.cursor-plugin/plugin.json"),
        "utf8"
      )
    ) as { license?: string };

    expect(evaluation.checks).toContainEqual({
      kind: "pluginManifests",
      ok: true,
    });
    if (expectedLicense === undefined) {
      expect(manifest).not.toHaveProperty("license");
    } else {
      expect(manifest.license).toBe(expectedLicense);
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
    await rm(root, { force: true, recursive: true });
  }
}

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
