import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  assertDeterministicProjection,
  formatDeterministicProjectionReport,
  ISOLATED_OUT_ROOT,
  runDeterministicProjection,
} from "@skillset/core";

const DEMO_CONFIG = `
skillset:
  name: deterministic-root
claude: true
codex: false
`;
const DEMO_SKILL = `
---
name: demo
description: Demo.
---

Body.
`;
const DEMO_FIXTURE: Record<string, string> = {
  ".skillset/config.yaml": DEMO_CONFIG,
  ".skillset/skills/demo/SKILL.md": DEMO_SKILL,
};

describe("deterministic projection runner", () => {
  it("proves the kitchen-sink fixture projects deterministically without live output writes", async () => {
    const root = join(process.cwd(), "fixtures/kitchen-sink");

    const report = await assertDeterministicProjection(root);

    expect(report.ok).toBe(true);
    expect(report.outputComparison.equal).toBe(true);
    expect(report.resultComparison.equal).toBe(true);
    expect(report.runs[0].generatedFiles).toBeGreaterThan(0);
    expect(report.runs[1].generatedFiles).toBe(report.runs[0].generatedFiles);
    expect(await exists(join(root, ISOLATED_OUT_ROOT))).toBe(false);
  });

  it("proves the self-hosted .skillset source selection deterministically", async () => {
    const report = await runDeterministicProjection(process.cwd(), {
      keepTemp: true,
      sourcePaths: [".skillset"],
    });
    try {
      expect(report.ok).toBe(true);
      expect(report.outputComparison.identical).toContain("plugins-claude/plugins/skillset/.claude-plugin/plugin.json");
      expect(report.outputComparison.identical).toContain("plugins-codex/plugins/skillset/.codex-plugin/plugin.json");
      expect(await exists(join(report.runs[0].outputRoot, "plugins-claude/plugins/skillset/.claude-plugin/plugin.json"))).toBe(true);
    } finally {
      await rm(report.tempRootPath, { force: true, recursive: true });
    }
  });

  it("reports path-level differences for deliberately unstable output", async () => {
    const root = await fixture(DEMO_FIXTURE);

    const report = await runDeterministicProjection(root, {
      afterProjection: async (run) => {
        if (run.name === "right") {
          await Bun.write(join(run.outputRoot, "unstable.txt"), "right-only\n");
        }
      },
    });

    expect(report.ok).toBe(false);
    expect(report.outputComparison.rightOnly).toEqual(["unstable.txt"]);
    expect(formatDeterministicProjectionReport(report)).toContain("right-only: unstable.txt");
    await expect(assertDeterministicProjection(root, {
      afterProjection: async (run) => {
        if (run.name === "right") {
          await Bun.write(join(run.outputRoot, "unstable.txt"), "right-only\n");
        }
      },
    })).rejects.toThrow("unstable.txt");
  });

  it("fails when generated output leaks a temp workspace path", async () => {
    const root = await fixture(DEMO_FIXTURE);

    await expect(runDeterministicProjection(root, {
      afterProjection: async (run) => {
        await Bun.write(join(run.outputRoot, "leak.txt"), `workspace=${run.workspacePath}\n`);
      },
    })).rejects.toThrow("contains forbidden value");
  });

  it("fails when generated output leaks the shared temp runner root", async () => {
    const root = await fixture(DEMO_FIXTURE);

    await expect(runDeterministicProjection(root, {
      afterProjection: async (run) => {
        await Bun.write(join(run.outputRoot, "leak.txt"), `tempRoot=${dirname(dirname(run.workspacePath))}\n`);
      },
    })).rejects.toThrow("contains forbidden value");
  });

  it("rejects source symlinks instead of copying external state", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-deterministic-projection-"));
    const external = await mkdtemp(join(tmpdir(), "skillset-deterministic-external-"));
    await Bun.write(join(external, "config.yaml"), `${DEMO_CONFIG.trim()}\n`);
    await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), `${DEMO_SKILL.trim()}\n`);
    await symlink(join(external, "config.yaml"), join(root, ".skillset/config.yaml"));

    await expect(runDeterministicProjection(root)).rejects.toThrow(
      "deterministic projection source does not support symlinks: .skillset/config.yaml"
    );
  });

  it("rejects empty source selections before running a projection", async () => {
    const root = await fixture(DEMO_FIXTURE);

    await expect(runDeterministicProjection(root, {
      sourcePaths: [],
    })).rejects.toThrow("requires at least one source path");
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-deterministic-projection-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
