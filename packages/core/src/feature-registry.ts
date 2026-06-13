import { compareStrings } from "./path";
import type { TargetName } from "./types";

export type SkillsetFeatureId = string;

export const FEATURE_STATUS_VALUES = [
  "deferred",
  "future",
  "implemented",
  "planned",
  "reserved",
  "unsupported",
] as const;

export type SkillsetFeatureStatus = (typeof FEATURE_STATUS_VALUES)[number];

export const TARGET_SUPPORT_STATUS_VALUES = [
  "degraded",
  "externally_managed",
  "future",
  "lossy",
  "metadata_only",
  "native",
  "not_applicable",
  "pass_through",
  "planned",
  "transformed",
  "unsupported",
] as const;

export type SkillsetTargetSupportStatus = (typeof TARGET_SUPPORT_STATUS_VALUES)[number];

export type SkillsetFeatureKind =
  | "adoption"
  | "change-management"
  | "metadata"
  | "plugin-component"
  | "source"
  | "target-native"
  | "workflow";

export type SkillsetEvidenceKind =
  | "assumption"
  | "docs"
  | "external-docs"
  | "fixture"
  | "source"
  | "test";

export interface SkillsetFeatureEvidence {
  readonly kind: SkillsetEvidenceKind;
  readonly note?: string;
  readonly ref: string;
  readonly verifiedAt?: string;
}

export interface SkillsetTargetSupport {
  readonly evidence?: readonly SkillsetFeatureEvidence[];
  readonly note?: string;
  readonly reason?: string;
  readonly status: SkillsetTargetSupportStatus;
}

export interface SkillsetFeatureEntry {
  readonly docs: readonly string[];
  readonly evidence: readonly SkillsetFeatureEvidence[];
  readonly id: SkillsetFeatureId;
  readonly kind: SkillsetFeatureKind;
  readonly loweringOwner: string;
  readonly sourceShape: string;
  readonly status: SkillsetFeatureStatus;
  readonly summary: string;
  readonly targetSupport: Readonly<Record<TargetName, SkillsetTargetSupport>>;
  readonly title: string;
  readonly validationOwner: string;
}

export type SkillsetFeatureRegistry = readonly SkillsetFeatureEntry[];

export const skillsetFeatureRegistry = defineFeatureRegistry([
  feature({
    docs: ["docs/features/changes.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-34/35/36 change status and entry coverage")],
    id: "changes",
    kind: "change-management",
    loweringOwner: "apps/skillset/src/change-entries.ts",
    sourceShape: ".skillset/changes/pending/*.yaml and .skillset/changes/history/*.jsonl",
    status: "implemented",
    summary: "Tracks source-unit changes, evidence hashes, pending entries, and applied history.",
    targetSupport: notTargetRuntime(),
    title: "Changes",
    validationOwner: "apps/skillset/src/change-entries.ts",
  }),
  feature({
    docs: ["docs/features/dependencies.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-40 dependency lowering tests")],
    id: "dependencies",
    kind: "metadata",
    loweringOwner: "packages/core/src/dependencies.ts",
    sourceShape: "plugin skillset.yaml dependencies",
    status: "implemented",
    summary: "Declares plugin dependencies and lowers target-specific install/awareness behavior.",
    targetSupport: {
      claude: { status: "native" },
      codex: { note: "Codex gets generated dependency notices rather than a native plugin dependency resolver.", status: "degraded" },
    },
    title: "Dependencies",
    validationOwner: "packages/core/src/dependencies.ts",
  }),
  feature({
    docs: ["docs/features/feature-source-pointers.md", "docs/features/mcp-servers.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-26 MCP pointer coverage")],
    id: "plugin-mcp",
    kind: "plugin-component",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: "plugin mcp/source pointer or conventional .mcp.json",
    status: "implemented",
    summary: "Copies validated plugin MCP server definitions into Claude and Codex plugin outputs.",
    targetSupport: bothTargets("native"),
    title: "Plugin MCP Servers",
    validationOwner: "packages/core/src/resources.ts",
  }),
  feature({
    docs: ["docs/features/apps.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "Codex app manifest companion-path coverage")],
    id: "plugin-apps",
    kind: "target-native",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: "plugin codex/.app.json target-native companion file",
    status: "implemented",
    summary: "Passes Codex app manifests through as target-native plugin companion files.",
    targetSupport: {
      claude: { status: "not_applicable" },
      codex: { status: "pass_through" },
    },
    title: "Codex Plugin Apps",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/executables.md", "docs/features/feature-source-pointers.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-26 bin pointer coverage")],
    id: "plugin-bin",
    kind: "plugin-component",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: "plugin bin/source pointer or conventional bin/",
    status: "implemented",
    summary: "Copies Claude plugin-root executable helpers while failing loudly for Codex-enabled plugin output.",
    targetSupport: {
      claude: { status: "pass_through" },
      codex: { reason: "Codex plugins do not expose a documented plugin-local bin contract.", status: "unsupported" },
    },
    title: "Plugin Bin",
    validationOwner: "packages/core/src/resources.ts",
  }),
  feature({
    docs: ["docs/features/hooks.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-2 hook companion-path coverage")],
    id: "plugin-hooks",
    kind: "target-native",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: "plugin hooks/hooks.json",
    status: "implemented",
    summary: "Copies plugin hook declarations with broad Claude validation and strict Codex validation.",
    targetSupport: bothTargets("pass_through"),
    title: "Plugin Hooks",
    validationOwner: "packages/core/src/hooks.ts",
  }),
  feature({
    docs: ["docs/features/plugins.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "plugin boundary and manifest coverage")],
    id: "plugin-manifests",
    kind: "source",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/plugins/<plugin>/skillset.yaml",
    status: "implemented",
    summary: "Projects plugin metadata and component wiring into target-native plugin manifests.",
    targetSupport: bothTargets("native"),
    title: "Plugin Manifests",
    validationOwner: "packages/core/src/config.ts",
  }),
  feature({
    docs: ["docs/features/plugins.md", "docs/features/skills.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "plugin skill rendering coverage")],
    id: "plugin-skills",
    kind: "source",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/plugins/<plugin>/skills/<skill>/SKILL.md",
    status: "implemented",
    summary: "Preserves plugin-scoped skills inside each target plugin boundary.",
    targetSupport: bothTargets("native"),
    title: "Plugin Skills",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/agents.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "Codex plugin-agent failure coverage")],
    id: "plugin-agents",
    kind: "target-native",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: "plugin target-native agents/",
    status: "implemented",
    summary: "Allows Claude plugin agents as target-native companion files and rejects Codex plugin agents.",
    targetSupport: {
      claude: { status: "pass_through" },
      codex: { reason: "Codex plugin documentation does not include a plugin agents component.", status: "unsupported" },
    },
    title: "Plugin Agents",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/instructions.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-5 instruction lowering coverage")],
    id: "project-instructions",
    kind: "source",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/instructions/**/*.md",
    status: "implemented",
    summary: "Lowers project instructions to Claude rules and directory-local Codex AGENTS.md files.",
    targetSupport: bothTargets("transformed"),
    title: "Project Instructions",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/agents.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "portable project agent coverage")],
    id: "project-agents",
    kind: "source",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/src/agents/*.md",
    status: "implemented",
    summary: "Lowers portable project agents to Claude Markdown agents and Codex TOML agents.",
    targetSupport: {
      claude: { status: "native" },
      codex: { status: "transformed" },
    },
    title: "Project Agents",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/releases.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-38 release apply coverage")],
    id: "releases",
    kind: "change-management",
    loweringOwner: "apps/skillset/src/release.ts",
    sourceShape: ".skillset/releases/*.jsonl, .skillset/release-state.json, generated changelogs",
    status: "implemented",
    summary: "Applies pending changes into versions, release history, changelogs, and generated metadata.",
    targetSupport: bothTargets("metadata_only"),
    title: "Releases",
    validationOwner: "apps/skillset/src/release.ts",
  }),
  feature({
    docs: ["docs/features/resources.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "shared resource rendering coverage")],
    id: "resources",
    kind: "source",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: "skill resources frontmatter and .skillset/shared/",
    status: "implemented",
    summary: "Copies declared skill resources and validates links to shared resource declarations.",
    targetSupport: bothTargets("native"),
    title: "Resources",
    validationOwner: "packages/core/src/resources.ts",
  }),
  feature({
    docs: ["docs/features/skills.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "standalone skill rendering coverage")],
    id: "standalone-skills",
    kind: "source",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/skills/<skill>/SKILL.md",
    status: "implemented",
    summary: "Projects standalone repo skills into configured target skill roots.",
    targetSupport: bothTargets("native"),
    title: "Standalone Skills",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/supports.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-39 supports coverage")],
    id: "supports",
    kind: "metadata",
    loweringOwner: "apps/skillset/src/change-status.ts",
    sourceShape: "supports frontmatter metadata",
    status: "implemented",
    summary: "Records compatibility claims as source-significant metadata without target-frontmatter leakage.",
    targetSupport: bothTargets("metadata_only"),
    title: "Supports",
    validationOwner: "packages/core/src/supports.ts",
  }),
  feature({
    docs: ["docs/features/target-native-islands.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "target-native island coverage")],
    id: "target-native-islands",
    kind: "target-native",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/src/<target>/** and plugin-local target-native subdirs",
    status: "implemented",
    summary: "Mirrors explicitly target-owned files only to their intended provider output.",
    targetSupport: bothTargets("pass_through"),
    title: "Target-Native Islands",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/tool-intent.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "tool policy lowering coverage")],
    id: "tool-intent",
    kind: "source",
    loweringOwner: "packages/core/src/render.ts",
    sourceShape: "skill tool_intent frontmatter",
    status: "implemented",
    summary: "Normalizes tool policy intent into Claude allowed-tools fields and Codex metadata sidecars.",
    targetSupport: {
      claude: { status: "native" },
      codex: { status: "metadata_only" },
    },
    title: "Tool Intent",
    validationOwner: "packages/core/src/skill-policy.ts",
  }),
  feature({
    docs: ["docs/features/apps.md", "docs/features/hooks.md", "docs/features/commands.md", "docs/features/settings.md"],
    evidence: [docs("docs/target-surfaces.md")],
    id: "future-companion-source-pointers",
    kind: "plugin-component",
    loweringOwner: "future",
    sourceShape: "future apps.source/hooks.source/commands.source/settings.source style feature keys",
    status: "planned",
    summary: "Reserved space for future companion-file source pointers beyond current MCP and bin feature keys.",
    targetSupport: {
      claude: { status: "planned" },
      codex: { status: "planned" },
    },
    title: "Future Companion Source Pointers",
    validationOwner: "future",
  }),
  feature({
    docs: ["docs/features/ci.md", "docs/features/build-scopes.md"],
    evidence: [test("apps/skillset/src/__tests__/ci.test.ts", "CI and build-scope coverage")],
    id: "workflows",
    kind: "workflow",
    loweringOwner: "apps/skillset/src/cli-core.ts",
    sourceShape: "skillset CLI workflows such as build, check, ci, test, init, and create",
    status: "implemented",
    summary: "Provides repo-local workflow commands without lowering them into target runtime artifacts.",
    targetSupport: notTargetRuntime(),
    title: "Workflows",
    validationOwner: "apps/skillset/src/cli-core.ts",
  }),
]);

export function defineFeatureRegistry(
  entries: readonly SkillsetFeatureEntry[]
): SkillsetFeatureRegistry {
  assertFeatureIdsUnique(entries);
  assertFeatureStatusVocabulary(entries);
  return [...entries].sort((left, right) => compareStrings(left.id, right.id));
}

export function listSkillsetFeatures(
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): SkillsetFeatureRegistry {
  return registry;
}

export function getSkillsetFeature(
  id: SkillsetFeatureId,
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): SkillsetFeatureEntry | undefined {
  return registry.find((entry) => entry.id === id);
}

export function listSkillsetFeaturesByTarget(
  target: TargetName,
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): SkillsetFeatureRegistry {
  return registry.filter((entry) => entry.targetSupport[target].status !== "not_applicable");
}

export function assertFeatureIdsUnique(entries: readonly SkillsetFeatureEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`skillset: duplicate feature registry id ${entry.id}`);
    seen.add(entry.id);
  }
}

function assertFeatureStatusVocabulary(entries: readonly SkillsetFeatureEntry[]): void {
  const featureStatuses = new Set<string>(FEATURE_STATUS_VALUES);
  const targetStatuses = new Set<string>(TARGET_SUPPORT_STATUS_VALUES);
  for (const entry of entries) {
    if (!featureStatuses.has(entry.status)) {
      throw new Error(`skillset: unknown feature registry status ${entry.status} for ${entry.id}`);
    }
    for (const target of ["claude", "codex"] as const satisfies readonly TargetName[]) {
      const support = entry.targetSupport[target];
      if (!targetStatuses.has(support.status)) {
        throw new Error(
          `skillset: unknown target support status ${support.status} for ${entry.id} ${target}`
        );
      }
      if ((support.status === "lossy" || support.status === "unsupported") && support.reason === undefined) {
        throw new Error(`skillset: ${entry.id} ${target} ${support.status} support requires a reason`);
      }
    }
  }
}

function feature(entry: SkillsetFeatureEntry): SkillsetFeatureEntry {
  return entry;
}

function bothTargets(status: SkillsetTargetSupportStatus): Readonly<Record<TargetName, SkillsetTargetSupport>> {
  return {
    claude: { status },
    codex: { status },
  };
}

function notTargetRuntime(): Readonly<Record<TargetName, SkillsetTargetSupport>> {
  return bothTargets("not_applicable");
}

function docs(ref: string): SkillsetFeatureEvidence {
  return { kind: "docs", ref };
}

function test(ref: string, note: string): SkillsetFeatureEvidence {
  return { kind: "test", note, ref };
}
