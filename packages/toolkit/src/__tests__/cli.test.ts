import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const repoRoot = process.cwd();
const cliPath = join(repoRoot, "packages/toolkit/src/cli.ts");

describe("@skillset/toolkit CLI", () => {
  test("prints deterministic JSON with normalized and raw namespaces", async () => {
    const result = await runToolkit(["runtime", "context", "--event", "Stop"], {
      CURSOR_SESSION_ID: "cursor-session",
      SKILLSET_PROVIDER: "cursor",
    });

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const report = JSON.parse(result.stdout) as {
      readonly hook: { readonly event: string };
      readonly provider: string;
      readonly raw: { readonly env: Record<string, string> };
      readonly schemaVersion: number;
      readonly session: { readonly id?: string };
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.provider).toBe("cursor");
    expect(report.hook.event).toBe("Stop");
    expect(report.session.id).toBe("cursor-session");
    expect(report.raw.env.CURSOR_SESSION_ID).toBe("cursor-session");
    expect(result.stdout).toBe(`${JSON.stringify(report, null, 2)}\n`);
  });

  test("prints eval-safe env output for empty, spaced, quoted, and missing values", async () => {
    const command = [
      "eval \"$(",
      shellQuote(process.execPath),
      shellQuote(cliPath),
      "runtime context --event 'Stop Event' --format env",
      ")\"",
      "&& printf '<%s>|<%s>|<%s>' \"$SKILLSET_PROVIDER\" \"$SKILLSET_HOOK_EVENT\" \"$SKILLSET_SESSION_ID\"",
    ].join(" ");
    const result = await runShell(command, {
      CLAUDE_PROJECT_DIR: "/tmp/claude repo",
      CLAUDE_SESSION_ID: "quote ' me",
    });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "<claude>|<Stop Event>|<quote ' me>" });

    const missing = await runShell(command, { SKILLSET_PROVIDER: "unknown" });
    expect(missing).toEqual({ exitCode: 0, stderr: "", stdout: "<unknown>|<Stop Event>|<>" });

    const empty = await runShell(command, { SKILLSET_PROVIDER: "codex", SKILLSET_SESSION_ID: "" });
    expect(empty).toEqual({ exitCode: 0, stderr: "", stdout: "<codex>|<Stop Event>|<>" });

    const cursor = await runShell(command, {
      CURSOR_SESSION_ID: "cursor session",
      SKILLSET_PROVIDER: "cursor",
    });
    expect(cursor).toEqual({ exitCode: 0, stderr: "", stdout: "<cursor>|<Stop Event>|<cursor session>" });
  });

  test("supports Python JSON consumption without provider-specific parsing", async () => {
    await expect(commandExists("python3")).resolves.toBe(true);
    const python = [
      "import json, sys",
      "doc = json.load(sys.stdin)",
      "print(doc['provider'] + '|' + doc['raw']['env']['CODEX_SESSION_ID'])",
    ].join("; ");
    const command = [
      shellQuote(process.execPath),
      shellQuote(cliPath),
      "runtime context --event Stop --format json",
      "| python3 -c",
      shellQuote(python),
    ].join(" ");
    const result = await runShell(command, {
      CODEX_SESSION_ID: "session-from-python",
      OPENAI_WORKSPACE_ROOT: "/tmp/workspace",
    });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "codex|session-from-python\n" });
  });

  test("fails loudly for unknown fields", async () => {
    const result = await runToolkit(["runtime", "context", "--event", "Stop", "--fields", "provider,nope"], {});

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("hooks context field must be provider, hook.event, or session.id");
  });
});

async function runToolkit(
  args: readonly string[],
  env: Record<string, string>
): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, cliPath, ...args],
    cwd: repoRoot,
    env: testEnv(env),
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

async function runShell(
  command: string,
  env: Record<string, string>
): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> {
  const proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", command],
    cwd: repoRoot,
    env: testEnv(env),
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

async function commandExists(command: string): Promise<boolean> {
  const result = await runShell(`command -v ${shellQuote(command)} >/dev/null 2>&1`, {});
  return result.exitCode === 0;
}

function testEnv(env: Record<string, string>): Record<string, string> {
  return {
    HOME: process.env.HOME ?? "",
    PATH: process.env.PATH ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    ...env,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
