import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");

let tempRoot = "";
let workspaceRoot = "";
let env: Record<string, string> = {};

function writeSkill(root: string, name: string, body: string): void {
  const skillDir = join(root, ".claude", "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), body, "utf8");
}

function buildEnv(root: string, projectRoot: string): Record<string, string> {
  const xdgRoot = join(root, "xdg");
  const baseEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      baseEnv[key] = value;
    }
  }
  return {
    ...baseEnv,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(xdgRoot, "config"),
    XDG_CACHE_HOME: join(xdgRoot, "cache"),
    XDG_DATA_HOME: join(xdgRoot, "data"),
    SKILLSET_PROJECT_ROOT: projectRoot,
    SKILLSET_OUTPUT: "json",
    NO_COLOR: "1",
  };
}

async function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", "apps/cli/src/index.ts", "--", ...args], {
    cwd: repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "skillset-e2e-"));
  workspaceRoot = join(tempRoot, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  writeSkill(workspaceRoot, "alpha", "# Alpha Skill\nReturn ALPHA_SENTINEL.\n");
  env = buildEnv(tempRoot, workspaceRoot);
});

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("cli e2e", () => {
  it("indexes skills into cache", async () => {
    const result = await runCli(["index"]);
    expect(result.exitCode).toBe(0);

    const cachePath = join(workspaceRoot, ".skillset", "cache.json");
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as {
      skills: Record<string, unknown>;
    };
    expect(Object.keys(cache.skills)).toContain("project:alpha");
  });

  it("loads a skill by alias", async () => {
    const indexResult = await runCli(["index"]);
    expect(indexResult.exitCode).toBe(0);

    const result = await runCli(["load", "alpha"]);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      skillRef: string;
      content: string;
    };
    expect(payload.skillRef).toBe("project:alpha");
    expect(payload.content).toContain("ALPHA_SENTINEL");
  });

  it("reports stats in json", async () => {
    const indexResult = await runCli(["index"]);
    expect(indexResult.exitCode).toBe(0);

    const result = await runCli(["stats"]);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      totalIndexed: number;
      totalVisible: number;
      scopes: Record<string, number>;
    };
    expect(payload.totalIndexed).toBeGreaterThanOrEqual(1);
    expect(payload.totalVisible).toBeGreaterThanOrEqual(1);
    expect(payload.scopes.project).toBeGreaterThanOrEqual(1);
  });
});
