import { expect, test } from "bun:test";

import type { ChangeCheckReport, PendingChangeEntry } from "../change-entries";
import {
  classifyRecoveryGuidance,
  mechanicalFixEligibility,
  quoteShellArgument,
  type RecoveryGuidanceInput,
} from "../recovery-guidance";
import type { ProviderFormatUpdateReport } from "../provider-format-updates";

const EMPTY_DRIFT = { added: [], changed: [], missing: [], removed: [] };

test("classifies uncovered source and refreshable reason evidence with exact scope, ref, and baseline", () => {
  const entry = pendingEntry({
    id: "abcdef123456",
    path: ".skillset/changes/abcdef123456.md",
  });
  const recovery = classifyRecoveryGuidance(input({
    changeReport: changeReport({
      entries: [entry],
      issues: [
        {
          code: "change-evidence-stale",
          message: "stale",
          path: entry.path,
          ref: "@abcdef123456",
          severity: "error",
        },
        {
          code: "change-uncovered",
          message: "uncovered",
          scope: "skill:other",
          severity: "error",
        },
      ],
    }),
  }));

  expect(recovery).toEqual(expect.arrayContaining([
    expect.objectContaining({
      action: "change-add",
      commands: [
        'skillset change add --scope skill:other --bump <major|minor|patch|none> --reason "<reason>" --since origin/main',
      ],
      scope: "skill:other",
    }),
    expect.objectContaining({
      action: "change-refresh",
      commands: [
        "skillset change refresh @abcdef123456 --since origin/main",
        "skillset change refresh @abcdef123456 --since origin/main --yes",
      ],
      path: entry.path,
      ref: "@abcdef123456",
    }),
  ]));
});

test("keeps legacy evidence out of refresh guidance and withholds confirmed migration when invalid", () => {
  const entry = pendingEntry({ format: "frontmatter", id: "abcdef123456" });
  const recovery = classifyRecoveryGuidance(input({
    changeReport: changeReport({
      entries: [entry],
      issues: [{
        code: "change-evidence-stale",
        message: "stale",
        path: entry.path,
        ref: "@abcdef123456",
        severity: "error",
      }],
    }),
  }));

  expect(recovery).toContainEqual(expect.objectContaining({
    action: "change-migrate",
    blocked: true,
    commands: [],
  }));
  expect(recovery.some((item) => item.action === "change-refresh")).toBe(false);
});

test("uses preview-only reconciliation and never chooses target or source authority", () => {
  const recovery = classifyRecoveryGuidance(input({
    outputEditedPaths: [".claude/skills/demo/SKILL.md"],
    sourceSuggestions: [sourceSuggestion("suggestible")],
  }));

  expect(recovery).toContainEqual(expect.objectContaining({
    action: "reconcile",
    commands: ["skillset reconcile .claude/skills/demo/SKILL.md"],
    path: ".claude/skills/demo/SKILL.md",
  }));
  expect(JSON.stringify(recovery)).not.toContain("--use");
});

test("withholds reconcile commands when the existing preview says recovery is refused", () => {
  const recovery = classifyRecoveryGuidance(input({
    outputEditedPaths: [".claude/skills/demo/SKILL.md"],
    sourceSuggestions: [sourceSuggestion("refused")],
  }));

  expect(recovery).toContainEqual(expect.objectContaining({
    action: "manual-review",
    blocked: true,
    commands: [],
    path: ".claude/skills/demo/SKILL.md",
    reason: "reconciliation refused",
  }));
  expect(recovery.some((item) => item.action === "reconcile")).toBe(false);
});

test("only offers update confirmation for unblocked safe provider actions", () => {
  const safe = providerReport({
    safeUpdates: [providerAction("safe")],
  });
  const blocked = providerReport({
    blocked: true,
    manualReviews: [providerAction("manual")],
    safeUpdates: [providerAction("safe")],
  });

  const providerUpdatePaths = ["plugins/skillset/codex/.codex-plugin/plugin.json"];
  expect(classifyRecoveryGuidance(input({ providerReport: safe, providerUpdatePaths }))).toContainEqual(expect.objectContaining({
    action: "update",
    commands: ["skillset update", "skillset update --yes"],
  }));
  const blockedRecovery = classifyRecoveryGuidance(input({ providerReport: blocked, providerUpdatePaths }));
  expect(blockedRecovery.some((item) => item.action === "update")).toBe(false);
  expect(blockedRecovery).toContainEqual(expect.objectContaining({
    action: "manual-review",
    blocked: true,
    commands: [],
  }));
});

test("shares generated-only fix eligibility across local and CI commands and suppresses it for multiple blockers", () => {
  const drift = { ...EMPTY_DRIFT, changed: ["AGENTS.md"] };
  expect(classifyRecoveryGuidance(input({ drift, mode: "local" }))).toContainEqual(expect.objectContaining({
    action: "rebuild-generated-output",
    commands: ["skillset check --write"],
  }));
  expect(classifyRecoveryGuidance(input({ drift, mode: "ci" }))).toContainEqual(expect.objectContaining({
    action: "rebuild-generated-output",
    commands: ["skillset check --ci --fix"],
  }));

  const blocked = input({
    changesetIssues: ["missing changeset"],
    drift,
    outputDiagnostics: [{ code: "unsupported", message: "unsupported", severity: "error" }],
  });
  expect(mechanicalFixEligibility(blocked)).toEqual({
    blockers: ["Changesets issues", "generated-output diagnostics"],
    eligible: false,
  });
  const recovery = classifyRecoveryGuidance(blocked);
  expect(recovery.some((item) => item.action === "rebuild-generated-output")).toBe(false);
  expect(recovery).toContainEqual(expect.objectContaining({ action: "manual-review", blocked: true }));
});

test("deduplicates and orders recovery guidance deterministically", () => {
  const report = changeReport({
    issues: [
      { code: "change-uncovered", message: "b", scope: "skill:z", severity: "error" },
      { code: "change-uncovered", message: "a", scope: "skill:a", severity: "error" },
      { code: "change-uncovered", message: "again", scope: "skill:a", severity: "error" },
    ],
  });
  const recovery = classifyRecoveryGuidance(input({ changeReport: report }));

  expect(recovery.filter((item) => item.action === "change-add").map((item) => item.scope)).toEqual([
    "skill:a",
    "skill:z",
  ]);
});

test("quotes dynamic command arguments and preserves exact argv through a POSIX shell", async () => {
  const path = "custom outputs/it's $(printf injected)/`demo`/SKILL.md";
  const reconcile = classifyRecoveryGuidance(input({
    outputEditedPaths: [path],
    sourceSuggestions: [{ ...sourceSuggestion("suggestible"), generatedPath: path }],
  })).find((item) => item.action === "reconcile")?.commands[0];
  expect(reconcile).toBe(`skillset reconcile ${quoteShellArgument(path)}`);
  expect(await shellArgv(reconcile ?? "")).toEqual(["reconcile", path]);

  const baseline = "feature/$(printf injected)'quoted";
  const entry = pendingEntry({ id: "abcdef123456" });
  const refresh = classifyRecoveryGuidance(input({
    changeReport: changeReport({
      entries: [entry],
      issues: [{
        code: "change-evidence-stale",
        message: "stale",
        path: entry.path,
        ref: "@abcdef123456",
        severity: "error",
      }],
      status: {
        ...changeReport().status,
        baseline: { kind: "git-ref", ref: baseline },
      },
    }),
  })).find((item) => item.action === "change-refresh")?.commands[0];
  expect(await shellArgv(refresh ?? "")).toEqual([
    "change",
    "refresh",
    "@abcdef123456",
    "--since",
    baseline,
  ]);

  const scope = "skill:custom output's";
  const add = classifyRecoveryGuidance(input({
    changeReport: changeReport({
      issues: [{ code: "change-uncovered", message: "uncovered", scope, severity: "error" }],
    }),
  })).find((item) => item.action === "change-add")?.commands[0];
  const completedAdd = (add ?? "")
    .replace("<major|minor|patch|none>", "patch")
    .replace('\"<reason>\"', "reason");
  expect(await shellArgv(completedAdd)).toEqual([
    "change",
    "add",
    "--scope",
    scope,
    "--bump",
    "patch",
    "--reason",
    "reason",
    "--since",
    "origin/main",
  ]);

  const rebuild = classifyRecoveryGuidance(input({
    changeReport: changeReport({
      status: {
        ...changeReport().status,
        baseline: { kind: "git-ref", ref: baseline },
      },
    }),
    drift: { ...EMPTY_DRIFT, changed: ["AGENTS.md"] },
    mode: "ci",
  })).find((item) => item.action === "rebuild-generated-output")?.commands[0];
  expect(await shellArgv(rebuild ?? "")).toEqual([
    "check",
    "--ci",
    "--fix",
    "--since",
    baseline,
  ]);
});

async function shellArgv(command: string): Promise<readonly string[]> {
  const script = `skillset() { printf '%s\\0' "$@"; }\n${command}`;
  const process = Bun.spawn(["/bin/sh", "-c", script], { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  return new TextDecoder().decode(stdout).split("\0").filter(Boolean);
}

function input(overrides: Partial<RecoveryGuidanceInput> = {}): RecoveryGuidanceInput {
  return {
    changesetIssues: [],
    drift: EMPTY_DRIFT,
    lintIssues: [],
    mode: "local",
    outputDiagnostics: [],
    outputEditedPaths: [],
    providerUpdatePaths: [],
    sourceSuggestions: [],
    unmanagedOutputCollisions: false,
    ...overrides,
  };
}

function sourceSuggestion(status: "refused" | "suggestible") {
  return {
    entries: [],
    generatedPath: ".claude/skills/demo/SKILL.md",
    message: status === "refused" ? "reconciliation refused" : "reconciliation is safe to preview",
    nextSteps: [],
    sourcePath: ".skillset/skills/demo/SKILL.md",
    status,
    wouldWrite: status === "suggestible",
    wrote: false,
  } as const;
}

function changeReport(overrides: Partial<ChangeCheckReport> = {}): ChangeCheckReport {
  return {
    entries: [],
    issues: [],
    ok: true,
    stackedEvidence: [],
    status: {
      baseline: { kind: "git-ref", ref: "origin/main" },
      generatedDrift: EMPTY_DRIFT,
      hashSchema: "skillset-source-unit-v2",
      sourceChanges: [],
      sourceUnits: [],
    },
    ...overrides,
  };
}

function pendingEntry(overrides: Partial<PendingChangeEntry> = {}): PendingChangeEntry {
  return {
    bump: "patch",
    format: "reason",
    id: "abcdef123456",
    ignored: false,
    path: ".skillset/changes/abcdef123456.md",
    reason: "A sufficiently detailed pending reason.",
    schemaDiagnostics: [],
    scopes: ["skill:demo"],
    sourceHashes: new Map([["skill:demo", ["sha256:current"]]]),
    ...overrides,
  };
}

function providerReport(overrides: Partial<ProviderFormatUpdateReport> = {}): ProviderFormatUpdateReport {
  return {
    blocked: false,
    checkedFiles: 1,
    command: "check",
    drift: EMPTY_DRIFT,
    legacyLockOutputPaths: [],
    manualReviews: [],
    ok: true,
    safeUpdates: [],
    sourceDriftPaths: [],
    unplannedDriftPaths: [],
    wrote: false,
    writtenPaths: [],
    ...overrides,
  };
}

function providerAction(id: string) {
  return {
    affectedPaths: ["plugins/skillset/codex/.codex-plugin/plugin.json"],
    description: `${id} description`,
    id,
    provider: "codex",
    safety: "adapter-only" as const,
    snapshotId: "codex-plugin" as const,
    sourceUnit: "plugin:skillset",
    surface: "plugin",
    updatePath: "adapter" as const,
  };
}
