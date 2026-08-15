import { describe, expect, it } from "bun:test";

import {
  createAdoptionReport,
  createExternalFixtureReport,
  createImportReport,
  renderSkillsetReportMarkdown,
  serializeSkillsetReport,
} from "../report";

const testHooks = {
  createdAt: "2026-08-15T12:00:00.000Z",
  id: "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5",
} as const;
const workspace = {
  id: "skillset--local-12abcdef3456",
  repository: {
    commit: "64618a42a23300b5cbbd308ed3fec0e64bae1a4e",
    dirty: false,
    identity: "github.com/outfitter-dev/skillset",
  },
} as const;
const renderResults = {
  failed: 0,
  rendered: 1,
  skipped: 0,
  unsupported: 0,
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

describe("typed operational reports", () => {
  it("constructs an allowlisted adoption receipt with a fixed command", () => {
    const payload = {
      alreadyAdopted: false,
      candidateIds: ["plugin:.", "skills:.agents/skills"],
      destinations: [".agents/skills/review"],
      diagnosticCodes: ["adopt.review-required"],
      importedUnitIds: ["skill:review"],
      listCounts: { candidateIds: 2, destinations: 1, importedUnitIds: 1 },
      migrationFlagCodes: ["metadata.preserved"],
      phases: {
        build: { count: 1, status: "passed" },
        import: { count: 1, status: "passed" },
        lint: { count: 1, status: "passed" },
        setup: { count: 1, status: "passed" },
      },
      renderResults,
    } as const;
    const report = createAdoptionReport(
      {
        exitCode: 0,
        payload,
        skillsetVersion: "0.23.0",
        workspace,
      },
      { testHooks }
    );

    expect(report.kind).toBe("adoption");
    expect(report.result.command).toBe("init.adopt");
    expect(report.payload).toEqual(payload);
    expect(report.payload).not.toBe(payload);
    expect(renderSkillsetReportMarkdown(report)).toContain("## Adoption");
  });

  it("constructs a closed import receipt with bounded field classifications", () => {
    const report = createImportReport(
      {
        exitCode: 1,
        payload: {
          destinations: [".skillset/skills/review"],
          diagnosticCodes: ["import.partial"],
          fields: {
            inferred: 1,
            preserved: 1,
            unsupported: 1,
          },
          fileCount: 2,
          importedUnitIds: ["skill:review"],
          listCounts: { destinations: 1, importedUnitIds: 1 },
          partial: true,
          requestedKind: "skill",
          requestedProvider: "claude",
          renderResults: { ...renderResults, failed: 1 },
          warningCodes: ["frontmatter.preserved"],
        },
        skillsetVersion: "0.23.0",
        workspace,
      },
      { testHooks }
    );

    expect(report.result).toEqual({
      command: "import",
      exitCode: 1,
      ok: false,
    });
    expect(renderSkillsetReportMarkdown(report)).toContain("## Import");
    expect(serializeSkillsetReport(report)).not.toContain("warning prose");
  });

  it("records mechanical fixture evidence without a semantic conclusion", () => {
    const report = createExternalFixtureReport(
      {
        exitCode: 0,
        payload: {
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
            manifestSha256: "a".repeat(64),
            name: "browserbase",
            pinnedCommit: "c".repeat(40),
            repository: "github.com/browserbase/skills",
            targets: ["claude", "codex"],
          },
          pipelinePassed: true,
          phases: passedExternalPhases,
          runtime: { bunVersion: "1.3.14" },
          summaries: {
            comparisonDifferences: 2,
            importedUnits: 1,
            migrationFlags: 1,
            renderResults,
            surveyCandidates: 1,
          },
        },
        skillsetVersion: "0.23.0",
        workspace,
      },
      { testHooks }
    );

    expect(report.result.command).toBe("conformance.external");
    expect(report.payload).not.toHaveProperty("semanticConclusion");
    expect(report.payload.runtime).toEqual({ bunVersion: "1.3.14" });
    expect(renderSkillsetReportMarkdown(report)).toContain(
      "Pipeline passed: yes"
    );
  });

  it("rejects sentinel-bearing identifiers instead of retaining raw content", () => {
    expect(() =>
      createAdoptionReport(
        {
          exitCode: 1,
          payload: {
            alreadyAdopted: false,
            candidateIds: ["skills/private-token"],
            destinations: [],
            diagnosticCodes: [],
            importedUnitIds: [],
            listCounts: { candidateIds: 1, destinations: 0, importedUnitIds: 0 },
            migrationFlagCodes: [],
            phases: {
              build: { count: 0, status: "not-run" },
              import: { count: 1, status: "failed" },
              lint: { count: 0, status: "not-run" },
              setup: { count: 1, status: "passed" },
            },
            renderResults: { ...renderResults, rendered: 0 },
          },
          sentinels: ["private-token"],
          skillsetVersion: "0.23.0",
          workspace,
        },
        { testHooks }
      )
    ).toThrow("relative identity is invalid");
  });

  it("enforces typed exit codes and fixture pipeline state independently of the command result", () => {
    const payload = {
      evidence: [],
      fixture: {
        manifestEntryCount: 1,
        manifestSha256: "a".repeat(64),
        name: "fixture",
        pinnedCommit: "b".repeat(40),
        repository: "github.com/example/fixture",
        targets: ["codex"],
      },
      phases: {
        ...passedExternalPhases,
        compare: { exitClass: "command-failure", status: "failed" },
      },
      pipelinePassed: false,
      runtime: { bunVersion: "1.3.14" },
      summaries: {
        comparisonDifferences: 0,
        importedUnits: 0,
        migrationFlags: 0,
        renderResults,
        surveyCandidates: 0,
      },
    } as const;

    const report = createExternalFixtureReport(
      {
        exitCode: 0,
        payload,
        skillsetVersion: "0.23.0",
        workspace,
      },
      { testHooks }
    );
    expect(report.result.ok).toBe(true);
    expect(report.payload.pipelinePassed).toBe(false);

    expect(() =>
      createExternalFixtureReport(
        {
          exitCode: 0,
          payload: { ...payload, pipelinePassed: true },
          skillsetVersion: "0.23.0",
          workspace,
        },
        { testHooks }
      )
    ).toThrow(
      "pipelinePassed must be true exactly when every required phase passed"
    );
    expect(() =>
      createExternalFixtureReport(
        {
          exitCode: 0,
          payload: {
            ...payload,
            phases: passedExternalPhases,
            pipelinePassed: false,
          },
          skillsetVersion: "0.23.0",
          workspace,
        },
        { testHooks }
      )
    ).toThrow(
      "pipelinePassed must be true exactly when every required phase passed"
    );

    const invalidExitCode = 99 as never;
    expect(() =>
      createAdoptionReport(
        {
          exitCode: invalidExitCode,
          payload: {
            alreadyAdopted: true,
            candidateIds: [],
            destinations: [],
            diagnosticCodes: [],
            importedUnitIds: [],
            listCounts: { candidateIds: 0, destinations: 0, importedUnitIds: 0 },
            migrationFlagCodes: [],
            phases: {
              build: { count: 0, status: "skipped" },
              import: { count: 0, status: "skipped" },
              lint: { count: 0, status: "skipped" },
              setup: { count: 0, status: "skipped" },
            },
            renderResults,
          },
          skillsetVersion: "0.23.0",
          workspace,
        },
        { testHooks }
      )
    ).toThrow("typed report exitCode must be 0, 1, 2, 3, or 4");
  });
});
