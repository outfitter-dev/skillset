import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validateCliResult,
  validateSkillsetReport,
  type SkillsetCliResult,
  type SkillsetReport,
} from "@skillset/schema";

const CLI = join(import.meta.dir, "..", "cli.ts");
const PRIVATE_SENTINELS = {
  body: "private_sentinel_body_receipt_leak",
  errorPath: "private_sentinel_error_path_receipt_leak",
  key: "private_sentinel_key_receipt_leak",
  sourcePath: "private_sentinel_source_path_receipt_leak",
  value: "private_sentinel_value_receipt_leak",
} as const;

test("SET-445: direct import stores one globally addressable receipt", async () => {
  const fixture = await receiptFixture();
  const source = join(fixture.root, PRIVATE_SENTINELS.sourcePath, "one");
  await writeFiles({
    [join(source, "SKILL.md")]:
      `---\nname: one\ndescription: One.\n${PRIVATE_SENTINELS.key}: ${PRIVATE_SENTINELS.value}\n---\n\n${PRIVATE_SENTINELS.body}\n`,
  });

  const imported = await runCli(
    fixture,
    "import",
    source,
    "--kind",
    "skill",
    "--root",
    fixture.workspace,
    "--json"
  );
  expect(imported).toMatchObject({ exitCode: 0, stderr: "" });
  const result = cliResult(imported.stdout);
  const receipt = receiptFrom(result);
  expect(result.data.writes).toEqual([".skillset/skills/one"]);
  expect(result.data.writes).not.toContain(receipt.path);
  expect(await addedReportIds(fixture)).toEqual([receipt.id]);

  const shown = await runCli(fixture, "report", "show", receipt.id, "--json");
  expect(shown.exitCode, shown.stderr).toBe(0);
  const showResult = cliResult(shown.stdout);
  const report = showResult.data.report as unknown as SkillsetReport;
  expect(validateSkillsetReport(report)).toEqual({ diagnostics: [], ok: true });
  expect(report).toMatchObject({
    id: receipt.id,
    kind: "import",
    result: { command: "import", exitCode: 0, ok: true },
  });
  expect(JSON.stringify(report)).not.toContain(fixture.workspace);
  expectNoSentinels(report);
  expect(receipt.showCommand).toBe(`skillset report show ${receipt.id}`);
  expect(receipt.path).toContain(join("skillset", "reports", receipt.id));
});

test("SET-445: partial import failure retains bounded completion truth", async () => {
  const fixture = await receiptFixture(PRIVATE_SENTINELS.errorPath);
  const source = join(fixture.root, "source/skills");
  await writeFiles({
    [join(source, "a/SKILL.md")]:
      `---\nname: a\ndescription: A.\n${PRIVATE_SENTINELS.key}: ${PRIVATE_SENTINELS.value}\n---\n\n${PRIVATE_SENTINELS.body}\n`,
    [join(source, "b/SKILL.md")]: "---\nname: b\ndescription: B.\n---\n\nB.\n",
    [join(fixture.workspace, ".skillset/skills/b/SKILL.md")]:
      "---\nname: b\ndescription: Existing.\n---\n\nExisting.\n",
  });

  const imported = await runCli(
    fixture,
    "import",
    source,
    "--root",
    fixture.workspace,
    "--json"
  );
  expect(imported.exitCode).toBe(1);
  const result = cliResult(imported.stdout);
  const receipt = receiptFrom(result);
  const shown = cliResult(
    (await runCli(fixture, "report", "show", receipt.id, "--json")).stdout
  );
  expect(shown.data.report).toMatchObject({
    kind: "import",
    payload: {
      diagnosticCodes: ["import.partial"],
      importedUnitIds: ["skill:a"],
      partial: true,
    },
    result: { command: "import", exitCode: 1, ok: false },
  });
  expectNoSentinels(shown.data.report);
  expect(result.data.writes).toEqual([".skillset/skills/a"]);
  expect(await addedReportIds(fixture)).toEqual([receipt.id]);
});

test("SET-445: import caps a successful receipt after 201 mutated units", async () => {
  const fixture = await receiptFixture();
  const source = join(fixture.root, "bulk-success");
  await writeSkillCollection(source, 201);

  const imported = await runCli(
    fixture,
    "import",
    source,
    "--root",
    fixture.workspace,
    "--json"
  );
  expect(imported.exitCode, imported.stderr).toBe(0);
  const result = cliResult(imported.stdout);
  const receipt = receiptFrom(result);
  expect(result.data.writes).toHaveLength(201);
  const shown = cliResult(
    (await runCli(fixture, "report", "show", receipt.id, "--json")).stdout
  );
  expect(shown.data.report).toMatchObject({
    payload: {
      listCounts: { destinations: 201, importedUnitIds: 201 },
    },
    result: { command: "import", exitCode: 0, ok: true },
  });
  const payload = (shown.data.report as unknown as {
    payload: {
      destinations: readonly string[];
      importedUnitIds: readonly string[];
    };
  }).payload;
  expect(payload.destinations).toHaveLength(200);
  expect(payload.importedUnitIds).toHaveLength(200);
});

test("SET-445: import caps a partial receipt after 201 mutated units", async () => {
  const fixture = await receiptFixture();
  const source = join(fixture.root, "bulk-partial");
  await writeSkillCollection(source, 202);
  await writeFiles({
    [join(fixture.workspace, ".skillset/skills/unit-0201/SKILL.md")]:
      "---\nname: unit-0201\ndescription: Existing.\n---\n\nExisting.\n",
  });

  const imported = await runCli(
    fixture,
    "import",
    source,
    "--root",
    fixture.workspace,
    "--json"
  );
  expect(imported.exitCode).toBe(1);
  const result = cliResult(imported.stdout);
  const receipt = receiptFrom(result);
  expect(result.data.writes).toHaveLength(201);
  const shown = cliResult(
    (await runCli(fixture, "report", "show", receipt.id, "--json")).stdout
  );
  expect(shown.data.report).toMatchObject({
    payload: {
      diagnosticCodes: ["import.partial"],
      listCounts: { destinations: 201, importedUnitIds: 201 },
      partial: true,
    },
    result: { command: "import", exitCode: 1, ok: false },
  });
  const payload = (shown.data.report as unknown as {
    payload: {
      destinations: readonly string[];
      importedUnitIds: readonly string[];
    };
  }).payload;
  expect(payload.destinations).toHaveLength(200);
  expect(payload.importedUnitIds).toHaveLength(200);
});

test("SET-445: adoption writes a receipt while plans and usage failures do not", async () => {
  const fixture = await receiptFixture();
  await writeFiles({
    [join(fixture.workspace, ".agents/skills/demo/SKILL.md")]:
      "---\nname: demo\ndescription: Demo.\n---\n\nDemo.\n",
  });

  const planned = await runCli(
    fixture,
    "init",
    "--root",
    fixture.workspace,
    "--adopt",
    "all",
    "--json"
  );
  expect(planned.exitCode, planned.stderr).toBe(0);
  expect(cliResult(planned.stdout).data).not.toHaveProperty("receipt");
  expect(await addedReportIds(fixture)).toEqual([]);

  const usageFailure = await runCli(fixture, "import", "skill");
  expect(usageFailure.exitCode).toBe(1);
  expect(await addedReportIds(fixture)).toEqual([]);

  const adopted = await runCli(
    fixture,
    "init",
    "--root",
    fixture.workspace,
    "--adopt",
    "all",
    "--yes",
    "--json"
  );
  expect(adopted).toMatchObject({ exitCode: 0, stderr: "" });
  const result = cliResult(adopted.stdout);
  const receipt = receiptFrom(result);
  expect(result.data.writes).not.toContain(receipt.path);
  expect(await addedReportIds(fixture)).toEqual([receipt.id]);
  const shown = cliResult(
    (await runCli(fixture, "report", "show", receipt.id, "--json")).stdout
  );
  expect(shown.data.report).toMatchObject({
    kind: "adoption",
    result: { command: "init.adopt", exitCode: 0, ok: true },
  });
});

test("SET-445: blocked guided adoption stores one failure receipt", async () => {
  const fixture = await receiptFixture();
  await writeFiles({
    [join(fixture.workspace, ".claude-plugin/plugin.json")]: JSON.stringify({
      name: "claude-name",
      version: "1.0.0",
    }),
    [join(fixture.workspace, ".codex-plugin/plugin.json")]: JSON.stringify({
      name: "codex-name",
      version: "1.0.0",
    }),
  });

  const adopted = await runCli(
    fixture,
    "init",
    "--root",
    fixture.workspace,
    "--adopt",
    "all",
    "--yes",
    "--json"
  );
  expect(adopted.exitCode).toBe(1);
  const result = cliResult(adopted.stdout);
  const receipt = receiptFrom(result);
  expect(result.data).toMatchObject({ state: "blocked", writes: [] });
  expect(await addedReportIds(fixture)).toEqual([receipt.id]);
  const shown = cliResult(
    (await runCli(fixture, "report", "show", receipt.id, "--json")).stdout
  );
  expect(shown.data.report).toMatchObject({
    kind: "adoption",
    payload: {
      phases: {
        build: { count: 0, status: "not-run" },
        import: { count: 0, status: "not-run" },
        lint: { count: 0, status: "not-run" },
        setup: { status: "failed" },
      },
    },
    result: { command: "init.adopt", exitCode: 1, ok: false },
  });
});

interface ReceiptFixture {
  readonly initialReportIds: readonly string[];
  readonly root: string;
  readonly state: string;
  readonly workspace: string;
}

async function receiptFixture(workspaceName = "workspace"): Promise<ReceiptFixture> {
  const root = await mkdtemp(join(tmpdir(), "skillset-operation-receipt-"));
  const workspace = join(root, workspaceName);
  await mkdir(workspace, { recursive: true });
  const stateBase = process.env.XDG_STATE_HOME;
  if (stateBase === undefined)
    throw new Error("test sandbox must provide XDG_STATE_HOME");
  const state = join(stateBase, "skillset/reports");
  return {
    initialReportIds: await readReportIds(state),
    root,
    state,
    workspace,
  };
}

async function runCli(
  fixture: ReceiptFixture,
  ...args: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: fixture.workspace,
    env: process.env,
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

function cliResult(stdout: string): SkillsetCliResult {
  const parsed = JSON.parse(stdout) as SkillsetCliResult;
  expect(validateCliResult(parsed)).toEqual({ diagnostics: [], ok: true });
  return parsed;
}

function receiptFrom(result: SkillsetCliResult): {
  readonly id: string;
  readonly path: string;
  readonly showCommand: string;
} {
  return result.data.receipt as unknown as {
    readonly id: string;
    readonly path: string;
    readonly showCommand: string;
  };
}

async function reportIds(fixture: ReceiptFixture): Promise<readonly string[]> {
  return readReportIds(fixture.state);
}

async function addedReportIds(
  fixture: ReceiptFixture
): Promise<readonly string[]> {
  const initial = new Set(fixture.initialReportIds);
  return (await reportIds(fixture)).filter((id) => !initial.has(id));
}

async function readReportIds(state: string): Promise<readonly string[]> {
  try {
    return (await readdir(state)).sort();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return [];
    throw error;
  }
}

async function writeFiles(
  files: Readonly<Record<string, string>>
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(path, ".."), { recursive: true });
    await Bun.write(path, content);
  }
}

async function writeSkillCollection(
  root: string,
  count: number
): Promise<void> {
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    const name = `unit-${index.toString().padStart(4, "0")}`;
    files[join(root, name, "SKILL.md")] =
      `---\nname: ${name}\ndescription: Unit ${index}.\n---\n\nUnit.\n`;
  }
  await writeFiles(files);
}

function expectNoSentinels(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of Object.values(PRIVATE_SENTINELS)) {
    expect(serialized).not.toContain(sentinel);
  }
}
