import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import type {
  LintIssue,
  SkillsetFeatureEntry,
} from "@skillset/core";

import {
  checkWorkbenchSourceContract,
  formatWorkbenchDiagnostic,
  summarizeWorkbenchDiagnostics,
  workbenchDiagnosticsFromResourceLintIssues,
  workbenchDiagnosticsFromRuntimeSupport,
} from "../index";
import type {
  WorkbenchDiagnostic,
  WorkbenchSourceContractKind,
} from "../index";

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");

describe("workbench fixtures", () => {
  test("clean fixture has no source-contract, resource, or runtime diagnostics", async () => {
    expect(await fixtureFileExists(
      "workbench-clean",
      ".skillset/src/hooks/scripts/check.sh"
    )).toBeTrue();
    const diagnostics = [
      ...(await sourceContractDiagnostics("workbench-clean", cleanSources)),
      ...workbenchDiagnosticsFromResourceLintIssues(
        await resourceIssuesFromFixture("workbench-clean", ".skillset/src/skills/reference/SKILL.md")
      ),
      ...workbenchDiagnosticsFromRuntimeSupport([
        feature({
          id: "runtime-adapters",
          runtimeSupport: {
            "codex-cli": {
              mechanism: "Codex CLI can consume the generated Codex provider output.",
              status: "native",
            },
          },
        }),
      ]),
    ];

    expect(summarizeWorkbenchDiagnostics(diagnostics)).toMatchObject({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
    expect(diagnostics).toEqual([]);
  });

  test("invalid fixture reports deterministic source, resource, and runtime diagnostics", async () => {
    const diagnostics = summarizeWorkbenchDiagnostics([
      ...(await sourceContractDiagnostics("workbench-invalid", invalidSources)),
      ...workbenchDiagnosticsFromResourceLintIssues(invalidResourceIssues),
      ...workbenchDiagnosticsFromRuntimeSupport([
        feature({
          id: "project-agents",
          runtimeSupport: {
            "codex-cli": {
              caveats: ["Skill loading is instruction-guided."],
              diagnostics: ["Skill loading is not runtime-enforced."],
              mechanism: "Skillset writes an instruction preface.",
              status: "shimmed",
            },
          },
        }),
      ], { locationPath: "fixtures/workbench-invalid" }),
    ]);

    expect(diagnostics.ok).toBeFalse();
    expect(diagnostics.errorCount).toBe(25);
    expect(diagnostics.warningCount).toBe(1);
    expect(diagnostics.diagnostics.map(formatWorkbenchDiagnostic)).toEqual([
      ".skillset/skillset.yaml:1: error: schema/workspace-config: compile.build must be one of all, updated",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: compile.features.promptArguments must be a boolean",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: compile.skillset.metadata must be a boolean",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: compile.unsupportedDestination warn, skip, and force are reserved; use error",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: duplicate compile target claude",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: unsupported compile feature key surprise",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: unsupported compile skillset key surprise",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: unsupported compile target gemini",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: unsupported workspace config key targets",
      ".skillset/skillset.yaml:1: error: schema/workspace-config: workspace config must use compile.targets instead of targets",
      ".skillset/src/agents/broken.md:1: error: schema/agent-frontmatter: agents must remove targets; use root compile.targets and claude/codex blocks for file-level behavior",
      ".skillset/src/agents/broken.md:1: error: schema/agent-frontmatter: codex must be true, false, or an object when present",
      ".skillset/src/agents/broken.md:1: error: schema/agent-frontmatter: description is required and must be a non-empty string",
      ".skillset/src/agents/broken.md:1: error: schema/agent-frontmatter: skills must be a string array when present",
      ".skillset/src/agents/broken.md:11: error: schema/agent-body: agent body is required",
      ".skillset/src/hooks/hooks.json:1: error: schema/hook: hook event PreToolUse entries must be objects",
      ".skillset/src/hooks/hooks.json:1: error: schema/hook: hook event SessionStart must be an array",
      ".skillset/src/hooks/hooks.json:1: error: schema/hook: hook event Stop hook handlers must be objects",
      ".skillset/src/hooks/hooks.json:1: error: schema/hook: hook event Stop hook handlers must include a non-empty string type",
      ".skillset/src/skills/broken/SKILL.md:1: error: schema/skill-frontmatter: resources must be an object when present",
      ".skillset/src/skills/broken/SKILL.md:1: error: schema/skill-frontmatter: skill needs description, summary, title, or skillset descriptive metadata",
      ".skillset/src/skills/broken/SKILL.md:1: error: schema/skill-frontmatter: skills must remove targets; use root compile.targets and claude/codex blocks for file-level behavior",
      ".skillset/src/skills/broken/SKILL.md:1: error: schema/skill-frontmatter: skillset.name is unsupported in skills; use top-level name",
      ".skillset/src/skills/broken/SKILL.md:1: error: schema/skill-frontmatter: skillset.version is unsupported in skills; use top-level version",
      ".skillset/src/skills/broken/SKILL.md: error: resource/resource-undeclared-link: broken skill links to undeclared resource ./scripts/check.sh",
      "fixtures/workbench-invalid: warning: runtime/shimmed: codex-cli project-agents: Skill loading is not runtime-enforced.",
    ]);
  });
});

interface SourceContractSpec {
  readonly kind: WorkbenchSourceContractKind;
  readonly path: string;
}

const cleanSources: readonly SourceContractSpec[] = [
  { kind: "workspace-config", path: ".skillset/skillset.yaml" },
  { kind: "skill", path: ".skillset/src/skills/reference/SKILL.md" },
  { kind: "agent", path: ".skillset/src/agents/reviewer.md" },
  { kind: "hook", path: ".skillset/src/hooks/hooks.json" },
];

const invalidSources: readonly SourceContractSpec[] = [
  { kind: "workspace-config", path: ".skillset/skillset.yaml" },
  { kind: "skill", path: ".skillset/src/skills/broken/SKILL.md" },
  { kind: "agent", path: ".skillset/src/agents/broken.md" },
  { kind: "hook", path: ".skillset/src/hooks/hooks.json" },
];

const invalidResourceIssues = await resourceIssuesFromFixture(
  "workbench-invalid",
  ".skillset/src/skills/broken/SKILL.md"
);

async function sourceContractDiagnostics(
  fixtureName: string,
  specs: readonly SourceContractSpec[]
): Promise<readonly WorkbenchDiagnostic[]> {
  const diagnostics: WorkbenchDiagnostic[] = [];
  for (const spec of specs) {
    const content = await Bun.file(join(repoRoot, "fixtures", fixtureName, spec.path)).text();
    diagnostics.push(...checkWorkbenchSourceContract({
      content,
      kind: spec.kind,
      path: spec.path,
    }));
  }
  return diagnostics;
}

async function resourceIssuesFromFixture(
  fixtureName: string,
  skillPath: string
): Promise<readonly LintIssue[]> {
  const content = await fixtureFileText(fixtureName, skillPath);
  if (!content.includes("./scripts/check.sh")) return [];

  const declaresScript = /from:\s*\.\/scripts\/check\.sh/u.test(content);
  const scriptExists = await fixtureFileExists(
    fixtureName,
    join(dirname(skillPath), "scripts/check.sh")
  );
  if (declaresScript && scriptExists) return [];

  return [
    {
      code: "resource-undeclared-link",
      featureId: "resources",
      message: "broken skill links to undeclared resource ./scripts/check.sh",
      path: skillPath,
      severity: "error",
    },
  ];
}

async function fixtureFileText(fixtureName: string, path: string): Promise<string> {
  return Bun.file(join(repoRoot, "fixtures", fixtureName, path)).text();
}

async function fixtureFileExists(fixtureName: string, path: string): Promise<boolean> {
  return Bun.file(join(repoRoot, "fixtures", fixtureName, path)).exists();
}

function feature(
  overrides: Pick<SkillsetFeatureEntry, "id"> &
    Partial<Omit<SkillsetFeatureEntry, "id">>
): SkillsetFeatureEntry {
  const { id, ...rest } = overrides;
  return {
    docs: ["docs/features/test.md"],
    evidence: [],
    id,
    kind: "workflow",
    renderOwner: "packages/core/src/test.ts",
    sourceShape: ".skillset/src/test",
    status: "implemented",
    summary: "Test feature.",
    targetSupport: {
      claude: { status: "native" },
      codex: { status: "native" },
    },
    title: "Test Feature",
    validationOwner: "packages/core/src/test.ts",
    ...rest,
  };
}
