import { describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { validateCliResult, type SkillsetCliResult } from "@skillset/schema";
import { buildSkillset } from "@skillset/core";

const cli = path.join(import.meta.dir, "..", "cli.ts");
const repoRoot = path.resolve(import.meta.dir, "../../../..");
const fixtureRoot = path.join(repoRoot, "fixtures", "kitchen-sink");

describe("SET-287 finite read-only JSON", () => {
  for (const route of [
    ["check", "--root", fixtureRoot],
    ["diff", "--root", fixtureRoot],
    ["list", "--root", fixtureRoot],
    ["explain", ".skillset/plugins/kitchen/skills/sink/SKILL.md", "--root", fixtureRoot],
    ["lookup", "skill", "frontmatter"],
  ] as const) {
    test(`${route.join(" ")} emits one versioned result`, async () => {
      const result = await runJsonRoute(...route);
      expect(result.stderr).toBe("");
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
      expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
      expect(envelope.exitCode).toBe(result.exitCode);
      if (route[0] === "diff" || route[0] === "explain") expect(envelope.kind).toBe("data");
      if (route[0] === "check") {
        expect(envelope.data).toHaveProperty("providerUpdatePaths");
      }
    });
  }

  test("init JSON preserves preview versus confirmed write authority", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-json-init-"));
    const preview = await runJsonRoute("init", "--root", root);
    const previewEnvelope = JSON.parse(preview.stdout) as SkillsetCliResult & { data: { state: string; writes: unknown[] } };
    expect(previewEnvelope.data).toMatchObject({ state: "planned", writes: [] });
    expect(await readdir(root)).toEqual([]);

    const written = await runJsonRoute("init", "--root", root, "--yes");
    const writtenEnvelope = JSON.parse(written.stdout) as SkillsetCliResult & { data: { state: string; writes: unknown[] } };
    expect(writtenEnvelope.data.state).toBe("written");
    expect(writtenEnvelope.data.writes.length).toBeGreaterThan(0);
    expect(writtenEnvelope.data.writes.every((entry) => typeof entry === "string")).toBe(true);
    expect(writtenEnvelope.data.writes).toContain(".git");

    const seeded = await runJsonRoute("init", "--root", root, "--yes");
    const seededEnvelope = JSON.parse(seeded.stdout) as SkillsetCliResult & { data: { writes: unknown[] } };
    expect(seededEnvelope.data.writes).toEqual([".skillset/changes/state.json"]);

    const unchanged = await runJsonRoute("init", "--root", root, "--yes");
    const unchangedEnvelope = JSON.parse(unchanged.stdout) as SkillsetCliResult & { data: { writes: unknown[] } };
    expect(unchangedEnvelope.data.writes).toEqual([]);
  });

  test("init JSON resolves a relative --root once from the invocation cwd", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "skillset-json-relative-root-"));
    const proc = Bun.spawn(
      [process.execPath, cli, "init", "--root", "workspace", "--yes", "--json"],
      {
        cwd: parent,
        env: { ...process.env, NODE_ENV: "test" },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(validateCliResult(JSON.parse(stdout))).toEqual({ diagnostics: [], ok: true });
    await expect(readFile(path.join(parent, "workspace", "skillset.yaml"), "utf8")).resolves.toContain(
      "skillset:"
    );
    await expect(
      readFile(path.join(parent, "workspace", "workspace", "skillset.yaml"), "utf8")
    ).rejects.toThrow();
  });

  test("init JSON stays stderr-clean when the known-workspace index is unwritable", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "skillset-json-init-xdg-"));
    const root = path.join(parent, "workspace");
    const configHome = path.join(parent, "not-a-directory");
    await writeFile(configHome, "occupied\n");
    const proc = Bun.spawn([process.execPath, cli, "init", "--root", root, "--yes", "--json"], {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: "test", XDG_CONFIG_HOME: configHome },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(validateCliResult(JSON.parse(stdout))).toEqual({ diagnostics: [], ok: true });
  });

  test("init JSON reports a seeded release-state write", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-json-init-baseline-"));
    await mkdir(path.join(root, ".skillset", "skills", "demo"), { recursive: true });
    await writeFile(
      path.join(root, ".skillset", "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n"
    );

    const written = await runJsonRoute("init", "--root", root, "--yes");
    const envelope = JSON.parse(written.stdout) as SkillsetCliResult & { data: { writes: string[] } };

    expect(envelope.data.writes).toContain(".skillset/changes/state.json");
  });

  test("import JSON reports the imported source and seeded release state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-json-import-baseline-"));
    const source = path.join(root, "incoming", "SKILL.md");
    await mkdir(path.join(root, ".skillset"), { recursive: true });
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(path.join(root, "skillset.yaml"), "skillset:\n  name: import-json\n");
    await writeFile(source, "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n");

    const imported = await runJsonRoute("import", source, "--kind", "skill", "--root", root);
    const envelope = JSON.parse(imported.stdout) as SkillsetCliResult & { data: { writes: string[] } };

    expect(envelope.data.writes.some((write) => write.endsWith("/.skillset/skills/demo"))).toBe(true);
    expect(envelope.data.writes).toContain(".skillset/changes/state.json");
  });

  test("init adoption JSON reports imported units and release state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-json-adopt-writes-"));
    await runJsonRoute("init", "--yes", "--root", root);
    await mkdir(path.join(root, ".agents", "skills", "one"), { recursive: true });
    await writeFile(
      path.join(root, ".agents", "skills", "one", "SKILL.md"),
      "---\nname: one\ndescription: One.\n---\n\nBody.\n"
    );

    const adopted = await runJsonRoute("init", "--adopt", "all", "--yes", "--root", root);
    const envelope = JSON.parse(adopted.stdout) as SkillsetCliResult & { data: { writes: string[] } };

    expect(envelope.data.writes).toContain(".skillset/skills/one");
    expect(envelope.data.writes).toContain(".skillset/changes/state.json");
    expect(envelope.data.writes).toContain(".skillset/cache/adopt/report.md");
    expect(envelope.data.writes).toContain(".skillset/cache/adopt/report.json");
  });

  test("build apply emits a finite summary and every changed path", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "skillset-json-build-"));
    const root = path.join(parent, "workspace");
    await cp(fixtureRoot, root, { recursive: true });

    const result = await runJsonRoute("build", "--root", root, "--yes");
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult & {
      data: {
        report: { data?: unknown; renderedFiles: number; writes: { paths: string[] } };
        writes: string[];
      };
    };
    expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
    expect(envelope.data.report.data).toBeUndefined();
    expect(envelope.data.report.renderedFiles).toBeGreaterThan(0);
    expect(envelope.data.writes).toEqual(envelope.data.report.writes.paths);
  });

  test("build JSON stays stderr-clean when the known-workspace index is unwritable", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "skillset-json-build-xdg-"));
    const root = path.join(parent, "workspace");
    const configHome = path.join(parent, "not-a-directory");
    await cp(fixtureRoot, root, { recursive: true });
    await writeFile(configHome, "occupied\n");
    const proc = Bun.spawn(
      [process.execPath, cli, "build", "--root", root, "--yes", "--json"],
      {
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: "test", XDG_CONFIG_HOME: configHome },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(validateCliResult(JSON.parse(stdout))).toEqual({ diagnostics: [], ok: true });
  });

  test("build JSON normalizes output-safety diagnostics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-json-build-diagnostics-"));
    await mkdir(path.join(root, ".skillset", "rules"), { recursive: true });
    await writeFile(
      path.join(root, "skillset.yaml"),
      "skillset:\n  name: build-diagnostics-json\nclaude: false\ncodex: true\n"
    );
    await writeFile(path.join(root, ".skillset", "rules", "guide.md"), "# Managed guidance\n");
    await writeFile(path.join(root, "AGENTS.md"), "# Unmanaged guidance\n");

    const result = await runJsonRoute("build", "--root", root, "--yes");
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
    expect(envelope.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "AGENTS.md", severity: "warning" }),
    ]));
  });

  test("change migrate does not report a ledger write for a no-op", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-json-migrate-"));
    await mkdir(path.join(root, ".skillset"), { recursive: true });
    await writeFile(path.join(root, "skillset.yaml"), "skillset:\n  name: migrate-json\n");

    const result = await runJsonRoute("change", "migrate", "--root", root, "--yes");
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult & { data: { writes: string[] } };
    expect(envelope.data.writes).toEqual([]);
  });

  for (const route of [
    ["change", "status", "--root", repoRoot],
    ["change", "list", "--root", repoRoot],
    ["change", "history", "--root", repoRoot],
  ] as const) {
    test(`${route.slice(0, 2).join(" ")} emits a versioned ledger result`, async () => {
      const result = await runJsonRoute(...route);
      expect(result.stderr).toBe("");
      const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
      expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
      expect(envelope.exitCode).toBe(result.exitCode);
    });
  }


  test("change check keeps a negative ledger result structured", async () => {
    const result = await runJsonRoute("change", "check", "--root", repoRoot);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
    expect(envelope.command).toBe("change.check");
    expect(envelope.exitCode).toBe(result.exitCode);
    if (result.exitCode !== 0) {
      expect(envelope.kind).toBe("diagnostics");
      expect(envelope.diagnostics.length).toBeGreaterThan(0);
    }
  });

  test("change entry JSON preserves source hash evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-change-json-"));
    const skillPath = path.join(root, ".skillset", "skills", "demo", "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(
      path.join(root, "skillset.yaml"),
      "skillset:\n  name: change-json\nclaude: true\ncodex: false\n"
    );
    await writeFile(
      skillPath,
      "---\nname: demo\ndescription: Demo.\n---\n\nOriginal body.\n"
    );
    await commitFixture(root);
    await writeFile(
      skillPath,
      "---\nname: demo\ndescription: Demo.\n---\n\nChanged body.\n"
    );
    const reasonPath = path.join(root, "reason.md");
    await writeFile(reasonPath, "Record source-hash evidence for the isolated JSON fixture.\n");
    const added = await runRoute(
      "change",
      "add",
      "--root",
      root,
      "--since",
      "HEAD",
      "--scope",
      "skill:demo",
      "--bump",
      "patch",
      "--reason-file",
      reasonPath
    );
    expect(added.exitCode).toBe(0);

    const result = await runJsonRoute("change", "list", "--root", root);
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    const entries = envelope.data.entries as unknown as readonly {
      readonly sourceHashes: Readonly<Record<string, readonly string[]>>;
    }[];
    expect(entries.length).toBeGreaterThan(0);
    expect(Object.keys(entries[0]?.sourceHashes ?? {}).length).toBeGreaterThan(0);
    expect(Object.values(entries[0]?.sourceHashes ?? {}).every(Array.isArray)).toBe(true);
  });

  test("diff JSON preserves source diagnostics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-diff-json-"));
    await mkdir(path.join(root, ".skillset", "plugins", "alpha", "skills", "modelish"), {
      recursive: true,
    });
    await writeFile(path.join(root, "skillset.yaml"), "skillset:\n  name: diff-json\n");
    await writeFile(
      path.join(root, ".skillset", "plugins", "alpha", "skillset.yaml"),
      "skillset:\n  name: alpha\n"
    );
    await writeFile(
      path.join(root, ".skillset", "plugins", "alpha", "skills", "modelish", "SKILL.md"),
      "---\nname: modelish\ndescription: Model warning.\nmodel: gpt-5\n---\n\nBody.\n"
    );

    const result = await runJsonRoute("diff", "--root", root);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    expect(envelope.diagnostics).toEqual([
      expect.objectContaining({ code: "source-warning", severity: "warning" }),
    ]);
  });

  test("explain JSON promotes an unknown path note to a diagnostic", async () => {
    const result = await runJsonRoute("explain", "missing/path", "--root", fixtureRoot);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
    expect(envelope).toMatchObject({
      command: "explain",
      diagnostics: [{ code: "explain.path-unknown", path: "missing/path", severity: "error" }],
      exitCode: 1,
      kind: "diagnostics",
      ok: false,
    });
  });

  test("check keeps lint failures structured", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-check-json-"));
    await mkdir(path.join(root, ".skillset", "skills", "demo"), { recursive: true });
    await writeFile(path.join(root, "skillset.yaml"), "skillset:\n  name: check-json\nclaude: true\ncodex: false\n");
    await writeFile(
      path.join(root, ".skillset", "skills", "demo", "SKILL.md"),
      "---\nname: wrong-name\ndescription: Demo.\n---\n\nBody.\n"
    );

    const result = await runJsonRoute("check", "--root", root);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
    expect(envelope).toMatchObject({
      command: "check",
      exitCode: 1,
      ok: false,
    });
    expect(envelope.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "skill-name-directory-mismatch", severity: "error" }),
    ]));
  });

  test("check JSON remains stderr-clean when the known-workspace index is unwritable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-json-check-clean-"));
    await mkdir(path.join(root, ".skillset", "skills", "demo"), { recursive: true });
    await writeFile(path.join(root, "skillset.yaml"), "skillset:\n  name: clean-json-check\n");
    await writeFile(
      path.join(root, ".skillset", "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n"
    );
    await buildSkillset(root);
    const configHome = await mkdtemp(path.join(tmpdir(), "skillset-json-xdg-"));
    await chmod(configHome, 0o555);
    const proc = Bun.spawn(
      [process.execPath, cli, "check", "--root", root, "--json"],
      {
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: "test", XDG_CONFIG_HOME: configHome },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    await chmod(configHome, 0o755);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(validateCliResult(JSON.parse(stdout))).toEqual({ diagnostics: [], ok: true });
  });

  for (const route of [
    ["build", "--root", fixtureRoot],
    ["update", "--root", fixtureRoot],
  ] as const) {
    test(`${route[0]} preview emits a versioned plan without writes`, async () => {
      const result = await runJsonRoute(...route);
      expect(result.stderr).toBe("");
      const envelope = JSON.parse(result.stdout) as SkillsetCliResult & { data: { state: string; writes: unknown[] } };
      expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
      expect(envelope.data.state).toBe("planned");
      expect(envelope.data.writes).toEqual([]);
    });
  }
});

async function runJsonRoute(...args: readonly string[]): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return runRoute(...args, "--json");
}

async function runRoute(...args: readonly string[]): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn([process.execPath, cli, ...args], {
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

async function commitFixture(root: string): Promise<void> {
  await runGit(root, "init", "-q");
  await runGit(root, "config", "user.email", "skillset@example.com");
  await runGit(root, "config", "user.name", "Skillset Test");
  await runGit(root, "add", ".");
  await runGit(root, "commit", "-qm", "baseline");
}

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stderr: "pipe", stdout: "pipe" });
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(stderr.trim());
}
