import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SkillsetFeatureDiagnosticError } from "@skillset/core";
import { validateCliResult, type SkillsetCliResult } from "@skillset/schema";

import { serializeDiagnostics } from "../cli-diagnostics";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import {
  createTestGitFixtureRoot,
} from "../../../../scripts/test-helpers/git-remote";

const cli = join(import.meta.dir, "..", "cli.ts");
const repoRoot = join(import.meta.dir, "../../../..");

test("CLI JSON serialization is a pass-through of normalized Core diagnostic paths", () => {
  const nativePath = join(".skillset", "plugins", "alpha", "hooks.json");
  const error = new SkillsetFeatureDiagnosticError({
    code: "plugin-root-hooks-unsupported",
    featureId: "plugin-hooks",
    message: `skillset: plugin alpha uses unsupported root hooks.json at ${nativePath}`,
    path: nativePath,
  });
  const serialized = serializeDiagnostics([
    {
      code: error.code,
      featureId: error.featureId,
      message: error.message,
      ...(error.path === undefined ? {} : { path: error.path }),
      severity: "error",
    },
  ]);
  expect(serialized).toEqual([
    {
      code: "plugin-root-hooks-unsupported",
      message: "skillset: plugin alpha uses unsupported root hooks.json at .skillset/plugins/alpha/hooks.json",
      path: ".skillset/plugins/alpha/hooks.json",
      severity: "error",
    },
  ]);
  expect(JSON.stringify(serialized)).not.toContain("\\");
});

test("Windows targeted check JSON path from a controlled source failure has no backslash", async () => {
  const disposableRoot = await createTestGitFixtureRoot("skillset-cli-diagnostic-path-");
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  for (const [filePath, content] of Object.entries(
    normalizeSkillsetFixtureFiles({
      "skillset.yaml": `
skillset:
  name: lint-root
claude: true
codex: false
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: other
description: Demo.
---

Body.
`,
    })
  )) {
    await Bun.write(join(root, filePath), `${content.trim()}\n`);
  }

  const result = await runJsonRoute("check", "--root", root);
  const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
  expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
  expect(result.exitCode).not.toBe(0);
  expect(envelope.ok).toBe(false);
  const diagnostic = envelope.diagnostics.find(
    (entry) => entry.code === "skill-name-directory-mismatch"
  );
  expect(diagnostic).toMatchObject({
    code: "skill-name-directory-mismatch",
    path: ".skillset/skills/demo/SKILL.md",
  });
  expect(diagnostic?.path).not.toInclude("\\");
  expect(diagnostic?.message).not.toInclude("\\");
  expect(JSON.stringify(envelope.diagnostics)).not.toContain("\\\\");
});

test("source parser failures use logical paths in CLI JSON messages", async () => {
  const cases = [
    {
      files: { "skillset.yaml": "[]\n" },
      label: "skillset.yaml",
    },
    {
      files: normalizeSkillsetFixtureFiles({
        "skillset.yaml": `
skillset:
  name: parser-root
claude: true
codex: false
`,
        ".skillset/skills/demo/SKILL.md": "---\nname: [\n---\n",
      }),
      label: ".skillset/skills/demo/SKILL.md",
    },
    {
      files: normalizeSkillsetFixtureFiles({
        "skillset.yaml": `
skillset:
  name: plugin-schema-root
claude: true
codex: false
`,
        ".skillset/plugins/alpha/skillset.yaml": "skillset: []\n",
      }),
      label: ".skillset/plugins/alpha/skillset.yaml",
    },
    {
      files: normalizeSkillsetFixtureFiles({
        "skillset.yaml": `
skillset:
  name: instruction-schema-root
claude: true
codex: false
`,
        ".skillset/rules/README.md": "---\nskillset: []\n---\n\nBody.\n",
      }),
      label: ".skillset/rules/README.md",
    },
    {
      files: normalizeSkillsetFixtureFiles({
        "skillset.yaml": `
skillset:
  name: project-agent-root
claude: true
codex: false
`,
        ".skillset/subagents/reviewer.md": "---\nname: '!!!'\ndescription: Review.\n---\n\nBody.\n",
      }),
      label: ".skillset/subagents/reviewer.md",
    },
    {
      files: normalizeSkillsetFixtureFiles({
        "skillset.yaml": `
skillset:
  name: plugin-feature-root
claude: true
codex: false
`,
        ".skillset/plugins/alpha/skillset.yaml": "mcp:\n  source: bad\n",
      }),
      label: ".skillset/plugins/alpha/skillset.yaml.mcp.source",
    },
  ];

  for (const { files, label } of cases) {
    const disposableRoot = await createTestGitFixtureRoot("skillset-parser-diagnostic-path-");
    const root = await mkdtemp(join(disposableRoot, "repo-"));
    for (const [filePath, content] of Object.entries(files)) {
      const absolutePath = join(root, filePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await Bun.write(absolutePath, content);
    }

    const result = await runJsonRoute("check", "--root", root);
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
    expect(result.exitCode).not.toBe(0);
    const diagnostic = envelope.diagnostics.find((entry) => entry.code === "check-build-error");
    expect(diagnostic?.message).toContain(label);
    expect(diagnostic?.message).not.toContain(root);
    expect(diagnostic?.message).not.toContain("\\");
  }
});

async function runJsonRoute(
  ...args: readonly string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn([process.execPath, cli, ...args, "--json"], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "test" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
