import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { buildSkillsetResult } from "@skillset/core";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

const cli = join(import.meta.dir, "..", "cli.ts");

test("SET-554 status exposes coherent project-use provenance in JSON and human output", async () => {
  const root = await fixture({
    "skillset.yaml": `skillset:
  name: project-use-status
claude: true
codex: true
cursor: true
plugins:
  internal_use:
    skills:
      demo: true
`,
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ".skillset/plugins/demo/skills/use-me/SKILL.md": `---
name: use-me
description: Use this skill.
---

Use this skill.
`,
  });
  await buildSkillsetResult(root);

  const jsonResult = await runStatus(root, "--json");
  expect(jsonResult.exitCode).toBe(0);
  expect(jsonResult.stderr).toBe("");
  const report = (JSON.parse(jsonResult.stdout) as {
    readonly data: {
      readonly projectUse: readonly Record<string, unknown>[];
    };
  }).data;
  expect(report.projectUse).toEqual([
    statusEntry("claude"),
    statusEntry("codex"),
    statusEntry("cursor"),
  ]);

  const humanResult = await runStatus(root);
  expect(humanResult.exitCode).toBe(0);
  expect(humanResult.stderr).toBe("");
  for (const target of ["claude", "codex", "cursor"] as const) {
    expect(humanResult.stdout).toContain(
      `project use [${target}]: source=plugin.demo.skill:use-me (.skillset/plugins/demo/skills/use-me/SKILL.md); selection=plugins.internal_use.skills.demo: true; effectiveName=use-me; role=project-use; owner=${target}`
    );
  }
});

test("SET-555 status and explain expose coherent project-draft provenance", async () => {
  const root = await fixture({
    "skillset.yaml": `skillset:
  name: project-draft-status
claude: false
codex: true
cursor: false
plugins:
  internal_use:
    skills:
      demo: true
`,
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ".skillset/plugins/demo/skills/use-me/SKILL.md": `---
name: use-me
description: Use this skill.
---

Use this skill.
`,
    ".skillset/plugins/demo/skills/_drafts/use-me/SKILL.md": `---
name: use-me
description: Draft this skill.
---

Draft this skill.
`,
  });
  await buildSkillsetResult(root);

  const jsonResult = await runStatus(root, "--json");
  expect(jsonResult.exitCode).toBe(0);
  const report = (JSON.parse(jsonResult.stdout) as {
    readonly data: {
      readonly projectUse: readonly Record<string, unknown>[];
    };
  }).data;
  expect(report.projectUse).toContainEqual({
    draftOrigin: "_drafts",
    effectiveName: "draft-use-me",
    owner: { target: "codex" },
    role: "project-use",
    selectionRule: "plugins.internal_use.drafts.demo: omitted (side-by-side)",
    shippedSibling: "plugin.demo.skill:use-me",
    sourcePath: ".skillset/plugins/demo/skills/_drafts/use-me/SKILL.md",
    sourceUnit: "plugin.demo.skill:use-me",
    target: "codex",
  });

  const humanResult = await runStatus(root);
  expect(humanResult.exitCode).toBe(0);
  expect(humanResult.stdout).toContain(
    "project draft [codex]: source=plugin.demo.skill:use-me (.skillset/plugins/demo/skills/_drafts/use-me/SKILL.md); selection=plugins.internal_use.drafts.demo: omitted (side-by-side); effectiveName=draft-use-me; role=project-use; owner=codex; draftOrigin=_drafts; shippedSibling=plugin.demo.skill:use-me"
  );

  const explain = await runExplain(
    root,
    ".agents/skills/draft-use-me/SKILL.md"
  );
  expect(explain.exitCode).toBe(0);
  expect(explain.stdout).toContain("role: project-use");
  expect(explain.stdout).toContain("effective name: draft-use-me");
  expect(explain.stdout).toContain("draft origin: _drafts");
  expect(explain.stdout).toContain(
    "shipped sibling: plugin.demo.skill:use-me"
  );
  expect(explain.stdout).toContain(
    "selection rule: plugins.internal_use.drafts.demo: omitted (side-by-side)"
  );
  expect(explain.stdout).toContain("owner: codex");
});

test("SET-572 status and explain expose only and override policy provenance", async () => {
  const config = (draftPolicy: "only" | "override") => `skillset:
  name: project-draft-policy-status
claude: false
codex: true
cursor: false
plugins:
  internal_use:
    skills:
      demo: true
    drafts:
      demo: ${draftPolicy}
`;
  const root = await fixture({
    "skillset.yaml": config("only"),
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ".skillset/plugins/demo/skills/use-me/SKILL.md": `---
name: use-me
description: Use this skill.
---

Use this skill.
`,
    ".skillset/plugins/demo/skills/_drafts/use-me/SKILL.md": `---
name: use-me
description: Draft this skill.
---

Draft this skill.
`,
  });

  for (const draftPolicy of ["only", "override"] as const) {
    await writeFile(join(root, "skillset.yaml"), config(draftPolicy));
    await buildSkillsetResult(root);
    const effectiveName = draftPolicy === "only" ? "draft-use-me" : "use-me";
    const jsonResult = await runStatus(root, "--json");
    const report = (JSON.parse(jsonResult.stdout) as {
      readonly data: {
        readonly projectUse: readonly Record<string, unknown>[];
      };
    }).data;
    expect(report.projectUse).toContainEqual({
      draftOrigin: "_drafts",
      draftPolicy,
      effectiveName,
      owner: { target: "codex" },
      role: "project-use",
      selectionRule: "plugins.internal_use.skills.demo: true",
      shippedSibling: "plugin.demo.skill:use-me",
      sourcePath: ".skillset/plugins/demo/skills/_drafts/use-me/SKILL.md",
      sourceUnit: "plugin.demo.skill:use-me",
      target: "codex",
    });

    const humanResult = await runStatus(root);
    expect(humanResult.stdout).toContain(
      "plugin internal use: demo/use-me (draft)"
    );
    expect(humanResult.stdout).toContain(`draftPolicy=${draftPolicy}`);
    expect(humanResult.stdout).toContain(`effectiveName=${effectiveName}`);
    const explain = await runExplain(
      root,
      `.agents/skills/${effectiveName}/SKILL.md`
    );
    expect(explain.stdout).toContain(`draft policy: ${draftPolicy}`);
    expect(explain.stdout).toContain(`effective name: ${effectiveName}`);
    expect(explain.stdout).toContain(
      "selection rule: plugins.internal_use.skills.demo: true"
    );
  }
});

test("SET-659 status reports a whole-plugin selection with no live skills", async () => {
  const root = await fixture({
    "skillset.yaml": `skillset:
  name: whole-plugin-status
claude: false
codex: true
cursor: false
plugins:
  internal_use:
    plugins: [demo]
`,
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ".skillset/plugins/demo/skills/_drafts/later/SKILL.md": `---
name: later
description: Not yet shipped.
---

Later.
`,
  });

  const humanResult = await runStatus(root);
  expect(humanResult.stdout).toContain("plugin internal use: demo (plugin)");
});

function statusEntry(target: "claude" | "codex" | "cursor") {
  return {
    effectiveName: "use-me",
    owner: { target },
    role: "project-use",
    selectionRule: "plugins.internal_use.skills.demo: true",
    sourcePath: ".skillset/plugins/demo/skills/use-me/SKILL.md",
    sourceUnit: "plugin.demo.skill:use-me",
    target,
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-project-use-status-");
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return root;
}

async function runStatus(
  root: string,
  ...args: readonly string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(
    [process.execPath, cli, "status", "--root", root, ...args],
    {
      env: { ...Bun.env, NODE_ENV: "test" },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function runExplain(
  root: string,
  path: string
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(
    [process.execPath, cli, "explain", path, "--root", root],
    {
      env: { ...Bun.env, NODE_ENV: "test" },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
