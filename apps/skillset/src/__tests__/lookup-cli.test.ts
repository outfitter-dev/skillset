import { expect, test } from "bun:test";
import { join } from "node:path";

test("SET-220: lookup without a subject lists static reference subjects", async () => {
  const result = await runSkillsetCli("lookup");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("skillset lookup subjects");
  expect(result.stdout).toContain("skill: Adaptive skill source frontmatter");
  expect(result.stdout).toContain("--frontmatter --fields --field <path>");
});

test("SET-220: lookup skill frontmatter renders schema-backed fields", async () => {
  const text = await runSkillsetCli("lookup", "skill", "--frontmatter");
  const json = await runSkillsetCli("lookup", "skill", "--frontmatter", "--json");

  expect(text.exitCode).toBe(0);
  expect(text.stdout).toContain("skillset lookup skill");
  expect(text.stdout).toContain("description: string");
  expect(text.stdout).toContain("resources:");

  expect(json.exitCode).toBe(0);
  const report = JSON.parse(json.stdout) as {
    readonly fields: readonly { readonly contractId: string; readonly path: string }[];
  };
  expect(report.fields.map((field) => `${field.contractId}:${field.path}`)).toContain("skill-frontmatter:resources");
});

test("SET-220: lookup workspace nested field values", async () => {
  const result = await runSkillsetCli("lookup", "workspace", "--field", "compile.targets", "--values", "--json");

  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout) as {
    readonly fields: readonly { readonly path: string; readonly values?: readonly string[] }[];
  };
  expect(report.fields).toEqual([
    expect.objectContaining({
      path: "compile.targets",
      values: ["claude", "codex"],
    }),
  ]);
});

test("SET-220: lookup hooks events and Codex compatibility", async () => {
  const result = await runSkillsetCli("lookup", "hooks", "--events", "--compat", "codex");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("[codex] pre-tool-use.command.input");
  expect(result.stdout).toContain("[codex] plugin-hooks: pass_through");
});

test("SET-220: lookup plugin bin compatibility reports Codex unsupported reason", async () => {
  const result = await runSkillsetCli("lookup", "plugin", "bin", "--compat", "codex", "--json");

  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout) as {
    readonly compatibility: readonly { readonly featureId: string; readonly reason?: string; readonly status: string; readonly target: string }[];
  };
  expect(report.compatibility).toEqual([
    expect.objectContaining({
      featureId: "plugin-bin",
      status: "unsupported",
      target: "codex",
    }),
  ]);
  expect(report.compatibility[0]?.reason).toContain("Codex plugins");
});

test("SET-220: lookup target lens aliases filter non-compat views", async () => {
  const result = await runSkillsetCli("lookup", "hooks", "--events", "--claude", "--json");

  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout) as {
    readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
    readonly events: readonly unknown[];
    readonly targets: readonly string[];
  };
  expect(report.targets).toEqual(["claude"]);
  expect(report.events).toEqual([]);
  expect(report.diagnostics).toContainEqual(expect.objectContaining({
    code: "lookup/events/not-enumerated",
    severity: "warning",
  }));
});

test("SET-220: lookup invalid combinations and targets produce helpful diagnostics", async () => {
  const invalidView = await runSkillsetCli("lookup", "workspace", "--frontmatter", "--json");
  const invalidTarget = await runSkillsetCli("lookup", "hooks", "--compat", "cursor");

  expect(invalidView.exitCode).toBe(1);
  const report = JSON.parse(invalidView.stdout) as {
    readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly severity: string }[];
  };
  expect(report.diagnostics).toContainEqual({
    code: "lookup/frontmatter/not-applicable",
    message: "Workspace configuration uses fields; use --fields or --field instead of --frontmatter.",
    severity: "error",
  });

  expect(invalidTarget.exitCode).toBe(1);
  expect(invalidTarget.stderr).toContain("unknown lookup compatibility target cursor");
});

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
