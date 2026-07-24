import { expect, test } from "bun:test";

import type {
  ActivationReadinessCounts,
  ActivationReadinessSummary,
  ActivationRequirement,
} from "@skillset/core";
import { validateActivationInspectionReport } from "@skillset/schema";

import type {
  ActivationInspectionOutcome,
  ActivationInspectionReport,
} from "../activation-inspection";
import { ACTIVATION_INSPECTION_SCHEMA } from "../activation-inspection";
import { printActivationInspection } from "../activation-presentation";

test("SET-392: activation summaries use the stable human vocabulary", () => {
  for (const [summary, expected] of [
    ["ready", "activation: ready"],
    [
      "ready_unverified",
      "activation: ready with unverified requirements",
    ],
    ["attention", "activation: attention"],
    ["blocked", "activation: blocked"],
  ] as const satisfies readonly [
    ActivationReadinessSummary,
    string,
  ][]) {
    expect(render(reportFixture({ summary }))).toContain(expected);
  }
});

test("SET-392: required findings precede optional facts and actions stay guidance", () => {
  const required = requirementFixture({
    id: "required",
    nextActions: [
      {
        id: "configure",
        label: "Configure the server",
        mutates: true,
        url: "https://example.com/configure",
      },
    ],
    required: true,
    state: "missing",
    subject: "required",
  });
  const optional = requirementFixture({
    id: "optional",
    required: false,
    state: "blocked",
    subject: "optional",
  });
  const output = render(
    reportFixture({
      requirements: [optional, required],
      summary: "attention",
    })
  );

  expect(output.indexOf("required")).toBeLessThan(output.indexOf("optional"));
  expect(output).toContain("next: Configure the server (changes provider state)");
});

test("SET-392: inspector output discloses active/passive effects and outcomes", () => {
  const output = render(
    reportFixture({
      inspections: [
        receipt("passive", "malformed"),
        receipt("passive", "ran"),
        receipt("active", "timed_out"),
        receipt("passive", "skipped"),
        receipt("none", "unavailable"),
      ],
    })
  );

  expect(output).toContain("active, timed_out");
  expect(output).toContain("passive, malformed");
  expect(output).toContain("passive, ran");
  expect(output).toContain("passive, skipped");
  expect(output).toContain("none, unavailable");
});

test("SET-392: every summary fixture satisfies the public machine schema", () => {
  for (const summary of [
    "ready",
    "ready_unverified",
    "attention",
    "blocked",
  ] as const) {
    const report = reportFixture({
      requirements:
        summary === "ready"
          ? []
          : [
              requirementFixture({
                state:
                  summary === "blocked"
                    ? "blocked"
                    : summary === "attention"
                      ? "missing"
                      : "unverified",
              }),
            ],
      summary,
    });

    expect(validateActivationInspectionReport(report)).toEqual({
      diagnostics: [],
      ok: true,
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  }
});

function reportFixture(
  overrides: {
    readonly inspections?: ActivationInspectionReport["inspections"];
    readonly requirements?: readonly ActivationRequirement[];
    readonly summary?: ActivationReadinessSummary;
  } = {}
): ActivationInspectionReport {
  const requirements = overrides.requirements ?? [];
  return {
    inspections: overrides.inspections ?? [],
    readiness: {
      counts: counts(requirements),
      enabledTargets: requirements.length === 0 ? [] : ["codex"],
      requirements,
      schema: "skillset.activation-readiness@1",
      summary: overrides.summary ?? "ready",
    },
    schema: ACTIVATION_INSPECTION_SCHEMA,
  };
}

function requirementFixture(
  overrides: Partial<ActivationRequirement>
): ActivationRequirement {
  return {
    capability: "mcp-server",
    id: "fixture",
    nextActions: [],
    observationEffect: "none",
    origin: "derived",
    reason: "fixture reason",
    required: true,
    sourcePaths: [".skillset/plugins/demo/.mcp.json"],
    sourceUnits: ["plugin.demo.feature:mcp"],
    stage: "discoverable",
    state: "unverified",
    subject: "demo",
    target: "codex",
    ...overrides,
  };
}

function counts(
  requirements: readonly ActivationRequirement[]
): ActivationReadinessCounts {
  const result = {
    blocked: 0,
    missing: 0,
    notApplicable: 0,
    satisfied: 0,
    stale: 0,
    unverified: 0,
  };
  for (const requirement of requirements) {
    if (requirement.state === "not_applicable") result.notApplicable += 1;
    else result[requirement.state] += 1;
  }
  return result;
}

function receipt(
  effect: "active" | "none" | "passive",
  outcome: ActivationInspectionOutcome
): ActivationInspectionReport["inspections"][number] {
  return {
    capability: "mcp-server",
    effect,
    inspectorId: `fixture.${effect}`,
    outcome,
    stderrBytes: 0,
    stderrTruncated: false,
    stdoutBytes: 0,
    stdoutTruncated: false,
    subjects: ["demo"],
    summary: "fixture inspector",
    target: "codex",
  };
}

function render(report: ActivationInspectionReport): string {
  let output = "";
  printActivationInspection(report, {
    stderr: { write: () => true },
    stdout: {
      write: (value) => {
        output += String(value);
        return true;
      },
    },
  });
  return output;
}
