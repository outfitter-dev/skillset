import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../test-helpers/skillset-config";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createOperationReport } from "@skillset/core/internal/report";
import {
  createReportBundle,
  readReportBundle,
} from "@skillset/core/internal/report-store";

import { checkClonePurity, compareTrees, parseExternalManifest, renderExternalManifest, renderRunReportMarkdown, runExternalRepo, runSelectedExternalFixtures } from '../external';
import type { ExternalRepoEntry, ExternalRunReport } from '../external';
import {
  persistExternalFixtureReport,
  writeExternalRunReport,
} from "../external-report";
import {
  REPORT_EXPORT_REQUESTS_DIR,
  REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
} from "../../../apps/skillset/src/report-export-request";
import {
  TEST_SANDBOX_SCHEMA_VERSION,
  testSandboxGit,
  testSandboxXdg,
} from "../../../apps/skillset/src/verification-sandbox";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../test-helpers/git-remote";

const SHA = "4719dc509fdc45656a830e3ed6060f674e206076";

test("manifest parses, defaults targets to claude, and round-trips through render", () => {
  const entries = parseExternalManifest(
    [
      "repos:",
      "  - name: demo",
      "    repo: https://github.com/example/demo",
      `    ref: ${SHA}`,
      '    notes: "A demo repo."',
      "  - name: all-targets",
      "    repo: https://github.com/example/all",
      `    ref: ${SHA}`,
      "    targets: [claude, codex, cursor]",
      "",
    ].join("\n"),
    "test manifest"
  );

  expect(entries).toEqual([
    {
      name: "demo",
      notes: "A demo repo.",
      ref: SHA,
      repo: "https://github.com/example/demo",
      targets: ["claude"],
    },
    {
      name: "all-targets",
      ref: SHA,
      repo: "https://github.com/example/all",
      targets: ["claude", "codex", "cursor"],
    },
  ]);

  const rendered = renderExternalManifest(entries);
  expect(parseExternalManifest(rendered, "re-rendered manifest")).toEqual(
    entries
  );
});

test("manifest rejects short refs, duplicate names, and unknown targets", () => {
  const entry = (overrides: string): string =>
    [
      "repos:",
      "  - name: demo",
      "    repo: https://github.com/example/demo",
      overrides,
      "",
    ].join("\n");

  expect(() => parseExternalManifest(entry("    ref: abc123"), "m")).toThrow(
    "full 40-character commit SHA"
  );
  expect(() =>
    parseExternalManifest(
      `repos:\n  - name: demo\n    repo: r\n    ref: ${SHA}\n  - name: demo\n    repo: r\n    ref: ${SHA}\n`,
      "m"
    )
  ).toThrow("duplicate entry name");
  expect(() =>
    parseExternalManifest(entry(`    ref: ${SHA}\n    targets: [future]`), "m")
  ).toThrow("targets must be claude, codex, or cursor");
  expect(() => parseExternalManifest("repos: {}\n", "m")).toThrow("repos list");
});

test("compareTrees buckets identical, different, and one-sided files", async () => {
  const original = await fixture({
    ".git/HEAD": "ignored\n",
    "changed.md": "left\n",
    "nested/original-only.md": "orig\n",
    "same.md": "same\n",
  });
  const generated = await fixture({
    "changed.md": "right\n",
    "generated-only.lock": "gen\n",
    "same.md": "same\n",
  });

  const comparison = await compareTrees(original, generated);

  expect(comparison.identical).toEqual(["same.md"]);
  expect(comparison.different).toEqual(["changed.md"]);
  expect(comparison.originalOnly).toEqual(["nested/original-only.md"]);
  expect(comparison.generatedOnly).toEqual(["generated-only.lock"]);
});

test("runExternalRepo adopts a marketplace-shaped repo in place and reports round-trips", async () => {
  const clone = await gitFixture(marketplaceFiles());

  const report = await runExternalRepo("demo-marketplace", clone, ["claude", "cursor"]);

  expect(report.stages.map((stage) => [stage.stage, stage.ok])).toEqual([
    ["init", true],
    ["import", true],
    ["import", true],
    ["lint", true],
    ["build", true],
    ["purity", true],
    ["compare", true],
  ]);
  expect(report.ok).toBe(true);
  // The root AGENTS.md candidate now actually imports: adopt copies the body
  // into .skillset/rules/ and adds source-origin metadata.
  expect(
    report.stages.find(
      (stage) =>
        stage.stage === "import" &&
        stage.detail.includes("instructions:AGENTS.md")
    )?.detail
  ).toContain(".skillset/rules/agents.md");
  const importedAgents = await readFile(join(clone, ".skillset/rules/agents.md"), "utf8");
  expect(importedAgents).toContain("skillset:\n  origin:\n    path: AGENTS.md");
  expect(importedAgents).toContain("# Demo agents\n\nHandwritten instructions.");
  expect(report.survey.candidates).toEqual([
    { kind: "instructions", path: "AGENTS.md" },
    { kind: "plugin", path: "plugins/demo" },
  ]);
  expect(report.survey.diagnostics).toEqual([]);
  expect(report.survey.skips).toEqual([
    expect.objectContaining({
      renderResult: expect.objectContaining({
        featureId: "target-native-islands",
        sourceUnit: "claude.commands:commands",
        status: "intentionally_skipped",
        target: "claude",
      }),
      path: ".claude/commands",
      reason:
        "project-level commands have no portable source home yet; adopt will represent them as provider source in the transform milestone",
      surface: "commands",
    }),
  ]);
  expect(report.roundTrips).toHaveLength(2);
  expect(report.roundTrips.map((entry) => [entry.target, entry.generatedRoot])).toEqual([
    ["claude", ".skillset/cache/latest/plugins/demo/claude"],
    ["cursor", ".skillset/cache/latest/plugins/demo/cursor"],
  ]);
  const roundTrip = report.roundTrips.find((entry) => entry.target === "claude");
  expect(roundTrip?.kind).toBe("plugin");
  expect(roundTrip?.name).toBe("demo");
  expect(roundTrip?.originalRoot).toBe("plugins/demo");
  expect(roundTrip?.generatedRoot).toBe(
    ".skillset/cache/latest/plugins/demo/claude"
  );
  expect(roundTrip?.comparison.identical).toContain("commands/hello.md");
  // Generated skill frontmatter gains metadata.version/generated, so the
  // round-trip reports it as different rather than identical.
  expect(roundTrip?.comparison.different).toContain(
    "skills/demo-skill/SKILL.md"
  );

  // In-place isolated adoption only ever creates .skillset/; the live tree
  // must not grow a projection root.
  const rootEntries = await readdir(clone);
  expect(rootEntries).not.toContain("plugins-claude");
  expect(rootEntries).toContain(".skillset");

  const markdown = renderRunReportMarkdown(report, {
    ref: SHA,
    repo: "https://github.com/example/demo",
  } satisfies Pick<ExternalRepoEntry, "ref" | "repo">);
  expect(markdown).toContain("# External fixture run: demo-marketplace");
  expect(markdown).toContain("- result: pass");
  expect(markdown).toContain("## Conformance Evidence");
  expect(markdown).toContain("opt-in external adoption conformance evidence");
  expect(markdown).toContain("## Survey");
  expect(markdown).toContain("- candidate instructions: `AGENTS.md`");
  expect(markdown).toContain("- candidate plugin: `plugins/demo`");
  expect(markdown).toContain(
    "- skipped commands `.claude/commands`: project-level commands have no portable source home yet"
  );
  expect(markdown).toContain(
    "instructions:AGENTS.md -> .skillset/rules/agents.md"
  );
  expect(markdown).toContain("## Round-trip (target projections, report-only)");
  expect(markdown).toContain("### plugin demo (claude)");
  expect(markdown).toContain("### plugin demo (cursor)");
});

test("SET-344: runExternalRepo reports a Cursor-only target projection", async () => {
  const clone = await gitFixture(marketplaceFiles());

  const report = await runExternalRepo("cursor-marketplace", clone, ["cursor"]);

  expect(report.ok).toBe(true);
  expect(report.roundTrips.map((entry) => [entry.target, entry.generatedRoot])).toEqual([
    ["cursor", ".skillset/cache/latest/plugins/demo/cursor"],
  ]);
});

test("runExternalRepo passes when re-run on the same clone", async () => {
  const clone = await gitFixture(marketplaceFiles());

  const first = await runExternalRepo("demo-marketplace", clone, ["claude"]);
  expect(first.ok).toBe(true);

  // The run-start guarded clean drops the previous run's untracked .skillset/
  // adoption, so import does not trip over its own prior output.
  const second = await runExternalRepo("demo-marketplace", clone, ["claude"]);
  expect(second.ok).toBe(true);
  expect(
    second.stages.map((stage) => [stage.stage, stage.ok])
  ).toEqual([
    ["init", true],
    ["import", true],
    ["import", true],
    ["lint", true],
    ["build", true],
    ["purity", true],
    ["compare", true],
  ]);
});

test("runExternalRepo refuses to clean a clone that tracks .skillset files", async () => {
  const clone = await gitFixture({
    ...marketplaceFiles(),
    "skillset.yaml": "skillset:\n  name: tracked\n",
  });

  await expect(
    runExternalRepo("demo-marketplace", clone, ["claude"])
  ).rejects.toThrow("tracked Skillset source files; refusing to clean");
});

test("runExternalRepo fails the run when no import candidates are detected", async () => {
  const clone = await gitFixture({ "README.md": "# Not adoptable\n" });

  const report = await runExternalRepo("plain-repo", clone, ["claude"]);

  expect(report.ok).toBe(false);
  expect(report.stages[0]).toMatchObject({ ok: false, stage: "init" });
  expect(report.roundTrips).toEqual([]);
  const markdown = renderRunReportMarkdown(report, { ref: SHA, repo: "r" });
  expect(markdown).toContain("- result: fail");
  expect(markdown).toContain("No adoptable surfaces recognized.");
  expect(markdown).toContain("No imported units to compare.");
});

test("SET-378: runExternalRepo preserves reports after a graph-load build failure", async () => {
  const clone = await gitFixture({
    "AGENTS.md": "---\ndialect: 1\n---\n\nImported instructions.\n",
  });

  const report = await runExternalRepo("invalid-instructions", clone, ["claude"]);

  expect(report.ok).toBe(false);
  expect(report.stages).toContainEqual(
    expect.objectContaining({
      detail: expect.stringContaining("dialect must be claude"),
      ok: false,
      stage: "build",
    })
  );
  expect(report.stages).toContainEqual(expect.objectContaining({ ok: true, stage: "purity" }));
  expect(report.roundTrips).toEqual([]);

  const reportDir = join(
    await createTestGitFixtureRoot("skillset-external-report-"),
    "report"
  );
  const entry = { ref: SHA, repo: "https://github.com/example/invalid" };
  const evidence = await writeExternalRunReport(reportDir, report, entry);

  expect(evidence).toMatchObject({
    available: true,
    entries: 2,
    id: ".skillset/cache/fixtures/invalid-instructions",
  });
  expect(evidence.bytes).toBeGreaterThan(0);
  expect(evidence.sha256).toMatch(/^[0-9a-f]{64}$/u);

  const markdown = await readFile(join(reportDir, "report.md"), "utf8");
  expect(markdown).toContain("- result: fail");
  expect(markdown).toContain("- build: failed (command-failure)");
  expect(markdown).not.toContain("dialect must be claude");
  const json = JSON.parse(await readFile(join(reportDir, "report.json"), "utf8")) as {
    readonly phases: { readonly build: { readonly status: string } };
    readonly pipelinePassed: boolean;
  };
  expect(json.pipelinePassed).toBe(false);
  expect(json.phases.build.status).toBe("failed");
});

test("SET-445: external producer persists truthful typed failure phases without detailed content", async () => {
  const checkout = await gitFixture({ "README.md": "# Skillset checkout\n" });
  await testGit(
    checkout,
    "remote",
    "add",
    "origin",
    "https://github.com/outfitter-dev/skillset.git"
  );
  const stateRoot = join(
    await createTestGitFixtureRoot("skillset-external-state-"),
    "state"
  );
  await mkdir(stateRoot);
  const env = {
    ...process.env,
    SKILLSET_TEST_SANDBOX: "",
    XDG_STATE_HOME: stateRoot,
  };
  const report = failedExternalReport("credential-value-must-not-survive");
  const entry = externalEntry();

  const persisted = await persistExternalFixtureReport({
    entry,
    env,
    evidence: [externalEvidence()],
    manifestEntryCount: 7,
    manifestSha256: "a".repeat(64),
    report,
    rootPath: checkout,
  });
  const stored = await readReportBundle(persisted.stored.report.id, { env });

  expect(persisted.requestRegistered).toBe(false);
  expect(stored.report.kind).toBe("external-fixture");
  if (stored.report.kind !== "external-fixture") {
    throw new Error("expected external-fixture report");
  }
  expect(stored.report.result).toMatchObject({ exitCode: 1, ok: false });
  expect(stored.report.payload.fixture).toEqual({
    manifestEntryCount: 7,
    manifestEntrySha256:
      "8bac54214827b8ec0319dbce2108fda6877d73887c1c59598e92830b46f7b000",
    manifestSha256: "a".repeat(64),
    name: "demo",
    pinnedCommit: SHA,
    repository: "github.com/example/demo",
    targets: ["claude"],
  });
  expect(stored.report.payload.phases.build).toEqual({
    exitClass: "command-failure",
    status: "failed",
  });
  expect(stored.report.payload.phases.purity).toEqual({
    exitClass: "success",
    status: "passed",
  });
  expect(stored.report.payload.phases.compare).toEqual({
    exitClass: "not-run",
    status: "not-run",
  });
  expect(stored.report.payload.pipelinePassed).toBe(false);
  expect(stored.report.payload.summaries).toEqual({
    comparisonDifferences: 0,
    importedUnits: 1,
    migrationFlags: 1,
    renderResults: { failed: 1, rendered: 2, skipped: 3, unsupported: 4 },
    surveyCandidates: 1,
  });
  expect(stored.report.workspace.repository).toMatchObject({
    dirty: false,
    identity: "github.com/outfitter-dev/skillset",
  });
  expect(JSON.stringify(stored.report)).not.toContain(
    "credential-value-must-not-survive"
  );
});

test("SET-445: sandboxed external producer requests only its completed UUID", async () => {
  const checkout = await gitFixture({ "README.md": "# Skillset checkout\n" });
  await testGit(
    checkout,
    "remote",
    "add",
    "origin",
    "git@github.com:outfitter-dev/skillset.git"
  );
  const sandbox = await externalSandbox(checkout);
  const unrelated = await createReportBundle(
    createOperationReport({
      command: "check",
      exitCode: 0,
      skillsetVersion: "0.1.1",
      workspace: { id: "workspace--local-12abcdef3456" },
    }),
    { env: sandbox.env }
  );

  const persisted = await persistExternalFixtureReport({
    entry: externalEntry(),
    env: { ...sandbox.env, PRIVATE_TOKEN: "not-retained" },
    evidence: [externalEvidence()],
    manifestEntryCount: 1,
    manifestSha256: "b".repeat(64),
    report: failedExternalReport("not-retained"),
    rootPath: checkout,
  });

  expect(persisted.requestRegistered).toBe(true);
  const requestDirectory = join(
    sandbox.sandboxPath,
    REPORT_EXPORT_REQUESTS_DIR
  );
  expect(await readdir(requestDirectory)).toEqual([
    `${persisted.stored.report.id}.json`,
  ]);
  expect(
    JSON.parse(
      await readFile(
        join(requestDirectory, `${persisted.stored.report.id}.json`),
        "utf8"
      )
    )
  ).toEqual({
    reportId: persisted.stored.report.id,
    schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
  });
  expect(await readdir(requestDirectory)).not.toContain(
    `${unrelated.report.id}.json`
  );
  expect(JSON.stringify(persisted.stored.report)).not.toContain("not-retained");
});

test("SET-445: acquisition failures are receipted once per entry and do not stop the selection", async () => {
  const checkout = await gitFixture({ "README.md": "# Skillset checkout\n" });
  await testGit(
    checkout,
    "remote",
    "add",
    "origin",
    "https://github.com/outfitter-dev/skillset.git"
  );
  const stateRoot = join(
    await createTestGitFixtureRoot("skillset-external-acquire-state-"),
    "state"
  );
  await mkdir(stateRoot);
  const entries = [
    { ...externalEntry(), name: "first" },
    { ...externalEntry(), name: "second" },
  ];
  const attempts: string[] = [];
  let runCount = 0;

  const executions = await runSelectedExternalFixtures({
    entries,
    env: {
      ...process.env,
      SKILLSET_TEST_SANDBOX: "",
      XDG_STATE_HOME: stateRoot,
    },
    manifestEntryCount: entries.length,
    manifestSha256: "e".repeat(64),
    rootPath: checkout,
    testHooks: {
      acquire: async (rootPath, entry) => {
        attempts.push(entry.name);
        await mkdir(
          join(rootPath, "fixtures/external/repos", entry.name),
          { recursive: true }
        );
        throw new Error(`acquisition-detail-${entry.name}`);
      },
      run: async () => {
        runCount += 1;
        return failedExternalReport("must-not-run");
      },
    },
  });

  expect(attempts).toEqual(["first", "second"]);
  expect(runCount).toBe(0);
  expect(executions).toHaveLength(2);
  expect(new Set(executions.map(({ receipt }) => receipt.stored.report.id)).size).toBe(2);
  for (const execution of executions) {
    expect(execution.report.stages).toEqual([
      expect.objectContaining({ ok: false, stage: "acquire" }),
    ]);
    const stored = execution.receipt.stored.report;
    if (stored.kind !== "external-fixture") {
      throw new Error("expected external-fixture report");
    }
    expect(stored.payload.phases.acquire).toEqual({
      exitClass: "command-failure",
      status: "failed",
    });
    for (const phase of ["init", "import", "lint", "build", "purity", "compare"] as const) {
      expect(stored.payload.phases[phase]).toEqual({
        exitClass: "not-run",
        status: "not-run",
      });
    }
    expect(JSON.stringify(stored)).not.toContain("acquisition-detail-");
  }
});

test("SET-445: main-shaped fixture reporting excludes URL, root, diagnostic, env, and content sentinels", async () => {
  const checkout = await namedGitFixture("root-path-sentinel", {
    "README.md": "# Skillset checkout\n",
  });
  await testGit(
    checkout,
    "remote",
    "add",
    "origin",
    "https://github.com/outfitter-dev/skillset.git?workspace-url-sentinel"
  );
  const stateRoot = join(
    await createTestGitFixtureRoot("skillset-external-disclosure-state-"),
    "state"
  );
  await mkdir(stateRoot);
  const entry = {
    ...externalEntry(),
    repo: "https://github.com/example/demo.git?fixture-url-sentinel",
  };
  const report = sensitiveExternalReport();

  const [execution] = await runSelectedExternalFixtures({
    entries: [entry],
    env: {
      ...process.env,
      REPORT_ENV_VALUE: "environment-sentinel",
      SKILLSET_TEST_SANDBOX: "",
      XDG_STATE_HOME: stateRoot,
    },
    manifestEntryCount: 1,
    manifestSha256: "f".repeat(64),
    rootPath: checkout,
    testHooks: {
      acquire: async () => {},
      run: async () => report,
    },
  });
  if (execution === undefined) throw new Error("expected fixture execution");

  const bytes = (
    await Promise.all([
      readFile(join(execution.reportDir, "report.json"), "utf8"),
      readFile(join(execution.reportDir, "report.md"), "utf8"),
      readFile(join(execution.receipt.stored.resolvedPath, "report.json"), "utf8"),
      readFile(join(execution.receipt.stored.resolvedPath, "report.md"), "utf8"),
    ])
  ).join("\n");
  for (const sentinel of [
    "fixture-url-sentinel",
    "workspace-url-sentinel",
    "root-path-sentinel",
    "diagnostic-sentinel",
    "environment-sentinel",
    "fixture-content-sentinel",
  ]) {
    expect(bytes).not.toContain(sentinel);
  }
  expect(execution.receipt.stored.report.workspace.name).toBeUndefined();
  expect(execution.receipt.stored.report.workspace.repository?.identity).toBe(
    "github.com/outfitter-dev/skillset"
  );
});

test("runExternalRepo reports competing provider plugins before import", async () => {
  const clone = await gitFixture({
    "plugins/claude-demo/.claude-plugin/plugin.json": JSON.stringify({ name: "demo" }),
    "plugins/claude-demo/skills/helper/SKILL.md":
      "---\nname: helper\ndescription: Helper.\n---\n\nClaude body.\n",
    "plugins/codex-demo/.codex-plugin/plugin.json": JSON.stringify({ name: "demo" }),
    "plugins/codex-demo/skills/helper/SKILL.md":
      "---\nname: helper\ndescription: Helper.\n---\n\nCodex body.\n",
  });

  const report = await runExternalRepo("competing-plugins", clone, ["claude", "codex"]);

  expect(report.ok).toBe(false);
  expect(report.stages).toEqual([
    expect.objectContaining({
      detail: expect.stringContaining("competing-plugin-sources"),
      ok: false,
      stage: "init",
    }),
  ]);
  expect(report.survey.diagnostics).toEqual([
    expect.objectContaining({
      code: "competing-plugin-sources",
      paths: ["plugins/claude-demo", "plugins/codex-demo"],
      severity: "error",
    }),
  ]);
  const markdown = renderRunReportMarkdown(report, { ref: SHA, repo: "r" });
  expect(markdown).toContain("`competing-plugin-sources`");
  expect(markdown).toContain("one shared plugin source");
});

test("checkClonePurity accepts skillset.yaml and .skillset/ additions and flags anything else", async () => {
  const clone = await gitFixture({ "README.md": "# Repo\n" });

  expect(await checkClonePurity(clone)).toEqual({ dirtyPaths: [], ok: true });

  await Bun.write(join(clone, "skillset.yaml"), "skillset:\n");
  await Bun.write(join(clone, ".skillset/cache/latest/AGENTS.md"), "generated\n");
  expect(await checkClonePurity(clone)).toEqual({ dirtyPaths: [], ok: true });

  await Bun.write(join(clone, "stray.lock"), "dirty\n");
  expect(await checkClonePurity(clone)).toEqual({
    dirtyPaths: ["stray.lock"],
    ok: false,
  });
});

function failedExternalReport(secret: string): ExternalRunReport {
  return {
    name: "demo",
    ok: false,
    roundTrips: [],
    stages: [
      { detail: "pinned fixture acquired", ok: true, stage: "acquire" },
      { detail: "1 candidate", ok: true, stage: "init" },
      { detail: "1 imported unit", ok: true, stage: "import" },
      { detail: "clean", ok: true, stage: "lint" },
      { detail: secret, ok: false, stage: "build" },
      { detail: "clean", ok: true, stage: "purity" },
    ],
    summary: {
      importedUnits: 1,
      migrationFlags: 1,
      renderResults: { failed: 1, rendered: 2, skipped: 3, unsupported: 4 },
    },
    survey: {
      candidates: [{ kind: "instructions", path: "AGENTS.md" }],
      diagnostics: [],
      skips: [],
    },
  };
}

function sensitiveExternalReport(): ExternalRunReport {
  return {
    name: "demo",
    ok: false,
    roundTrips: [
      {
        comparison: {
          different: ["fixture-content-sentinel.md"],
          generatedOnly: [],
          identical: [],
          originalOnly: [],
        },
        generatedRoot: "/root-path-sentinel/generated",
        kind: "plugin",
        name: "demo",
        originalRoot: "/root-path-sentinel/original",
        target: "claude",
      },
    ],
    stages: [
      { detail: "diagnostic-sentinel", ok: true, stage: "init" },
      { detail: "fixture-content-sentinel", ok: true, stage: "import" },
      { detail: "environment-sentinel", ok: true, stage: "lint" },
      { detail: "fixture-url-sentinel", ok: false, stage: "build" },
      { detail: "root-path-sentinel", ok: true, stage: "purity" },
    ],
    summary: {
      importedUnits: 1,
      migrationFlags: 1,
      renderResults: { failed: 1, rendered: 0, skipped: 0, unsupported: 0 },
    },
    survey: {
      candidates: [
        { kind: "instructions", path: "fixture-content-sentinel.md" },
      ],
      diagnostics: [
        {
          code: "fixture-disclosure-test",
          message: "diagnostic-sentinel",
          paths: ["/root-path-sentinel/fixture-content-sentinel.md"],
          recommendation: "environment-sentinel",
          severity: "warning",
        },
      ],
      skips: [],
    },
  };
}

function externalEntry(): ExternalRepoEntry {
  return {
    name: "demo",
    notes: "Pinned fixture.",
    ref: SHA,
    repo: "https://github.com/example/demo.git",
    targets: ["claude"],
  };
}

function externalEvidence() {
  return {
    available: true as const,
    bytes: 123,
    entries: 2,
    id: ".skillset/cache/fixtures/demo",
    sha256: "d".repeat(64),
  };
}

async function externalSandbox(checkout: string) {
  const root = await createTestGitFixtureRoot("skillset-external-sandbox-");
  const sandboxPath = join(root, "skillset-test-owned");
  const git = testSandboxGit(sandboxPath);
  const xdg = testSandboxXdg(sandboxPath);
  await Promise.all([
    ...Object.values(xdg).map((path) => mkdir(path, { recursive: true })),
    mkdir(join(sandboxPath, "git"), { recursive: true }),
  ]);
  await Promise.all(Object.values(git).map((path) => writeFile(path, "")));
  const descriptorPath = join(sandboxPath, "descriptor.json");
  await writeFile(
    descriptorPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      invocationId: crypto.randomUUID(),
      repoRoot: await realpath(checkout),
      sandboxPath: await realpath(sandboxPath),
      schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
    })
  );
  return {
    env: {
      GIT_CONFIG_GLOBAL: git.global,
      GIT_CONFIG_SYSTEM: git.system,
      GIT_TERMINAL_PROMPT: "0",
      HOME: process.env.HOME,
      NODE_ENV: "test",
      SKILLSET_TEST_SANDBOX: descriptorPath,
      XDG_CACHE_HOME: xdg.cache,
      XDG_CONFIG_HOME: xdg.config,
      XDG_DATA_HOME: xdg.data,
      XDG_STATE_HOME: xdg.state,
    },
    sandboxPath,
  };
}

async function testGit(cwd: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}\n${stdout}${stderr}`.trim()
    );
  }
}

function marketplaceFiles(): Record<string, string> {
  return {
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "demo-marketplace",
      plugins: [{ name: "demo", source: "./plugins/demo" }],
    }),
    ".claude/commands/x.md": "---\ndescription: Project command.\n---\n\nDo x.\n",
    "AGENTS.md": "# Demo agents\n\nHandwritten instructions.\n",
    "README.md": "# Demo repo\n",
    "plugins/demo/.claude-plugin/plugin.json": JSON.stringify({
      name: "demo",
      version: "1.0.0",
    }),
    "plugins/demo/commands/hello.md":
      "---\ndescription: Say hello.\n---\n\nSay hello.\n",
    "plugins/demo/skills/demo-skill/SKILL.md":
      "---\nname: demo-skill\ndescription: Demo skill.\n---\n\nBody.\n",
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-external-test-"
  );
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), content);
  }
  return root;
}

/** A fixture that is also a git repo with everything committed, so the
 * harness's git-backed clean and purity stages can run against it. */
async function gitFixture(files: Record<string, string>): Promise<string> {
  const root = await fixture(files);
  await initializeTestGitRepository(root, {
    disposableRoot: dirname(root),
  });
  return root;
}

async function namedGitFixture(
  name: string,
  files: Record<string, string>
): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-external-named-test-"
  );
  const root = join(disposableRoot, name);
  await mkdir(root);
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), content);
  }
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}
