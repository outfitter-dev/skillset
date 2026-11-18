import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";

const ROOT = join(import.meta.dir, "..", "..");
const SKILL = join(ROOT, ".skillset/plugins/skillset/skills/skillset");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const windows = process.platform === "win32";
const cases = [
  { name: "missing", version: null, expected: "missing" },
  { name: "qualified", version: "0.30.0", expected: "compatible" },
  { name: "stale", version: "0.29.0", expected: "incompatible" },
  { name: "newer unqualified", version: "0.31.0", expected: "incompatible" },
  { name: "prerelease", version: "0.30.0-beta.1", expected: "unknown" },
  { name: "build metadata", version: "0.30.0+local", expected: "unknown" },
  { name: "malformed", version: "skillset 0.30.0", expected: "unknown" },
  { name: "multiple lines", version: "0.30.0\n0.30.0", expected: "unknown" },
  { name: "extra blank line", version: "0.30.0\n", expected: "unknown" },
  { name: "leading zero", version: "00.30.0", expected: "unknown" },
  { name: "missing segment", version: "0.30", expected: "unknown" },
  { name: "extra segment", version: "0.30.0.1", expected: "unknown" },
  { name: "failed command", version: "0.30.0", exit: 1, expected: "unknown" },
] as const;

async function fixture(version: string | null, exit = 0) {
  const root = await createTestFixtureRoot("skillset-router-");
  roots.push(root);
  const bin = join(root, "empty path");
  const workspace = join(root, "workspace with spaces");
  await mkdir(bin);
  await mkdir(workspace);
  if (version !== null) {
    const executable = join(bin, windows ? "skillset.cmd" : "skillset");
    await writeFile(executable, windows
      ? `@echo off\r\nif not "%~1"=="--version" exit /b 77\r\n${version.split("\n").map((line) => line ? `echo ${line}` : "echo.").join("\r\n")}\r\nexit /b ${exit}\r\n`
      : `#!/bin/sh\n[ "$1" = --version ] || exit 77\nprintf '%s\\n' '${version}'\nexit ${exit}\n`);
    await chmod(executable, 0o755);
  }
  return { root, bin, workspace };
}
async function probe(bin: string, workspace: string, scope = "repo", packaged = false) {
  const skill = packaged ? join(ROOT, "plugins/skillset/skills/skillset") : SKILL;
  const command = windows
    ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), "-NoProfile", "-NonInteractive", "-File", join(skill, "scripts/preflight.ps1"), "-Root", workspace, "-Scope", scope]
    : ["/bin/sh", join(skill, "scripts/preflight.sh"), workspace, scope];
  // Windows treats Path and PATH as one key; remove inherited spellings before
  // adding the fixture path so the sandbox's pinned Bun cannot shadow our stubs.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH")
  );
  const proc = Bun.spawn(command, { env: { ...env, PATH: bin }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  return Object.fromEntries(stdout.trim().split(/\r?\n/u).map((line) => line.split("=")));
}

describe("bundled dependency-free preflight", () => {
  for (const entry of cases) {
    test(entry.name, async () => {
      const { bin, workspace } = await fixture(entry.version, "exit" in entry ? entry.exit : 0);
      const result = await probe(bin, workspace);
      expect(result.cli).toBe(entry.expected);
      expect(result.compatibilityScope).toBe("entry-preview");
      expect(result.node).toBe("missing");
      expect(result.npm).toBe("missing");
      expect(result.bun).toBe("missing");
      expect(result.workspaceConfig).toBe("absent");
      expect(result.sourceDirectory).toBe("absent");
      expect(await readdir(workspace)).toEqual([]);
    });
  }
  test("inventories partial workspace and provider cues without running runtimes or changing files", async () => {
    const { bin, workspace } = await fixture(null);
    await writeFile(join(workspace, "skillset.yaml"), "preserve me");
    await mkdir(join(workspace, ".claude"));
    for (const name of ["node", "npm", "bun"]) {
      const file = join(bin, windows ? `${name}.cmd` : name);
      await writeFile(file, windows ? "@exit /b 99\r\n" : "#!/bin/sh\nexit 99\n");
      await chmod(file, 0o755);
    }
    const before = await readdir(workspace);
    const result = await probe(bin, workspace, "user");
    expect(result).toMatchObject({ scope: "user", workspaceConfig: "present", sourceDirectory: "absent", claudeDirectory: "present", node: "present", npm: "present", bun: "present" });
    expect(await readdir(workspace)).toEqual(before);
    expect(await readFile(join(workspace, "skillset.yaml"), "utf8")).toBe("preserve me");
    await rm(join(workspace, "skillset.yaml"));
    await mkdir(join(workspace, ".skillset"));
    expect(await probe(bin, workspace)).toMatchObject({ workspaceConfig: "absent", sourceDirectory: "present", scope: "repo" });
  });
  test("generated package includes the same executable preflight and compatibility contract", async () => {
    const { bin, workspace } = await fixture("0.30.0");
    expect(await probe(bin, workspace, "repo", true)).toEqual(await probe(bin, workspace));
    for (const path of ["scripts/preflight.sh", "scripts/preflight.ps1", "scripts/compatibility.env"]) {
      expect(await readFile(join(ROOT, "plugins/skillset/skills/skillset", path), "utf8")).toBe(await readFile(join(SKILL, path), "utf8"));
    }
  });
});

test("router is lean and its directly linked references are packaged", async () => {
  const router = await readFile(join(SKILL, "SKILL.md"), "utf8");
  expect(router.length).toBeLessThan(6000);
  const links = [...router.matchAll(/\]\((references\/[^)]+)\)/gu)].map((match) => match[1]!);
  expect(new Set(links).size).toBe(6);
  for (const link of new Set(links)) {
    const source = link === "references/capability-design.md"
      ? join(ROOT, ".skillset/plugins/skillset/shared", link)
      : join(SKILL, link);
    expect(await readFile(join(ROOT, "plugins/skillset/skills/skillset", link), "utf8")).toBe(await readFile(source, "utf8"));
  }
});
