import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildSkillset,
  createOperationalPathContext,
  ISOLATED_OUT_ROOT,
  resolveOperationalPath,
} from "@skillset/core";

import { classifyPluginAdoptionCandidates } from "../plugin-adoption";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";

test("SET-225: one source with Claude, Codex, and Cursor manifests stays one candidate", async () => {
  const root = await pluginFixture({
    "plugins/demo/.claude-plugin/plugin.json": manifest("demo"),
    "plugins/demo/.codex-plugin/plugin.json": manifest("demo"),
    "plugins/demo/.cursor-plugin/plugin.json": manifest("demo"),
    "plugins/demo/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, ["plugins/demo"]);

  expect(result.groups).toEqual([
    {
      identity: "demo",
      paths: ["plugins/demo"],
      primaryPath: "plugins/demo",
      providers: ["claude", "codex", "cursor"],
      relation: "single-source",
    },
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("SET-225: equivalent provider roots converge by manifest identity and source evidence", async () => {
  const root = await pluginFixture({
    "plugins/claude-demo/.claude-plugin/plugin.json": manifest("demo"),
    "plugins/claude-demo/skills/helper/SKILL.md": skill("shared"),
    "plugins/codex-demo/.codex-plugin/plugin.json": manifest("demo"),
    "plugins/codex-demo/skills/helper/SKILL.md": skill("shared"),
    "plugins/cursor-demo/.cursor-plugin/plugin.json": manifest("demo"),
    "plugins/cursor-demo/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, [
    "plugins/cursor-demo",
    "plugins/claude-demo",
    "plugins/codex-demo",
  ]);

  expect(result.groups).toEqual([
    {
      identity: "demo",
      paths: ["plugins/claude-demo", "plugins/codex-demo", "plugins/cursor-demo"],
      primaryPath: "plugins/claude-demo",
      providers: ["claude", "codex", "cursor"],
      relation: "equivalent",
    },
  ]);
  expect(result.diagnostics).toEqual([]);

  const reversed = await classifyPluginAdoptionCandidates(root, [
    "plugins/codex-demo",
    "plugins/claude-demo",
    "plugins/cursor-demo",
  ]);
  expect(reversed).toEqual(result);
});

test("SET-225: equivalent sources with conflicting portable metadata fail before adoption", async () => {
  const root = await pluginFixture({
    "plugins/claude-demo/.claude-plugin/plugin.json": manifest("demo", "Claude description"),
    "plugins/claude-demo/skills/helper/SKILL.md": skill("shared"),
    "plugins/codex-demo/.codex-plugin/plugin.json": manifest("demo", "Codex description"),
    "plugins/codex-demo/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, [
    "plugins/claude-demo",
    "plugins/codex-demo",
  ]);

  expect(result.groups).toHaveLength(2);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "plugin-metadata-conflict",
      evidence: ["portable manifest field description differs across claude, codex"],
      identity: "demo",
      severity: "error",
    }),
  ]);
});

test("SET-225: same-identity divergent sources fail with provider and path evidence", async () => {
  const root = await pluginFixture({
    "plugins/claude-demo/.claude-plugin/plugin.json": manifest("demo", "Demo plugin", "1.0.0", {
      skills: "./skills/",
    }),
    "plugins/claude-demo/skills/helper/SKILL.md": skill("claude body"),
    "plugins/codex-demo/.codex-plugin/plugin.json": manifest("demo", "Different metadata too"),
    "plugins/codex-demo/skills/helper/SKILL.md": skill("codex body"),
  });

  const result = await classifyPluginAdoptionCandidates(root, [
    "plugins/claude-demo",
    "plugins/codex-demo",
  ]);

  expect(result.groups).toHaveLength(2);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "competing-plugin-sources",
      identity: "demo",
      paths: ["plugins/claude-demo", "plugins/codex-demo"],
      providers: ["claude", "codex"],
      severity: "error",
    }),
  ]);
  expect(result.diagnostics[0]?.message).toContain("same plugin identity `demo`");
  expect(result.diagnostics[0]?.recommendation).toContain("one shared plugin source");
});

test("SET-225: different identities with the same material stay separate and warn", async () => {
  const root = await pluginFixture({
    "plugins/alpha/.claude-plugin/plugin.json": manifest("alpha"),
    "plugins/alpha/skills/helper/SKILL.md": skill("shared"),
    "plugins/beta/.codex-plugin/plugin.json": manifest("beta"),
    "plugins/beta/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, ["plugins/beta", "plugins/alpha"]);

  expect(result.groups.map((group) => group.identity)).toEqual(["alpha", "beta"]);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "similar-plugin-sources",
      identities: ["alpha", "beta"],
      paths: ["plugins/alpha", "plugins/beta"],
      severity: "warning",
    }),
  ]);
});

test("SET-225: matching names without shared source evidence never merge", async () => {
  const root = await pluginFixture({
    "plugins/claude-demo/.claude-plugin/plugin.json": manifest("demo"),
    "plugins/codex-demo/.codex-plugin/plugin.json": manifest("demo"),
  });

  const result = await classifyPluginAdoptionCandidates(root, [
    "plugins/claude-demo",
    "plugins/codex-demo",
  ]);

  expect(result.groups).toHaveLength(2);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "competing-plugin-sources",
      identity: "demo",
      severity: "error",
    }),
  ]);
  expect(result.diagnostics[0]?.evidence).toContain("no shared non-manifest source files prove equivalence");
});

test("SET-225: conflicting same-path provider identities become a structured blocker", async () => {
  const root = await pluginFixture({
    "plugins/demo/.claude-plugin/plugin.json": manifest("alpha"),
    "plugins/demo/.codex-plugin/plugin.json": manifest("beta"),
    "plugins/demo/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, ["plugins/demo"]);

  expect(result.groups).toHaveLength(1);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "plugin-identity-conflict",
      paths: ["plugins/demo"],
      providers: ["claude", "codex"],
      severity: "error",
    }),
  ]);
});

test("SET-225: conflicting same-path portable metadata becomes a structured blocker", async () => {
  const root = await pluginFixture({
    "plugins/demo/.claude-plugin/plugin.json": manifest("demo", "Claude description"),
    "plugins/demo/.codex-plugin/plugin.json": manifest("demo", "Codex description"),
    "plugins/demo/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, ["plugins/demo"]);

  expect(result.groups).toHaveLength(1);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "plugin-metadata-conflict",
      evidence: ["portable manifest field description differs across claude, codex"],
      paths: ["plugins/demo"],
      severity: "error",
    }),
  ]);
});

test("SET-225: malformed native manifests become structured blockers", async () => {
  const root = await pluginFixture({
    "plugins/demo/.cursor-plugin/plugin.json": "{not json\n",
    "plugins/demo/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, ["plugins/demo"]);

  expect(result.groups).toHaveLength(1);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "invalid-plugin-manifest",
      paths: ["plugins/demo"],
      providers: ["cursor"],
      severity: "error",
    }),
  ]);
});

test("SET-225: provider version disagreement cannot be normalized away", async () => {
  const root = await pluginFixture({
    "plugins/claude-demo/.claude-plugin/plugin.json": manifest("demo", "Demo", "1.0.0"),
    "plugins/claude-demo/skills/helper/SKILL.md": skill("shared"),
    "plugins/codex-demo/.codex-plugin/plugin.json": manifest("demo", "Demo", "2.0.0"),
    "plugins/codex-demo/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, [
    "plugins/claude-demo",
    "plugins/codex-demo",
  ]);

  expect(result.groups).toHaveLength(2);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "competing-plugin-sources",
      identity: "demo",
      severity: "error",
    }),
  ]);
  expect(result.diagnostics[0]?.evidence).toContain("provider manifest versions differ");
});

test("SET-225: same-path provider version disagreement is a structured blocker", async () => {
  const root = await pluginFixture({
    "plugins/demo/.claude-plugin/plugin.json": manifest("demo", "Demo", "1.0.0"),
    "plugins/demo/.codex-plugin/plugin.json": manifest("demo", "Demo", "2.0.0"),
    "plugins/demo/skills/helper/SKILL.md": skill("shared"),
  });

  const result = await classifyPluginAdoptionCandidates(root, ["plugins/demo"]);

  expect(result.groups).toHaveLength(1);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "plugin-version-conflict",
      paths: ["plugins/demo"],
      providers: ["claude", "codex"],
      severity: "error",
    }),
  ]);
});

test("SET-225: adopt blocks divergent identities before mutating the repo", async () => {
  const root = await pluginFixture({
    "plugins/claude-demo/.claude-plugin/plugin.json": manifest("demo"),
    "plugins/claude-demo/skills/helper/SKILL.md": skill("claude body"),
    "plugins/codex-demo/.codex-plugin/plugin.json": manifest("demo"),
    "plugins/codex-demo/skills/helper/SKILL.md": skill("codex body"),
  });
  const before = await walkFiles(root);

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(false);
  expect(report.write).toBe(false);
  expect(report.imports).toEqual([]);
  expect(report.surveyDiagnostics).toEqual([
    expect.objectContaining({
      code: "competing-plugin-sources",
      identity: "demo",
      severity: "error",
    }),
  ]);
  const markdown = renderAdoptReportMarkdown(report, { rootPath: root });
  expect(markdown).toContain("## Plugin candidate diagnostics");
  expect(markdown).toContain("same plugin identity `demo`");
  expect(markdown).toContain("one shared plugin source");
  expect(markdown).toContain("planned: `skillset.yaml`");
  expect(markdown).not.toContain("created: `skillset.yaml`");

  const cli = await runSkillsetCli("init", "--root", root, "--adopt", "all", "--yes");
  expect(cli.exitCode).toBe(1);
  expect(cli.stdout).toContain("FAIL competing-plugin-sources");
  expect(cli.stdout).toContain("plugins/claude-demo");
  expect(cli.stdout).toContain("blocked before write");
  expect(await walkFiles(root)).toEqual(before);
});

for (const blocker of [
  {
    code: "plugin-identity-conflict",
    files: {
      "plugins/demo/.claude-plugin/plugin.json": manifest("alpha"),
      "plugins/demo/.codex-plugin/plugin.json": manifest("beta"),
      "plugins/demo/skills/helper/SKILL.md": skill("shared"),
    },
    name: "conflicting provider identities",
  },
  {
    code: "invalid-plugin-manifest",
    files: {
      "plugins/demo/.cursor-plugin/plugin.json": "{not json\n",
      "plugins/demo/skills/helper/SKILL.md": skill("shared"),
    },
    name: "a malformed provider manifest",
  },
] as const) {
  test(`SET-225: adopt blocks ${blocker.name} before mutating the repo`, async () => {
    const root = await pluginFixture(blocker.files);
    const before = await walkFiles(root);

    const report = await adoptSkillset(root, { write: true });

    expect(report.ok).toBe(false);
    expect(report.imports).toEqual([]);
    expect(report.surveyDiagnostics).toEqual([
      expect.objectContaining({ code: blocker.code, severity: "error" }),
    ]);
    expect(await walkFiles(root)).toEqual(before);
  });
}

test("SET-225: adopt merges equivalent provider roots into one canonical plugin", async () => {
  const root = await pluginFixture({
    "plugins/claude-demo/.claude-plugin/plugin.json": manifest("demo"),
    "plugins/claude-demo/skills/helper/SKILL.md": skill("shared"),
    "plugins/codex-demo/.codex-plugin/plugin.json": manifest("demo", "Demo plugin", "1.0.0", {
      homepage: "https://example.com/demo",
      interface: { category: "productivity" },
      skills: "./skills/",
    }),
    "plugins/codex-demo/skills/helper/SKILL.md": skill("shared"),
    "plugins/cursor-demo/.cursor-plugin/plugin.json": manifest("demo", "Demo plugin", "1.0.0", {
      category: "development",
      skills: "./skills/",
    }),
    "plugins/cursor-demo/skills/helper/SKILL.md": skill("shared"),
  });

  const plan = await adoptSkillset(root);
  expect(plan.candidates).toEqual([
    {
      kind: "plugin",
      path: "plugins/claude-demo",
      plugin: {
        identity: "demo",
        paths: ["plugins/claude-demo", "plugins/codex-demo", "plugins/cursor-demo"],
        providers: ["claude", "codex", "cursor"],
        relation: "equivalent",
      },
    },
  ]);

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(true);
  expect(report.imports).toHaveLength(1);
  expect(report.imports[0]?.units).toEqual([
    expect.objectContaining({
      kind: "plugin",
      name: "demo",
      sourcePath: "plugins/claude-demo",
    }),
  ]);
  expect(await readFile(join(root, ".skillset/plugins/demo/skillset.yaml"), "utf8")).toContain(
    "path: plugins/claude-demo"
  );
  expect(await exists(join(root, ".skillset/plugins/demo/.claude-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/demo/.codex-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/demo/.cursor-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/demo/skills/helper/SKILL.md"))).toBe(true);

  const configPath = join(root, ".skillset/plugins/demo/skillset.yaml");
  const importedConfig = await readFile(configPath, "utf8");
  expect(importedConfig.match(/description:/gu)).toHaveLength(1);
  expect(importedConfig).not.toContain("skills:");
  expect(importedConfig).toContain("homepage: https://example.com/demo");
  expect(importedConfig).toContain("category: productivity");
  expect(importedConfig).toContain("category: development");
  await Bun.write(
    configPath,
    importedConfig.replace("description: Demo plugin", "description: Updated canonical description")
  );
  await rm(join(root, ".skillset/plugins/demo/skills"), { recursive: true });
  await buildSkillset(root, { isolated: true });

  const generatedRoot = resolveOperationalPath(
    createOperationalPathContext(root),
    ISOLATED_OUT_ROOT
  );
  for (const provider of ["claude", "codex", "cursor"] as const) {
    const manifestPath = join(
      generatedRoot,
      "plugins",
      "demo",
      provider,
      `.${provider}-plugin`,
      "plugin.json"
    );
    const generatedManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      category?: string;
      description?: string;
      homepage?: string;
      interface?: { category?: string };
      skills?: string;
    };
    expect(generatedManifest.description).toBe("Updated canonical description");
    expect(generatedManifest.homepage).toBe("https://example.com/demo");
    expect(generatedManifest.skills).toBeUndefined();
    if (provider === "codex") {
      expect(generatedManifest.interface?.category).toBe("productivity");
    }
    if (provider === "cursor") {
      expect(generatedManifest.category).toBe("development");
    }
  }
});

test("SET-225: adopt keeps similar different identities separate and reports the warning", async () => {
  const root = await pluginFixture({
    "plugins/alpha/.claude-plugin/plugin.json": manifest("alpha"),
    "plugins/alpha/skills/helper/SKILL.md": skill("shared"),
    "plugins/beta/.codex-plugin/plugin.json": manifest("beta"),
    "plugins/beta/skills/helper/SKILL.md": skill("shared"),
  });

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(true);
  expect(report.surveyDiagnostics).toEqual([
    expect.objectContaining({
      code: "similar-plugin-sources",
      identities: ["alpha", "beta"],
      severity: "warning",
    }),
  ]);
  expect(report.imports.map((result) => result.units[0]?.name)).toEqual(["alpha", "beta"]);
  expect(await exists(join(root, ".skillset/plugins/alpha/skillset.yaml"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/beta/skillset.yaml"))).toBe(true);
});

test("SET-225: root and nested provider candidates respect plugin boundaries", async () => {
  const root = await pluginFixture({
    ".claude-plugin/plugin.json": manifest("demo"),
    "skills/helper/SKILL.md": skill("shared"),
    "plugins/codex-demo/.codex-plugin/plugin.json": manifest("demo"),
    "plugins/codex-demo/skills/helper/SKILL.md": skill("shared"),
  });

  const plan = await adoptSkillset(root);
  expect(plan.candidates).toEqual([
    {
      kind: "plugin",
      path: ".",
      plugin: {
        identity: "demo",
        paths: [".", "plugins/codex-demo"],
        providers: ["claude", "codex"],
        relation: "equivalent",
      },
    },
  ]);

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(true);
  expect(report.imports).toHaveLength(1);
  expect(report.imports[0]?.units[0]?.sourcePath).toBe(".");
  expect(await exists(join(root, ".skillset/plugins/demo/.claude-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/demo/.codex-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/demo/plugins/codex-demo"))).toBe(false);
});

test("SET-225: a root plugin does not absorb a separate nested plugin", async () => {
  const root = await pluginFixture({
    ".claude-plugin/plugin.json": manifest("alpha"),
    "skills/helper/SKILL.md": skill("alpha body"),
    "plugins/beta/.codex-plugin/plugin.json": manifest("beta"),
    "plugins/beta/skills/helper/SKILL.md": skill("beta body"),
  });

  const plan = await adoptSkillset(root);
  const report = await adoptSkillset(root, { candidates: ["plugin:."], write: true });

  expect(report.ok).toBe(true);
  expect(plan.candidates.map((candidate) => `${candidate.kind}:${candidate.path}`)).toEqual(["plugin:.", "plugin:plugins/beta"]);
  expect(report.imports.map((result) => result.units[0]?.name)).toEqual(["alpha"]);
  expect(await exists(join(root, ".skillset/plugins/alpha/plugins/beta"))).toBe(false);
  expect(await exists(join(root, ".skillset/plugins/beta/skillset.yaml"))).toBe(false);
});

function manifest(
  name: string,
  description = "Demo plugin",
  version = "1.0.0",
  fields: Readonly<Record<string, unknown>> = {}
): string {
  return `${JSON.stringify({ description, name, version, ...fields }, null, 2)}\n`;
}

function skill(body: string): string {
  return `---\nname: helper\ndescription: Helper skill.\n---\n\n${body}\n`;
}

async function pluginFixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-plugin-adoption-"));
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await Bun.write(absolutePath, content);
  }
  return root;
}

async function walkFiles(root: string, current = root): Promise<Set<string>> {
  const files = new Set<string>();
  for (const entry of (await readdir(current)).sort()) {
    const path = join(current, entry);
    if ((await stat(path)).isDirectory()) {
      for (const child of await walkFiles(root, path)) files.add(child);
    } else {
      files.add(path.slice(root.length + 1));
    }
  }
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function runSkillsetCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
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
