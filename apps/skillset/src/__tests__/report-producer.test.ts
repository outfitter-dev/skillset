import { describe, expect, it } from "bun:test";

import { adoptCandidateId } from "../adopt";
import { cliVersion } from "../cli-version";
import {
  createCliAdoptionReport,
  createCliExternalFixtureReport,
  createCliImportReport,
  createCliOperationReport,
} from "../report-producer";

describe("CLI operational report producer", () => {
  it("injects the exact live CLI version and owns UUID/time generation", () => {
    const report = createCliOperationReport({
      command: "check",
      exitCode: 0,
      workspace: { id: "skillset--local-12abcdef3456" },
    });
    expect(report.skillset.version).toBe(cliVersion);
    expect(report.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(new Date(report.createdAt).toISOString()).toBe(report.createdAt);
  });

  it("injects the live version into each fixed typed producer", () => {
    const common = {
      exitCode: 0,
      workspace: {
        id: "skillset--local-12abcdef3456",
        repository: {
          commit: "64618a42a23300b5cbbd308ed3fec0e64bae1a4e",
          dirty: false,
          identity: "github.com/outfitter-dev/skillset",
        },
      },
    } as const;
    const renderResults = {
      failed: 0,
      rendered: 0,
      skipped: 0,
      unsupported: 0,
    } as const;
    const candidateIds = [
      adoptCandidateId({ kind: "instructions", path: "AGENTS.md" }),
      adoptCandidateId({ kind: "plugins", path: ".claude/plugins" }),
    ];
    const adoption = createCliAdoptionReport({
      ...common,
      payload: {
        alreadyAdopted: true,
        candidateIds,
        destinations: [],
        diagnosticCodes: [],
        importedUnitIds: [],
        migrationFlagCodes: [],
        phases: {
          build: { count: 0, status: "skipped" },
          import: { count: 0, status: "skipped" },
          lint: { count: 0, status: "skipped" },
          setup: { count: 0, status: "skipped" },
        },
        renderResults,
      },
    });
    const imported = createCliImportReport({
      ...common,
      payload: {
        destinations: [],
        diagnosticCodes: [],
        fields: { inferred: [], preserved: [], unsupported: [] },
        fileCount: 0,
        importedUnitIds: [],
        partial: false,
        requestedKind: "auto",
        renderResults,
        warningCodes: [],
      },
    });
    const fixture = createCliExternalFixtureReport({
      ...common,
      payload: {
        evidence: [],
        fixture: {
          manifestEntryCount: 1,
          manifestSha256: "a".repeat(64),
          name: "fixture",
          pinnedCommit: "b".repeat(40),
          repository: "github.com/example/fixture",
          targets: ["codex"],
        },
        pipelinePassed: false,
        phases: {
          acquire: { exitClass: "command-failure", status: "failed" },
          init: { exitClass: "not-run", status: "not-run" },
          import: { exitClass: "not-run", status: "not-run" },
          lint: { exitClass: "not-run", status: "not-run" },
          build: { exitClass: "not-run", status: "not-run" },
          purity: { exitClass: "not-run", status: "not-run" },
          compare: { exitClass: "not-run", status: "not-run" },
        },
        runtime: { bunVersion: "1.3.14" },
        summaries: {
          comparisonDifferences: 0,
          importedUnits: 0,
          migrationFlags: 0,
          renderResults,
          surveyCandidates: 0,
        },
      },
    });

    expect(
      [adoption, imported, fixture].map((report) => report.skillset.version)
    ).toEqual([cliVersion, cliVersion, cliVersion]);
    expect([
      adoption.result.command,
      imported.result.command,
      fixture.result.command,
    ]).toEqual(["init.adopt", "import", "conformance.external"]);
    expect(adoption.payload.candidateIds).toEqual([
      "instructions:AGENTS.md",
      "plugins:.claude/plugins",
    ]);
  });
});
