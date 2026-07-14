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
  const report = readResultData(json.stdout) as {
    readonly fields: readonly { readonly contractId: string; readonly path: string }[];
  };
  expect(report.fields.map((field) => `${field.contractId}:${field.path}`)).toContain("skill-frontmatter:resources");
});

test("SET-220: lookup workspace nested field values", async () => {
  const result = await runSkillsetCli("lookup", "workspace", "--field", "compile.targets", "--values", "--json");

  expect(result.exitCode).toBe(0);
  const report = readResultData(result.stdout) as {
    readonly fields: readonly { readonly path: string; readonly values?: readonly string[] }[];
  };
  expect(report.fields).toEqual([
    expect.objectContaining({
      path: "compile.targets",
      values: ["claude", "codex", "cursor"],
    }),
  ]);
});

test("SET-220: lookup hooks events and Codex compatibility", async () => {
  const result = await runSkillsetCli("lookup", "hooks", "--events", "--compat", "codex");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("[codex] PreToolUse matcher: tool/provider-native handlers: command");
  expect(result.stdout).toContain("required: cwd");
  expect(result.stdout).toContain("output: decision, hookSpecificOutput, reason, systemMessage unsupported output: continue, stopReason, suppressOutput");
  expect(result.stdout).toContain("[codex] PreCompact matcher: compact-trigger/exact-values values: manual, auto");
  expect(result.stdout).toContain("[codex] plugin-hooks: pass_through");
  expect(result.stdout).toContain("[codex] adaptive-hooks:");
});

test("SET-130: lookup skill tools exposes the realization matrix", async () => {
  const text = await runSkillsetCli("lookup", "skill", "tools", "--compat", "claude,codex,cursor");
  const json = await runSkillsetCli("lookup", "skill", "tools", "--compat", "claude,codex,cursor", "--json");

  expect(text.exitCode).toBe(0);
  expect(text.stdout).toContain("tools realization:");
  expect(text.stdout).toContain("[claude] read grant: transformed via skill-frontmatter emits: allowed-tools: Read");
  expect(text.stdout).toContain("[codex] write constrain: settings-required via agent-definition (not rendered)");
  expect(text.stdout).toContain("[cursor] mcp: unsupported via none (not rendered)");

  expect(json.exitCode).toBe(0);
  const report = readResultData(json.stdout) as {
    readonly compatibility: readonly { readonly featureId: string; readonly status: string; readonly target: string }[];
    readonly realizations: readonly {
      readonly aspect: string;
      readonly direction?: string;
      readonly emits?: string;
      readonly rendered: boolean;
      readonly surface: string;
      readonly target: string;
      readonly tier: string;
    }[];
  };
  expect(report.compatibility.map((item) => `${item.target}:${item.status}`)).toEqual([
    "claude:transformed",
    "codex:metadata_only",
    "cursor:metadata_only",
  ]);

  const rendered = report.realizations.filter((row) => row.rendered);
  for (const target of ["claude", "codex", "cursor"]) {
    const aspects = new Set(rendered.filter((row) => row.target === target).map((row) => row.aspect));
    expect([...aspects].sort()).toEqual(["mcp", "read", "search", "shell", "write"]);
  }
  expect(
    report.realizations.some(
      (row) => row.target === "cursor" && row.aspect === "write" && row.tier === "settings-required"
    )
  ).toBe(true);
  expect(
    rendered
      .filter((row) => row.target === "codex")
      .every((row) => row.tier === "metadata-only" && row.surface === "metadata")
  ).toBe(true);
});

test("SET-220: lookup hooks adaptive lens shows adaptive hook fields", async () => {
  const result = await runSkillsetCli("lookup", "hooks", "adaptive", "--fields", "--schema", "--examples", "--compat", "codex", "--json");

  expect(result.exitCode).toBe(0);
  const report = readResultData(result.stdout) as {
    readonly compatibility: readonly { readonly featureId: string }[];
    readonly examples: readonly { readonly contractId: string }[];
    readonly fields: readonly { readonly contractId: string; readonly path: string }[];
    readonly schema?: { readonly id: string };
  };
  expect(report.schema?.id).toBe("adaptive-hook");
  expect(report.fields.map((field) => `${field.contractId}:${field.path}`)).toContain("adaptive-hook:run");
  expect(report.examples.map((example) => example.contractId)).toEqual(["adaptive-hook"]);
  expect(report.compatibility.map((item) => item.featureId)).toEqual(["adaptive-hooks"]);
});

test("SET-232: lookup hooks toolkit lens reports runtime context support", async () => {
  const result = await runSkillsetCli("lookup", "hooks", "toolkit", "--field", "context.env", "--values", "--compat", "codex", "--json");

  expect(result.exitCode).toBe(0);
  const report = readResultData(result.stdout) as {
    readonly compatibility: readonly { readonly featureId: string; readonly note?: string; readonly status: string; readonly target: string }[];
    readonly fields: readonly { readonly path: string; readonly values?: readonly string[] }[];
  };
  expect(report.fields).toEqual([
    expect.objectContaining({
      path: "context.env",
      values: ["hook.event", "provider", "session.id"],
    }),
  ]);
  expect(report.compatibility).toEqual([
    expect.objectContaining({
      featureId: "runtime-context",
      note: expect.stringContaining("raw Codex environment remains available"),
      status: "transformed",
      target: "codex",
    }),
  ]);
});

test("SET-220: lookup plugin bin compatibility reports Codex unsupported reason", async () => {
  const result = await runSkillsetCli("lookup", "plugin", "bin", "--compat", "codex", "--json");

  expect(result.exitCode).toBe(0);
  const report = readResultData(result.stdout) as {
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
  const result = await runSkillsetCli("lookup", "hooks", "--events", "--cursor", "--json");

  expect(result.exitCode).toBe(0);
  const report = readResultData(result.stdout) as {
    readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
    readonly events: readonly { readonly handlerTypes: readonly string[]; readonly matcherEvaluation: string; readonly matcherKind: string; readonly matcherValues: readonly string[]; readonly name: string; readonly providerRef: string; readonly target: string }[];
    readonly targets: readonly string[];
  };
  expect(report.targets).toEqual(["cursor"]);
  expect(report.diagnostics).toEqual([]);
  expect(report.events).toContainEqual(expect.objectContaining({
    handlerTypes: ["command"],
    matcherEvaluation: "exact-values",
    matcherKind: "session-source",
    matcherValues: ["startup", "resume", "clear", "compact"],
    name: "SessionStart",
    providerRef: "cursor-hooks-docs",
    target: "cursor",
  }));
});

test("SET-220: lookup invalid combinations and targets produce helpful diagnostics", async () => {
  const invalidView = await runSkillsetCli("lookup", "workspace", "--frontmatter", "--json");
  const cursorTarget = await runSkillsetCli("lookup", "hooks", "--compat", "cursor", "--json");
  const invalidTarget = await runSkillsetCli("lookup", "hooks", "--compat", "unknown");

  expect(invalidView.exitCode).toBe(1);
  expect(JSON.parse(invalidView.stdout)).toMatchObject({
    diagnostics: [{ code: "lookup/frontmatter/not-applicable", severity: "error" }],
    kind: "diagnostics",
    ok: false,
  });
  const report = readResultData(invalidView.stdout) as {
    readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly severity: string }[];
  };
  expect(report.diagnostics).toContainEqual({
    code: "lookup/frontmatter/not-applicable",
    message: "Workspace configuration uses fields; use --fields or --field instead of --frontmatter.",
    severity: "error",
  });

  expect(cursorTarget.exitCode).toBe(0);
  expect((readResultData(cursorTarget.stdout) as { readonly targets: readonly string[] }).targets).toEqual(["cursor"]);
  expect(invalidTarget.exitCode).toBe(1);
  expect(invalidTarget.stderr).toContain("unknown lookup compatibility target unknown");
});

test("SET-283: lookup features rejects unrelated lookup filters", async () => {
  const result = await runSkillsetCli("lookup", "features", "--fields", "--json");

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    diagnostics: [{ message: expect.stringContaining("expected lookup features to use only") }],
    exitCode: 2,
    ok: false,
  });
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

function readResultData(stdout: string): unknown {
  return (JSON.parse(stdout) as { readonly data: unknown }).data;
}
