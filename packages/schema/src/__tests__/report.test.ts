import { describe, expect, it } from "bun:test";

import {
  REPORT_SCHEMA_VERSION,
  WORKSPACE_ID_MAX_LENGTH,
  isWorkspaceId,
  isSkillsetReport,
  reportContract,
  validateSkillsetReport,
} from "../index";

const report = {
  createdAt: "2026-08-14T21:30:00.000Z",
  id: "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5",
  kind: "operation",
  payload: {},
  result: { command: "check", exitCode: 0, ok: true },
  schemaVersion: REPORT_SCHEMA_VERSION,
  skillset: { version: "0.1.1" },
  workspace: {
    id: "skillset--local-12abcdef3456",
    name: "skillset",
    repository: {
      commit: "64618a42a23300b5cbbd308ed3fec0e64bae1a4e",
      dirty: false,
      identity: "github.com/outfitter-dev/skillset",
    },
  },
} as const;

const zeroRenderResults = {
  failed: 0,
  rendered: 0,
  skipped: 0,
  unsupported: 0,
} as const;

const adoptionPayload = {
  alreadyAdopted: false,
  candidateIds: ["plugin:.", "skills:.agents/skills"],
  destinations: [".agents/skills/review"],
  diagnosticCodes: ["adopt.review-required"],
  importedUnitIds: ["skill:review"],
  listCounts: {
    candidateIds: 2,
    destinations: 1,
    importedUnitIds: 1,
  },
  migrationFlagCodes: ["metadata.preserved"],
  phases: {
    build: { count: 1, status: "passed" },
    import: { count: 1, status: "passed" },
    lint: { count: 1, status: "passed" },
    setup: { count: 1, status: "passed" },
  },
  renderResults: { ...zeroRenderResults, rendered: 1 },
} as const;

const importPayload = {
  destinations: [".skillset/skills/review"],
  diagnosticCodes: [],
  fields: {
    inferred: 1,
    preserved: 1,
    unsupported: 1,
  },
  fileCount: 2,
  importedUnitIds: ["skill:review"],
  listCounts: { destinations: 1, importedUnitIds: 1 },
  partial: false,
  requestedKind: "skill",
  requestedProvider: "claude",
  renderResults: { ...zeroRenderResults, rendered: 1 },
  warningCodes: [],
} as const;

const passedExternalPhases = {
  acquire: { exitClass: "success", status: "passed" },
  init: { exitClass: "success", status: "passed" },
  import: { exitClass: "success", status: "passed" },
  lint: { exitClass: "success", status: "passed" },
  build: { exitClass: "success", status: "passed" },
  purity: { exitClass: "success", status: "passed" },
  compare: { exitClass: "success", status: "passed" },
} as const;

const externalFixturePayload = {
  evidence: [
    {
      available: true,
      bytes: 1024,
      entries: 2,
      id: "fixture/browserbase/comparison",
      sha256: "b".repeat(64),
    },
  ],
  fixture: {
    manifestEntryCount: 7,
    manifestEntrySha256: "d".repeat(64),
    manifestSha256: "a".repeat(64),
    name: "browserbase",
    pinnedCommit: "c".repeat(40),
    repository: "github.com/browserbase/skills",
    targets: ["claude", "codex"],
  },
  phases: passedExternalPhases,
  pipelinePassed: true,
  runtime: { bunVersion: "1.3.14" },
  summaries: {
    comparisonDifferences: 2,
    importedUnits: 1,
    migrationFlags: 1,
    renderResults: { ...zeroRenderResults, rendered: 2 },
    surveyCandidates: 1,
  },
} as const;

describe("skillset.report@1", () => {
  it("defines and validates the closed operation receipt", () => {
    expect(reportContract.id).toBe("report");
    expect(reportContract.schema.$id).toBe(
      "https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/report.schema.json"
    );
    expect(validateSkillsetReport(report)).toEqual({
      diagnostics: [],
      ok: true,
    });
    expect(isSkillsetReport(report)).toBe(true);
  });

  it("validates each closed typed producer payload", () => {
    for (const candidate of [
      {
        ...report,
        kind: "adoption",
        payload: adoptionPayload,
        result: { command: "init.adopt", exitCode: 0, ok: true },
      },
      {
        ...report,
        kind: "import",
        payload: importPayload,
        result: { command: "import", exitCode: 0, ok: true },
      },
      {
        ...report,
        kind: "external-fixture",
        payload: externalFixturePayload,
        result: { command: "conformance.external", exitCode: 0, ok: true },
      },
    ]) {
      expect(validateSkillsetReport(candidate)).toEqual({
        diagnostics: [],
        ok: true,
      });
      expect(isSkillsetReport(candidate)).toBe(true);
    }
  });

  it("enforces exact list totals below the retention cap", () => {
    const retained = Array.from(
      { length: 200 },
      (_, index) => `skill:unit-${index.toString().padStart(3, "0")}`
    );
    const validates = (candidateIds: readonly string[], total: number) =>
      validateSkillsetReport({
        ...report,
        kind: "adoption",
        payload: {
          ...adoptionPayload,
          candidateIds,
          listCounts: {
            ...adoptionPayload.listCounts,
            candidateIds: total,
          },
        },
        result: { command: "init.adopt", exitCode: 0, ok: true },
      }).ok;

    expect(validates([], 200)).toBe(false);
    expect(validates(retained.slice(0, 2), 3)).toBe(false);
    expect(validates(retained.slice(0, 2), 2)).toBe(true);
    expect(validates(retained, 200)).toBe(true);
    expect(validates(retained, 201)).toBe(true);
    expect(validates(retained.slice(0, 2), 1)).toBe(false);
  });

  it("keeps kind payloads discriminated and bounded", () => {
    expect(
      validateSkillsetReport({
        ...report,
        kind: "adoption",
        payload: importPayload,
      }).ok
    ).toBe(false);
    for (const candidateId of [
      "/private",
      "C:/private",
      "C:private/path",
      "file:/Users/private",
      "file:Users/private/path",
      "http:github.com/example/private",
      "https:github.com/example/private",
      "instructions:../AGENTS.md",
      "instructions:file:AGENTS.md",
      "plugins:./private",
      "plugins:/private",
      "root:/private",
      "ssh:host/private",
      "https://example.com/private",
      "./private",
      "../private",
      "skills/.git/config",
      "skills\\private",
      "skills\nprivate",
    ]) {
      expect(
        validateSkillsetReport({
          ...report,
          kind: "adoption",
          payload: {
            ...adoptionPayload,
            candidateIds: [candidateId],
            listCounts: { ...adoptionPayload.listCounts, candidateIds: 1 },
          },
          result: { command: "init.adopt", exitCode: 0, ok: true },
        }).ok
      ).toBe(false);
    }
    for (const candidateId of [
      "plugin:.",
      "plugin:plugins/review",
      "instructions:AGENTS.md",
      "plugins:.claude/plugins",
      "skills:.agents/skills",
      "skill:review",
      ".agents/skills/review",
    ]) {
      expect(
        validateSkillsetReport({
          ...report,
          kind: "adoption",
          payload: {
            ...adoptionPayload,
            candidateIds: [candidateId],
            listCounts: { ...adoptionPayload.listCounts, candidateIds: 1 },
          },
          result: { command: "init.adopt", exitCode: 0, ok: true },
        }).ok
      ).toBe(true);
    }
    expect(
      validateSkillsetReport({
        ...report,
        kind: "adoption",
        payload: adoptionPayload,
        result: { command: "import", exitCode: 0, ok: true },
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        kind: "adoption",
        payload: { ...adoptionPayload, candidateIds: ["../../private"] },
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        kind: "external-fixture",
        payload: {
          ...externalFixturePayload,
          semanticConclusion: "passed",
        },
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        kind: "external-fixture",
        payload: {
          ...externalFixturePayload,
          fixture: {
            ...externalFixturePayload.fixture,
            manifestEntrySha256: "not-a-sha",
          },
        },
        result: { command: "conformance.external", exitCode: 0, ok: true },
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        kind: "external-fixture",
        payload: externalFixturePayload,
        result: { command: "conformance.external", exitCode: 0, ok: true },
        workspace: { id: report.workspace.id },
      }).ok
    ).toBe(false);
    const { compare: _compare, ...incompletePhases } = passedExternalPhases;
    expect(_compare.status).toBe("passed");
    expect(
      validateSkillsetReport({
        ...report,
        kind: "external-fixture",
        payload: { ...externalFixturePayload, phases: incompletePhases },
        result: { command: "conformance.external", exitCode: 0, ok: true },
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        kind: "external-fixture",
        payload: {
          ...externalFixturePayload,
          phases: {
            ...passedExternalPhases,
            compare: { exitClass: "not-run", status: "not-run" },
          },
        },
        result: { command: "conformance.external", exitCode: 0, ok: true },
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        kind: "external-fixture",
        payload: { ...externalFixturePayload, pipelinePassed: false },
        result: { command: "conformance.external", exitCode: 0, ok: true },
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        kind: "external-fixture",
        payload: {
          ...externalFixturePayload,
          phases: {
            ...passedExternalPhases,
            compare: { exitClass: "command-failure", status: "failed" },
          },
          pipelinePassed: false,
        },
        result: { command: "conformance.external", exitCode: 0, ok: true },
      }).ok
    ).toBe(true);
    for (const [kind, payload, command] of [
      ["adoption", adoptionPayload, "init.adopt"],
      ["import", importPayload, "import"],
      ["external-fixture", externalFixturePayload, "conformance.external"],
    ] as const) {
      expect(
        validateSkillsetReport({
          ...report,
          kind,
          payload,
          result: { command, exitCode: 99, ok: false },
        }).ok
      ).toBe(false);
    }
  });

  it("pins the exact import request vocabulary", () => {
    for (const requestedProvider of [
      "agents",
      "claude",
      "codex",
      "cursor",
      "skillset",
    ]) {
      expect(
        validateSkillsetReport({
          ...report,
          kind: "import",
          payload: { ...importPayload, requestedProvider },
          result: { command: "import", exitCode: 0, ok: true },
        }).ok
      ).toBe(true);
    }
    const { requestedProvider, ...withoutProvider } = importPayload;
    expect(requestedProvider).toBe("claude");
    expect(
      validateSkillsetReport({
        ...report,
        kind: "import",
        payload: withoutProvider,
        result: { command: "import", exitCode: 0, ok: true },
      }).ok
    ).toBe(true);
    for (const requestedKind of [
      "auto",
      "plugin",
      "plugins",
      "skill",
      "skills",
    ]) {
      expect(
        validateSkillsetReport({
          ...report,
          kind: "import",
          payload: { ...importPayload, requestedKind },
          result: { command: "import", exitCode: 0, ok: true },
        }).ok
      ).toBe(true);
    }
    expect(
      validateSkillsetReport({
        ...report,
        kind: "import",
        payload: { ...importPayload, requestedProvider: "github" },
        result: { command: "import", exitCode: 0, ok: true },
      }).ok
    ).toBe(false);
  });

  it("rejects unknown envelope and payload fields", () => {
    const envelope = validateSkillsetReport({ ...report, surprise: true });
    const payload = validateSkillsetReport({
      ...report,
      payload: { arbitrary: true },
    });
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics.map((item) => item.code)).toContain(
      "schema/report/key"
    );
    expect(payload.ok).toBe(false);
    expect(payload.diagnostics.map((item) => item.code)).toContain(
      "schema/report/payload-key"
    );
  });

  it("rejects noncanonical identities, timestamps, and result states", () => {
    expect(
      validateSkillsetReport({ ...report, id: report.id.toUpperCase() }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        createdAt: "2026-02-30T00:00:00.000Z",
      }).ok
    ).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        result: { command: "check", exitCode: 1, ok: true },
      }).ok
    ).toBe(false);
  });

  it("rejects local paths and credential-bearing repository identities", () => {
    for (const identity of [
      "/Users/mg/project",
      "../private/repo",
      "home/alice/private-repo",
      "github.com/../private-repo",
      "github.com/org/./repo",
      "github..com/org/repo",
      "https://user@example.com/org/repo?token=x",
      "C:\\Users\\mg\\project",
    ]) {
      expect(
        validateSkillsetReport({
          ...report,
          workspace: { ...report.workspace, repository: { identity } },
        }).ok
      ).toBe(false);
    }
    expect(
      validateSkillsetReport({
        ...report,
        workspace: {
          ...report.workspace,
          repository: { identity: "git.example/acme/repo.with-dots" },
        },
      }).ok
    ).toBe(true);
  });

  it("rejects path-shaped workspace display names", () => {
    for (const name of [
      "/home/alice/private-repo",
      "C:\\Users\\alice\\private-repo",
      "\\\\server\\private-repo",
      "~/private-repo",
      "private/repo",
      "..",
    ]) {
      expect(
        validateSkillsetReport({
          ...report,
          workspace: { ...report.workspace, name },
        }).diagnostics
      ).toContainEqual({
        code: "schema/report/workspace-name",
        message:
          "workspace name must be a human-readable display name without path syntax, control characters, or Unicode line separators",
        path: "$.workspace.name",
      });
    }
    expect(
      validateSkillsetReport({
        ...report,
        workspace: { ...report.workspace, name: "Outfitter Skillset" },
      }).ok
    ).toBe(true);
  });

  it("rejects C0, C1, and Unicode line controls in workspace display names", () => {
    for (const name of [
      "skill\u0000set",
      "skill\u001fset",
      "skill\u007fset",
      "skill\u0085set",
      "skill\u009fset",
      "skill\u2028set",
      "skill\u2029set",
    ]) {
      expect(
        validateSkillsetReport({
          ...report,
          workspace: { ...report.workspace, name },
        }).diagnostics
      ).toContainEqual({
        code: "schema/report/workspace-name",
        message:
          "workspace name must be a human-readable display name without path syntax, control characters, or Unicode line separators",
        path: "$.workspace.name",
      });
    }
    expect(
      validateSkillsetReport({
        ...report,
        workspace: {
          ...report.workspace,
          name: "Skillset – Café 🚀 研发",
        },
      }).ok
    ).toBe(true);
  });

  it("counts workspace display-name limits in Unicode code points", () => {
    expect(
      validateSkillsetReport({
        ...report,
        workspace: { ...report.workspace, name: "🚀".repeat(160) },
      }).ok
    ).toBe(true);
    expect(
      validateSkillsetReport({
        ...report,
        workspace: { ...report.workspace, name: "🚀".repeat(161) },
      }).ok
    ).toBe(false);
  });

  it("declares semantic date-time validation in the generated contract", () => {
    expect(reportContract.schema).toMatchObject({
      properties: {
        createdAt: {
          format: "date-time",
        },
      },
    });
  });

  it("shares one workspace identity length boundary", () => {
    const maximum = "a".repeat(WORKSPACE_ID_MAX_LENGTH);
    const overlong = `${maximum}a`;
    expect(isWorkspaceId(maximum)).toBe(true);
    expect(isWorkspaceId(overlong)).toBe(false);
    expect(
      validateSkillsetReport({
        ...report,
        workspace: { id: maximum },
      }).ok
    ).toBe(true);
    expect(
      validateSkillsetReport({
        ...report,
        workspace: { id: overlong },
      }).ok
    ).toBe(false);
  });
});
