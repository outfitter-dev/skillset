import {
  getProviderDestinationFormatSnapshot,
  getProviderSchemaSnapshot,
  providerSchemaManualOverlays,
  type ProviderDestinationFormatSnapshotId,
  type ProviderSchemaManualOverlayId,
  type ProviderSchemaSnapshotId,
} from "@skillset/registry";

import { compareStrings } from "./path";
import { targetNames, targetRecord } from "./targets";
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
  "shimmed",
  "transformed",
  "unsupported",
] as const;

export type SkillsetTargetSupportStatus = (typeof TARGET_SUPPORT_STATUS_VALUES)[number];

export const SKILLSET_RUNTIME_IDS = [
  "claude-code",
  "codex-app",
  "codex-cli",
  "cursor",
  "devin",
  "droid",
  "gemini-cli",
  "opencode",
] as const;

export type SkillsetRuntimeId = (typeof SKILLSET_RUNTIME_IDS)[number];

export const RUNTIME_SUPPORT_STATUS_VALUES = TARGET_SUPPORT_STATUS_VALUES;

export type SkillsetRuntimeSupportStatus = (typeof RUNTIME_SUPPORT_STATUS_VALUES)[number];

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
  | "provider-overlay"
  | "provider-schema"
  | "provider-snapshot"
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
  readonly provider?: SkillsetProviderSupportEvidence;
  readonly reason?: string;
  readonly status: SkillsetTargetSupportStatus;
}

export interface SkillsetProviderSupportEvidence {
  readonly destinationFormat?: ProviderDestinationFormatSnapshotId;
  readonly manualOverlays?: readonly ProviderSchemaManualOverlayId[];
  readonly schemaSnapshots?: readonly ProviderSchemaSnapshotId[];
  readonly unsupportedDestinations?: readonly string[];
}

export interface SkillsetRuntimeSupport {
  readonly caveats?: readonly string[];
  readonly diagnostics?: readonly string[];
  readonly evidence?: readonly SkillsetFeatureEvidence[];
  readonly mechanism?: string;
  readonly reason?: string;
  readonly setup?: readonly string[];
  readonly status: SkillsetRuntimeSupportStatus;
}

export interface SkillsetFeatureEntry {
  readonly docs: readonly string[];
  readonly evidence: readonly SkillsetFeatureEvidence[];
  readonly id: SkillsetFeatureId;
  readonly kind: SkillsetFeatureKind;
  readonly renderOwner: string;
  readonly runtimeSupport?: Partial<Record<SkillsetRuntimeId, SkillsetRuntimeSupport>>;
  readonly sourceShape: string;
  readonly status: SkillsetFeatureStatus;
  readonly summary: string;
  readonly targetSupport: Readonly<Record<TargetName, SkillsetTargetSupport>>;
  readonly title: string;
  readonly validationOwner: string;
}

export type SkillsetFeatureRegistry = readonly SkillsetFeatureEntry[];

type FeatureTargetSupportInput =
  Readonly<Record<"claude" | "codex", SkillsetTargetSupport>> &
  Partial<Readonly<Record<TargetName, SkillsetTargetSupport>>>;

type SkillsetFeatureEntryInput = Omit<SkillsetFeatureEntry, "targetSupport"> & {
  readonly targetSupport: FeatureTargetSupportInput;
};

const CURSOR_PROVIDER_EVIDENCE = [
  docs("docs/adrs/drafts/20260702-cursor-is-a-first-class-provider.md"),
  docs("docs/target-surfaces.md#cursor-provider-baseline"),
] as const satisfies readonly SkillsetFeatureEvidence[];

export const skillsetFeatureRegistry = defineFeatureRegistry([
  feature({
    docs: ["docs/features/tests-and-evals.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-112 activation probe coverage")],
    id: "activation-probes",
    kind: "workflow",
    renderOwner: "apps/skillset/src/test-runner.ts",
    sourceShape: "<source-root>/tests.yaml or <source-root>/tests/*.yaml activation[]",
    status: "implemented",
    summary: "Compiles target-aware manual activation probe assets inside isolated test runs.",
    targetSupport: notTargetRuntime(),
    title: "Activation Probes",
    validationOwner: "apps/skillset/src/test-runner.ts",
  }),
  feature({
    docs: ["docs/features/changes.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-34/35/36 change status and entry coverage")],
    id: "changes",
    kind: "change-management",
    renderOwner: "apps/skillset/src/change-entries.ts",
    sourceShape: "workspace changes/*.md and changes/history.jsonl",
    status: "implemented",
    summary: "Tracks source-unit changes, evidence hashes, pending entries, and applied history.",
    targetSupport: notTargetRuntime(),
    title: "Changes",
    validationOwner: "apps/skillset/src/change-entries.ts",
  }),
  feature({
    docs: ["docs/features/dev-watch.md"],
    evidence: [test("apps/skillset/src/__tests__/dev-watch.test.ts", "SET-210/212 dev watch path, debounce, preview, apply, backup, and validation coverage")],
    id: "dev-watch",
    kind: "workflow",
    renderOwner: "apps/skillset/src/dev-watch.ts",
    sourceShape: "workspace config plus active source root watched by skillset dev --watch",
    status: "implemented",
    summary: "Runs a foreground authoring loop over source diagnostics and generated-output drift, with explicit apply mode for generated writes.",
    targetSupport: notTargetRuntime(),
    title: "Dev Watch",
    validationOwner: "apps/skillset/src/dev-watch.ts",
  }),
  feature({
    docs: ["docs/features/dependencies.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-40 dependency rendering tests")],
    id: "dependencies",
    kind: "metadata",
    renderOwner: "packages/core/src/dependencies.ts",
    sourceShape: "plugin skillset.yaml dependencies",
    status: "implemented",
    summary: "Declares plugin dependencies and renders target-specific install/awareness behavior.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/dependencies.md"), providerSnapshot("claude-plugin")],
        provider: { destinationFormat: "claude-plugin" },
        status: "native",
      },
      codex: {
        evidence: [docs("docs/features/dependencies.md"), source("packages/core/src/dependencies.ts")],
        note: "Codex gets generated dependency notices rather than a native plugin dependency resolver.",
        provider: { destinationFormat: "codex-plugin" },
        reason: "Codex gets generated dependency notices rather than a native plugin dependency resolver.",
        status: "degraded",
      },
    },
    title: "Dependencies",
    validationOwner: "packages/core/src/dependencies.ts",
  }),
  feature({
    docs: ["docs/features/distributions.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-109 distribute plan coverage")],
    id: "distributions",
    kind: "workflow",
    renderOwner: "packages/core/src/distribution.ts",
    sourceShape: "workspace skillset.yaml distributions",
    status: "implemented",
    summary: "Plans post-build distribution of generated projections without writing or activating runtimes.",
    targetSupport: notTargetRuntime(),
    title: "Distributions",
    validationOwner: "packages/core/src/config.ts",
  }),
  feature({
    docs: ["docs/features/marketplaces.md"],
    evidence: [
      docs("https://linear.app/outfitter/issue/SET-133/design-skillset-marketplace-catalogs-and-external-plugin-references"),
      docs("https://linear.app/outfitter/issue/SET-233/add-managed-known-skillsets-index-for-marketplace-repo-resolution"),
      docs("https://linear.app/outfitter/issue/SET-234/implement-skillset-marketplace-check-readiness-reports"),
      docs("https://linear.app/outfitter/issue/SET-235/define-marketplace-ref-policy-and-lock-provenance-for-floating-and"),
      docs("https://linear.app/outfitter/issue/SET-236/implement-skillset-marketplace-update-provider-index-rendering"),
      test("apps/skillset/src/__tests__/marketplace-check-cli.test.ts", "SET-234 marketplace check CLI coverage"),
      test("apps/skillset/src/__tests__/marketplace-check-cli.test.ts", "SET-236 marketplace update CLI coverage"),
      test("packages/core/src/__tests__/marketplace-check.test.ts", "SET-234 marketplace readiness report coverage"),
      test("packages/core/src/__tests__/marketplace-check.test.ts", "SET-235 marketplace lock provenance coverage"),
      test("apps/skillset/src/__tests__/skillset.test.ts", "SET-133 marketplace catalog parser coverage"),
      test("packages/core/src/__tests__/known-skillsets.test.ts", "managed known-Skillsets XDG index coverage"),
      test("packages/schema/src/__tests__/schema.test.ts", "workspace config marketplace contract coverage"),
    ],
    id: "marketplaces",
    kind: "workflow",
    renderOwner: "packages/core/src/marketplace-update.ts",
    sourceShape: "workspace skillset.yaml marketplaces",
    status: "implemented",
    summary: "Declares curated provider marketplace catalogs, verifies local or known-index plugin readiness with lock provenance, and renders provider-supported marketplace indexes.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/marketplaces.md"), providerSchemaSnapshot("claude-marketplace-schema")],
        provider: { schemaSnapshots: ["claude-marketplace-schema"] },
        status: "native",
      },
      codex: {
        evidence: [docs("docs/features/marketplaces.md"), providerSnapshot("codex-plugin")],
        provider: { destinationFormat: "codex-plugin" },
        reason: "Codex plugin bundles are renderable, but Codex marketplace activation is currently a runtime config surface rather than a provider-owned generated index.",
        status: "future",
      },
      cursor: {
        evidence: [docs("docs/features/marketplaces.md"), providerSnapshot("cursor-plugin")],
        provider: { destinationFormat: "cursor-plugin" },
        status: "native",
      },
    },
    title: "Marketplaces",
    validationOwner: "packages/core/src/config.ts",
  }),
  feature({
    docs: ["docs/features/feature-registry.md"],
    evidence: [
      docs("docs/adrs/drafts/20260604-feature-reference-and-schema-registry.md"),
      source("packages/core/src/feature-registry.ts"),
      test("packages/core/src/__tests__/feature-registry.test.ts", "registry ids, vocabulary, evidence, and guard coverage"),
      test("apps/skillset/src/__tests__/lint-rules.test.ts", "SET-76 lint diagnostics carry feature ids"),
      test("packages/core/src/__tests__/build-result.test.ts", "SET-76 output-safety diagnostics carry feature ids"),
    ],
    id: "feature-registry",
    kind: "workflow",
    renderOwner: "packages/core/src/feature-registry.ts",
    sourceShape: "typed feature entries in packages/core/src/feature-registry.ts",
    status: "implemented",
    summary: "Records feature ids, target capability claims, docs, evidence, render owners, and validation owners.",
    targetSupport: notTargetRuntime(),
    title: "Feature Registry",
    validationOwner: "packages/core/src/feature-registry.ts",
  }),
  feature({
    docs: ["docs/features/render-results.md"],
    evidence: [
      docs("docs/adrs/drafts/20260614-lowering-outcomes-and-loss-ledger.md"),
      source("packages/core/src/render-result.ts"),
      source("packages/core/src/render-result-collector.ts"),
      source("apps/skillset/src/import.ts"),
      source("apps/skillset/src/setup.ts"),
      test("packages/core/src/__tests__/render-result.test.ts", "render result schema validation coverage"),
      test("packages/core/src/__tests__/render-result-build.test.ts", "build render results cover rendered, target-native, transformed, unsupported, policy-gated, scoped, and status-matrix results"),
      test("apps/skillset/src/__tests__/contract.test.ts", "SET-86 import and build warnings carry render result codes"),
      test("apps/skillset/src/__tests__/adopt.test.ts", "SET-86 adopt survey skips carry render result codes"),
    ],
    id: "render-results",
    kind: "workflow",
    renderOwner: "packages/core/src/render-result-collector.ts",
    sourceShape: "rendered build graph, generated lock items, companion files, unsupported feature records, and render-relevant import/adopt report warnings",
    status: "implemented",
    summary: "Records per-build render facts for rendered, transformed, degraded, skipped, unsupported, and externally managed source units.",
    targetSupport: notTargetRuntime(),
    title: "Render Results",
    validationOwner: "packages/core/src/render-result.ts",
  }),
  feature({
    docs: ["docs/features/output-safety.md"],
    evidence: [
      source("packages/core/src/output-safety.ts"),
      test("packages/core/src/__tests__/build-result.test.ts", "SET-19 output backup and restore coverage"),
      test("apps/skillset/src/__tests__/contract.test.ts", "SET-19 restore CLI coverage"),
    ],
    id: "output-safety",
    kind: "workflow",
    renderOwner: "packages/core/src/output-safety.ts",
    sourceShape: "generated skillset.lock ownership plus current rendered output paths",
    status: "implemented",
    summary: "Protects unmanaged generated-output collisions and target-side edits with reversible backups.",
    targetSupport: notTargetRuntime(),
    title: "Output Safety",
    validationOwner: "packages/core/src/output-safety.ts",
  }),
  feature({
    docs: ["docs/features/feature-source-pointers.md", "docs/features/mcp-servers.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-26 MCP pointer coverage")],
    id: "plugin-mcp",
    kind: "plugin-component",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "plugin mcp/source pointer or conventional .mcp.json",
    status: "implemented",
    summary: "Copies validated plugin MCP server definitions into generated provider plugin outputs.",
    targetSupport: bothTargetsWithTargetEvidence("native", [
      docs("docs/features/mcp-servers.md"),
    ], {
      claude: [providerSnapshot("claude-plugin")],
      codex: [providerSnapshot("codex-plugin")],
      cursor: [providerSnapshot("cursor-plugin")],
    }, {
      claude: { destinationFormat: "claude-plugin" },
      codex: { destinationFormat: "codex-plugin" },
      cursor: { destinationFormat: "cursor-plugin" },
    }),
    title: "Plugin MCP Servers",
    validationOwner: "packages/core/src/resources.ts",
  }),
  feature({
    docs: ["docs/features/apps.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "Codex app manifest companion-path coverage")],
    id: "plugin-apps",
    kind: "target-native",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "plugin codex/.app.json target-native companion file",
    status: "implemented",
    summary: "Passes Codex app manifests through as target-native plugin companion files.",
    targetSupport: {
      claude: { evidence: [docs("docs/features/apps.md")], status: "not_applicable" },
      codex: {
        evidence: [docs("docs/features/apps.md"), providerSnapshot("codex-plugin")],
        provider: { destinationFormat: "codex-plugin" },
        status: "pass_through",
      },
    },
    title: "Codex Plugin Apps",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  pluginCompanionFeature({
    id: "plugin-assets",
    sourceShape: "plugin assets/",
    summary: "Copies plugin asset companions into generated provider plugin outputs.",
    targetSupport: bothTargets("pass_through", [docs("docs/features/plugins.md")]),
    title: "Plugin Assets",
  }),
  feature({
    docs: ["docs/features/executables.md", "docs/features/feature-source-pointers.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-26 bin pointer coverage")],
    id: "plugin-bin",
    kind: "plugin-component",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "plugin bin/source pointer or conventional bin/",
    status: "implemented",
    summary: "Copies Claude plugin-root executable helpers while failing loudly for Codex-enabled plugin output.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/executables.md"), providerSnapshot("claude-plugin")],
        provider: { destinationFormat: "claude-plugin" },
        status: "pass_through",
      },
      codex: {
        evidence: [docs("docs/features/executables.md"), providerSnapshot("codex-plugin")],
        provider: { destinationFormat: "codex-plugin", unsupportedDestinations: ["bin"] },
        reason: "Codex plugins do not expose a documented plugin-local bin contract.",
        status: "unsupported",
      },
      cursor: {
        evidence: [docs("docs/features/executables.md"), providerSnapshot("cursor-plugin")],
        provider: { destinationFormat: "cursor-plugin", unsupportedDestinations: ["bin"] },
        reason: "Cursor plugins do not expose a documented plugin-local bin contract.",
        status: "unsupported",
      },
    },
    title: "Plugin Bin",
    validationOwner: "packages/core/src/resources.ts",
  }),
  pluginCompanionFeature({
    docs: ["docs/features/commands.md", "docs/features/plugins.md"],
    id: "plugin-commands",
    sourceShape: "plugin commands/",
    summary: "Passes Claude plugin command companions through to Claude plugin outputs.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/commands.md"), providerSnapshot("claude-plugin")],
        provider: { destinationFormat: "claude-plugin" },
        status: "pass_through",
      },
      codex: { evidence: [docs("docs/features/commands.md")], status: "not_applicable" },
      cursor: {
        evidence: [docs("docs/features/commands.md"), providerSnapshot("cursor-plugin")],
        provider: { destinationFormat: "cursor-plugin" },
        status: "pass_through",
      },
    },
    title: "Plugin Commands",
  }),
  pluginCompanionFeature({
    docs: ["docs/features/instructions.md", "docs/features/plugins.md"],
    id: "plugin-rules",
    sourceShape: "plugin rules/",
    summary: "Passes Cursor plugin rule companions through to Cursor plugin outputs.",
    targetSupport: {
      claude: { evidence: [docs("docs/features/instructions.md")], status: "not_applicable" },
      codex: { evidence: [docs("docs/features/instructions.md")], status: "not_applicable" },
      cursor: {
        evidence: [docs("docs/features/instructions.md"), providerSnapshot("cursor-plugin"), providerSnapshot("cursor-rules")],
        provider: { destinationFormat: "cursor-plugin" },
        status: "pass_through",
      },
    },
    title: "Plugin Rules",
  }),
  feature({
    docs: ["docs/features/hooks.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-2 hook companion-path coverage")],
    id: "plugin-hooks",
    kind: "target-native",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "plugin hooks/hooks.json",
    status: "implemented",
    summary: "Copies plugin hook declarations with registry-backed provider event and handler validation.",
    targetSupport: bothTargetsWithTargetEvidence("pass_through", [
      docs("docs/features/hooks.md"),
    ], {
      claude: [providerSnapshot("claude-hooks")],
      codex: [providerSnapshot("codex-plugin")],
      cursor: [providerSnapshot("cursor-hooks"), providerSnapshot("cursor-plugin")],
    }, {
      claude: { destinationFormat: "claude-hooks" },
      codex: { destinationFormat: "codex-plugin", schemaSnapshots: ["codex-hooks-schema", "codex-hook-event-schemas"] },
      cursor: { destinationFormat: "cursor-hooks" },
    }),
    title: "Plugin Hooks",
    validationOwner: "packages/core/src/hooks.ts",
  }),
  feature({
    docs: ["docs/features/hooks.md"],
    evidence: [
      docs("docs/features/hooks.md"),
      source("packages/core/src/hook-capabilities.ts"),
      source("packages/schema/src/contracts.ts"),
      test("packages/core/src/__tests__/adaptive-hook-attachments.test.ts", "SET-118 attachment resolution and SET-127 script source proof coverage"),
      test("packages/core/src/__tests__/render-result-build.test.ts", "adaptive hook unsupported destination result coverage"),
      test("packages/core/src/__tests__/hook-capabilities.test.ts", "SET-117 provider capability and adaptive unit path coverage"),
      test("packages/schema/src/__tests__/schema.test.ts", "SET-117 adaptive hook source contract coverage"),
    ],
    id: "adaptive-hooks",
    kind: "source",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "hooks/<name>.json or hooks/<name>/hook.json adaptive hook units",
    status: "implemented",
    summary: "Defines reusable adaptive hook units and renders supported plugin and Claude frontmatter hook destinations with explicit unsupported-destination results.",
    targetSupport: {
      claude: {
        evidence: [
          docs("docs/features/hooks.md"),
          providerSnapshot("claude-hooks"),
          source("packages/core/src/hook-capabilities.ts"),
        ],
        provider: { destinationFormat: "claude-hooks" },
        status: "transformed",
      },
      codex: {
        evidence: [
          docs("docs/features/hooks.md"),
          providerSnapshot("codex-plugin"),
          providerSchemaSnapshot("codex-hooks-schema"),
          providerSchemaSnapshot("codex-hook-event-schemas"),
          source("packages/core/src/hook-capabilities.ts"),
        ],
        reason: "Codex supports plugin-level command hooks, but has no faithful skill-local or project-agent hook destination and narrower event/matcher support.",
        provider: { destinationFormat: "codex-plugin", schemaSnapshots: ["codex-hooks-schema", "codex-hook-event-schemas"] },
        status: "degraded",
      },
      cursor: {
        evidence: [
          docs("docs/features/hooks.md"),
          providerSnapshot("cursor-hooks"),
          providerSnapshot("cursor-plugin"),
          source("packages/core/src/hook-capabilities.ts"),
        ],
        reason: "Cursor supports plugin-level command hooks, but has no faithful skill-local or project-agent hook destination and uses provider-native lower-camel event names.",
        provider: { destinationFormat: "cursor-hooks" },
        status: "degraded",
      },
    },
    title: "Adaptive Hooks",
    validationOwner: "packages/schema/src/validate.ts",
  }),
  pluginCompanionFeature({
    docs: ["docs/features/lsp-servers.md", "docs/features/plugins.md"],
    id: "plugin-lsp-servers",
    sourceShape: "plugin .lsp.json",
    summary: "Passes Claude plugin LSP server companions through to Claude plugin outputs.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/lsp-servers.md"), providerSnapshot("claude-plugin")],
        provider: { destinationFormat: "claude-plugin" },
        status: "pass_through",
      },
      codex: { evidence: [docs("docs/features/lsp-servers.md")], status: "not_applicable" },
    },
    title: "Plugin LSP Servers",
  }),
  feature({
    docs: ["docs/features/plugins.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "plugin boundary and manifest coverage")],
    id: "plugin-manifests",
    kind: "source",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/plugins/<plugin>/skillset.yaml",
    status: "implemented",
    summary: "Projects plugin metadata and component wiring into target-native plugin manifests.",
    targetSupport: bothTargetsWithTargetEvidence("native", [
      docs("docs/features/plugins.md"),
    ], {
      claude: [providerSnapshot("claude-plugin")],
      codex: [providerSnapshot("codex-plugin")],
      cursor: [providerSnapshot("cursor-plugin")],
    }, {
      claude: { destinationFormat: "claude-plugin", schemaSnapshots: ["claude-plugin-manifest-schema"] },
      codex: { destinationFormat: "codex-plugin", manualOverlays: ["codex-plugin-manifest-overlay"] },
      cursor: { destinationFormat: "cursor-plugin" },
    }),
    title: "Plugin Manifests",
    validationOwner: "packages/core/src/config.ts",
  }),
  pluginCompanionFeature({
    docs: ["docs/features/monitors.md", "docs/features/plugins.md"],
    id: "plugin-monitors",
    sourceShape: "plugin monitors/",
    summary: "Passes Claude plugin monitor companions through to Claude plugin outputs.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/monitors.md"), providerSnapshot("claude-plugin")],
        provider: { destinationFormat: "claude-plugin" },
        status: "pass_through",
      },
      codex: { evidence: [docs("docs/features/monitors.md")], status: "not_applicable" },
    },
    title: "Plugin Monitors",
  }),
  pluginCompanionFeature({
    docs: ["docs/features/output-styles.md", "docs/features/plugins.md"],
    id: "plugin-output-styles",
    sourceShape: "plugin output-styles/",
    summary: "Passes Claude plugin output-style companions through to Claude plugin outputs.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/output-styles.md"), providerSnapshot("claude-plugin")],
        provider: { destinationFormat: "claude-plugin" },
        status: "pass_through",
      },
      codex: { evidence: [docs("docs/features/output-styles.md")], status: "not_applicable" },
    },
    title: "Plugin Output Styles",
  }),
  pluginCompanionFeature({
    id: "plugin-readme",
    sourceShape: "plugin README.md",
    summary: "Copies plugin README companions into generated provider plugin outputs.",
    targetSupport: bothTargets("pass_through", [docs("docs/features/plugins.md")]),
    title: "Plugin README",
  }),
  pluginCompanionFeature({
    id: "plugin-scripts",
    sourceShape: "plugin scripts/",
    summary: "Copies plugin script companions into generated provider plugin outputs.",
    targetSupport: bothTargets("pass_through", [docs("docs/features/plugins.md")]),
    title: "Plugin Scripts",
  }),
  feature({
    docs: ["docs/features/plugins.md", "docs/features/skills.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "plugin skill rendering coverage")],
    id: "plugin-skills",
    kind: "source",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/plugins/<plugin>/skills/<skill>/SKILL.md",
    status: "implemented",
    summary: "Preserves plugin-scoped skills inside each target plugin boundary.",
    targetSupport: bothTargetsWithTargetEvidence("native", [
      docs("docs/features/skills.md"),
    ], {
      claude: [providerSnapshot("claude-skill")],
      codex: [providerSnapshot("codex-skill")],
      cursor: [providerSnapshot("cursor-skill")],
    }, {
      claude: { destinationFormat: "claude-skill", manualOverlays: ["claude-skill-frontmatter-overlay"] },
      codex: { destinationFormat: "codex-skill", schemaSnapshots: ["codex-skill-metadata-schema"] },
      cursor: { destinationFormat: "cursor-skill" },
    }),
    title: "Plugin Skills",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  pluginCompanionFeature({
    id: "plugin-src",
    sourceShape: "plugin src/",
    summary: "Copies plugin source companions into generated provider plugin outputs.",
    targetSupport: bothTargets("pass_through", [docs("docs/features/plugins.md")]),
    title: "Plugin Source",
  }),
  pluginCompanionFeature({
    docs: ["docs/features/themes.md", "docs/features/plugins.md"],
    id: "plugin-themes",
    sourceShape: "plugin themes/",
    summary: "Passes Claude plugin theme companions through to Claude plugin outputs.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/themes.md"), providerSnapshot("claude-plugin")],
        provider: { destinationFormat: "claude-plugin" },
        status: "pass_through",
      },
      codex: { evidence: [docs("docs/features/themes.md")], status: "not_applicable" },
    },
    title: "Plugin Themes",
  }),
  feature({
    docs: ["docs/features/agents.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "Codex plugin-agent failure coverage")],
    id: "plugin-agents",
    kind: "target-native",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "plugin target-native agents/",
    status: "implemented",
    summary: "Allows Claude plugin agents as target-native companion files and rejects Codex plugin agents.",
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/agents.md"), providerSnapshot("claude-subagent")],
        provider: { destinationFormat: "claude-subagent", manualOverlays: ["claude-subagent-frontmatter-overlay"] },
        status: "pass_through",
      },
      codex: {
        evidence: [docs("docs/features/agents.md"), providerSnapshot("codex-plugin")],
        provider: { destinationFormat: "codex-plugin", unsupportedDestinations: ["agents"] },
        reason: "Codex plugin documentation does not include a plugin agents component.",
        status: "unsupported",
      },
      cursor: {
        evidence: [docs("docs/features/agents.md"), providerSnapshot("cursor-agent"), providerSnapshot("cursor-plugin")],
        provider: { destinationFormat: "cursor-agent" },
        status: "pass_through",
      },
    },
    title: "Plugin Agents",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/instructions.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-5 instruction rendering coverage")],
    id: "project-instructions",
    kind: "source",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/rules/**/*.md",
    status: "implemented",
    summary: "Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.",
    targetSupport: {
      claude: { evidence: [docs("docs/features/instructions.md")], status: "transformed" },
      codex: {
        evidence: [docs("docs/features/instructions.md"), providerSnapshot("codex-agents-md")],
        provider: { destinationFormat: "codex-agents-md", manualOverlays: ["codex-agents-md-overlay"] },
        status: "transformed",
      },
      cursor: {
        evidence: [docs("docs/features/instructions.md"), providerSnapshot("cursor-rules")],
        provider: { destinationFormat: "cursor-rules" },
        status: "transformed",
      },
    },
    title: "Project Instructions",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/agents.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "portable project agent coverage")],
    id: "project-agents",
    kind: "source",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/agents/*.md",
    status: "implemented",
    summary: "Renders portable project agents to Claude Markdown agents and Codex TOML agents.",
    runtimeSupport: {
      "claude-code": {
        evidence: [docs("docs/features/agents.md"), providerSnapshot("claude-subagent")],
        mechanism: "Claude Code reads project-scoped Markdown subagents from .claude/agents.",
        status: "native",
      },
      "codex-cli": {
        caveats: [
          "Codex receives skill-loading intent as developer instructions; it is not target-enforced skill metadata.",
        ],
        evidence: [docs("docs/features/agents.md"), providerSnapshot("codex-subagent")],
        mechanism: "Skillset renders Codex TOML agents and inserts a deterministic skill-loading preface when source agents declare skills.",
        status: "shimmed",
      },
    },
    targetSupport: {
      claude: {
        evidence: [docs("docs/features/agents.md"), providerSnapshot("claude-subagent")],
        provider: { destinationFormat: "claude-subagent", manualOverlays: ["claude-subagent-frontmatter-overlay"] },
        status: "native",
      },
      codex: {
        evidence: [docs("docs/features/agents.md"), providerSnapshot("codex-subagent")],
        provider: { destinationFormat: "codex-subagent", manualOverlays: ["codex-subagent-toml-overlay"] },
        status: "transformed",
      },
      cursor: {
        evidence: [docs("docs/features/agents.md"), providerSnapshot("cursor-agent")],
        provider: { destinationFormat: "cursor-agent" },
        status: "native",
      },
    },
    title: "Project Agents",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/runtime-adapters.md"],
    evidence: [docs("docs/features/runtime-adapters.md"), test("packages/core/src/__tests__/feature-registry.test.ts", "SET-113 runtime support coverage")],
    id: "runtime-adapters",
    kind: "workflow",
    renderOwner: "packages/core/src/feature-registry.ts",
    runtimeSupport: {
      "claude-code": {
        evidence: [docs("docs/features/runtime-adapters.md")],
        mechanism: "Current Claude build target projections feed Claude Code plugin, project, and skill surfaces.",
        status: "native",
      },
      "codex-cli": {
        evidence: [docs("docs/features/runtime-adapters.md")],
        mechanism: "Current Codex build target projections feed Codex CLI plugin, project, and skill surfaces.",
        status: "native",
      },
      "codex-app": {
        evidence: [docs("docs/features/runtime-adapters.md")],
        mechanism: "Codex plugin manifests can carry app companions, but app/runtime activation remains outside build.",
        status: "externally_managed",
      },
      cursor: {
        evidence: [
          docs("docs/features/runtime-adapters.md"),
          docs("docs/target-surfaces.md#cursor-provider-baseline"),
          docs("docs/adrs/drafts/20260702-cursor-is-a-first-class-provider.md"),
          fixture("fixtures/external/repos.yaml"),
        ],
        mechanism: "Current Cursor build target projections feed Cursor plugin, project rule, project agent, hook, MCP, and skill surfaces.",
        status: "native",
      },
      "gemini-cli": {
        evidence: [docs("docs/features/runtime-adapters.md"), fixture("fixtures/external/repos.yaml")],
        reason: "Gemini support needs target documentation and adapter evidence before Skillset can lower or distribute it.",
        status: "planned",
      },
      devin: {
        evidence: [docs("docs/features/runtime-adapters.md")],
        reason: "Devin support is tracked as future runtime compatibility, not an implemented target.",
        status: "future",
      },
      droid: {
        evidence: [docs("docs/features/runtime-adapters.md")],
        reason: "Droid support is tracked as future runtime compatibility, not an implemented target.",
        status: "future",
      },
      opencode: {
        evidence: [docs("docs/features/runtime-adapters.md"), fixture("fixtures/external/repos.yaml")],
        reason: "OpenCode support needs target documentation and adapter evidence before Skillset can lower or distribute it.",
        status: "planned",
      },
    },
    sourceShape: "feature registry runtimeSupport records",
    status: "planned",
    summary: "Tracks runtime, distribution, and harness compatibility separately from compile targets.",
    targetSupport: notTargetRuntime(),
    title: "Runtime Adapters",
    validationOwner: "packages/core/src/feature-registry.ts",
  }),
  feature({
    docs: ["docs/features/hooks.md", "docs/features/hook-guardrails.md"],
    evidence: [
      docs("docs/features/hooks.md"),
      source("packages/toolkit/src/runtime.ts"),
      source("packages/toolkit/src/cli.ts"),
      source("packages/core/src/render.ts"),
      test("packages/toolkit/src/__tests__/runtime.test.ts", "runtime context normalization coverage"),
      test("packages/toolkit/src/__tests__/cli.test.ts", "shell-friendly runtime context CLI coverage"),
      test("packages/core/src/__tests__/adaptive-hook-attachments.test.ts", "generated toolkit hook wrapper coverage"),
    ],
    id: "runtime-context",
    kind: "workflow",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "adaptive hook context.strategy toolkit runtime context helper",
    status: "implemented",
    summary: "Normalizes provider hook runtime context into Skillset fields for hook scripts through a typed API and shell-friendly CLI.",
    targetSupport: {
      claude: {
        evidence: [
          docs("docs/features/hooks.md"),
          source("packages/toolkit/src/runtime.ts"),
          test("packages/toolkit/src/__tests__/runtime.test.ts", "Claude-like environment normalization"),
        ],
        note: "Normalized fields are provider, hook.event, and session.id; raw Claude environment remains available to the hook command.",
        status: "transformed",
      },
      codex: {
        evidence: [
          docs("docs/features/hooks.md"),
          source("packages/toolkit/src/runtime.ts"),
          test("packages/toolkit/src/__tests__/runtime.test.ts", "Codex-like environment normalization"),
        ],
        note: "Normalized fields are provider, hook.event, and session.id; raw Codex environment remains available to the hook command.",
        status: "transformed",
      },
      cursor: {
        evidence: [
          docs("docs/features/hooks.md"),
          source("packages/toolkit/src/runtime.ts"),
        ],
        note: "Normalized fields are provider, hook.event, and session.id; raw Cursor environment remains available to the hook command.",
        status: "transformed",
      },
    },
    title: "Runtime Context",
    validationOwner: "packages/toolkit/src/runtime.ts",
  }),
  feature({
    docs: ["docs/features/releases.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-38 release apply coverage")],
    id: "releases",
    kind: "change-management",
    renderOwner: "apps/skillset/src/release.ts",
    sourceShape: "workspace changes/releases.jsonl, changes/state.json, generated changelogs",
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
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "skill resources frontmatter and .skillset/shared/",
    status: "implemented",
    summary: "Copies declared skill resources and validates links to shared resource declarations.",
    targetSupport: bothTargetsWithTargetEvidence("native", [
      docs("docs/features/resources.md"),
    ], {
      claude: [providerSnapshot("claude-skill")],
      codex: [providerSnapshot("codex-skill")],
      cursor: [providerSnapshot("cursor-skill")],
    }, {
      claude: { destinationFormat: "claude-skill", manualOverlays: ["claude-skill-frontmatter-overlay"] },
      codex: { destinationFormat: "codex-skill" },
      cursor: { destinationFormat: "cursor-skill" },
    }),
    title: "Resources",
    validationOwner: "packages/core/src/resources.ts",
  }),
  feature({
    docs: ["docs/features/skills.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "standalone skill rendering coverage")],
    id: "standalone-skills",
    kind: "source",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/skills/<skill>/SKILL.md",
    status: "implemented",
    summary: "Projects standalone repo skills into configured target skill roots.",
    targetSupport: bothTargetsWithTargetEvidence("native", [
      docs("docs/features/skills.md"),
    ], {
      claude: [providerSnapshot("claude-skill")],
      codex: [providerSnapshot("codex-skill")],
      cursor: [providerSnapshot("cursor-skill")],
    }, {
      claude: { destinationFormat: "claude-skill", manualOverlays: ["claude-skill-frontmatter-overlay"] },
      codex: { destinationFormat: "codex-skill", schemaSnapshots: ["codex-skill-metadata-schema"] },
      cursor: { destinationFormat: "cursor-skill" },
    }),
    title: "Standalone Skills",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/supports.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-39 supports coverage")],
    id: "supports",
    kind: "metadata",
    renderOwner: "apps/skillset/src/change-status.ts",
    sourceShape: "supports frontmatter metadata",
    status: "implemented",
    summary: "Records compatibility claims as source-significant metadata without target-frontmatter leakage.",
    targetSupport: bothTargets("metadata_only"),
    title: "Supports",
    validationOwner: "packages/core/src/supports.ts",
  }),
  feature({
    docs: ["docs/features/target-native-islands.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "provider source coverage")],
    id: "target-native-islands",
    kind: "target-native",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: ".skillset/_claude/**, .skillset/_codex/**, .skillset/_cursor/**, and plugin-local provider source subdirs",
    status: "implemented",
    summary: "Mirrors explicit provider-specific files only to their intended provider output.",
    targetSupport: bothTargets("pass_through"),
    title: "Provider Source",
    validationOwner: "packages/core/src/resolver.ts",
  }),
  feature({
    docs: ["docs/features/tools-policy.md"],
    evidence: [test("apps/skillset/src/__tests__/skillset.test.ts", "tool policy rendering coverage")],
    id: "tools-policy",
    kind: "source",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: "skill tools frontmatter",
    status: "implemented",
    summary: "Normalizes portable tools policy into Claude tool rules and provider metadata where no proven skill-local enforcement surface exists.",
    targetSupport: {
      claude: { status: "transformed" },
      codex: { status: "metadata_only" },
      cursor: { status: "metadata_only" },
    },
    title: "Tools Policy",
    validationOwner: "packages/core/src/skill-policy.ts",
  }),
  feature({
    docs: ["docs/features/apps.md", "docs/features/hooks.md", "docs/features/commands.md", "docs/features/settings.md"],
    evidence: [docs("docs/target-surfaces.md")],
    id: "future-companion-source-pointers",
    kind: "plugin-component",
    renderOwner: "future",
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
    docs: ["docs/features/version-audit.md"],
    evidence: [test("apps/skillset/src/__tests__/contract.test.ts", "SET-111 release audit coverage")],
    id: "version-audit",
    kind: "change-management",
    renderOwner: "packages/core/src/version-audit.ts",
    sourceShape: "release state and generated version loci",
    status: "implemented",
    summary: "Audits generated version fields against source and release-state authorities without writing.",
    targetSupport: notTargetRuntime(),
    title: "Version Audit",
    validationOwner: "packages/core/src/version-audit.ts",
  }),
  feature({
    docs: ["docs/features/ci.md", "docs/features/build-scopes.md", "docs/features/workbench.md"],
    evidence: [
      test("apps/skillset/src/__tests__/ci.test.ts", "CI and build-scope coverage"),
      test("apps/skillset/src/__tests__/contract.test.ts", "CLI check/verify command coverage"),
      test("packages/workbench/src/__tests__/presets.test.ts", "Workbench presets"),
      test("packages/workbench/src/__tests__/lint-bridge.test.ts", "Workbench lint bridge"),
      test("packages/workbench/src/__tests__/parser.test.ts", "Workbench parser diagnostics"),
      test("packages/workbench/src/__tests__/schema.test.ts", "Workbench source contract diagnostics"),
      test("packages/workbench/src/__tests__/compatibility.test.ts", "Workbench provider compatibility diagnostics"),
      test("packages/workbench/src/__tests__/resource-runtime.test.ts", "Workbench resource and runtime diagnostics"),
      test("packages/workbench/src/__tests__/fixtures.test.ts", "Workbench clean and invalid fixtures"),
      test("packages/workbench/src/__tests__/ast-grep.test.ts", "Workbench ast-grep adapter proof"),
      test("packages/workbench/src/__tests__/markdown.test.ts", "Workbench Markdown diagnostics"),
    ],
    id: "workflows",
    kind: "workflow",
    renderOwner: "apps/skillset/src/cli-core.ts",
    sourceShape: "skillset CLI workflows such as build, check, ci, test, init, and create",
    status: "implemented",
    summary: "Provides repo-local workflow commands without rendering them into target runtime artifacts.",
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
  assertRuntimeSupportVocabulary(entries);
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

export function listSkillsetFeaturesByRuntime(
  runtime: SkillsetRuntimeId,
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): SkillsetFeatureRegistry {
  return registry.filter((entry) => entry.runtimeSupport?.[runtime] !== undefined);
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
    for (const target of targetNames()) {
      const support = entry.targetSupport[target];
      if (!targetStatuses.has(support.status)) {
        throw new Error(
          `skillset: unknown target support status ${support.status} for ${entry.id} ${target}`
        );
      }
      if (support.evidence === undefined || support.evidence.length === 0) {
        throw new Error(`skillset: ${entry.id} ${target} support requires evidence`);
      }
      for (const evidence of support.evidence) {
        if (evidence.kind === "external-docs" && evidence.verifiedAt === undefined) {
          throw new Error(`skillset: ${entry.id} ${target} external docs evidence requires verifiedAt`);
        }
      }
      if (
        (support.status === "degraded" || support.status === "lossy" || support.status === "unsupported") &&
        support.reason === undefined
      ) {
        throw new Error(`skillset: ${entry.id} ${target} ${support.status} support requires a reason`);
      }
    }
  }
}

function assertRuntimeSupportVocabulary(entries: readonly SkillsetFeatureEntry[]): void {
  const runtimeIds = new Set<string>(SKILLSET_RUNTIME_IDS);
  const runtimeStatuses = new Set<string>(RUNTIME_SUPPORT_STATUS_VALUES);
  for (const entry of entries) {
    for (const [runtime, support] of Object.entries(entry.runtimeSupport ?? {})) {
      if (!runtimeIds.has(runtime)) {
        throw new Error(`skillset: unknown runtime support id ${runtime} for ${entry.id}`);
      }
      if (!runtimeStatuses.has(support.status)) {
        throw new Error(`skillset: unknown runtime support status ${support.status} for ${entry.id} ${runtime}`);
      }
      if (support.evidence === undefined || support.evidence.length === 0) {
        throw new Error(`skillset: ${entry.id} ${runtime} runtime support requires evidence`);
      }
      for (const evidence of support.evidence) {
        if (evidence.kind === "external-docs" && evidence.verifiedAt === undefined) {
          throw new Error(`skillset: ${entry.id} ${runtime} external docs evidence requires verifiedAt`);
        }
      }
      if (
        (support.status === "degraded" || support.status === "lossy" || support.status === "unsupported") &&
        support.reason === undefined
      ) {
        throw new Error(`skillset: ${entry.id} ${runtime} ${support.status} runtime support requires a reason`);
      }
      if (support.status === "shimmed" && support.mechanism === undefined) {
        throw new Error(`skillset: ${entry.id} ${runtime} shimmed runtime support requires a mechanism`);
      }
    }
  }
}

function feature(entry: SkillsetFeatureEntryInput): SkillsetFeatureEntry {
  return {
    ...entry,
    targetSupport: targetRecord((target) =>
      withDefaultEvidence(
        entry.id,
        target,
        entry.targetSupport[target] ?? plannedProviderSupport(target),
        entry.evidence
      )
    ),
  };
}

function pluginCompanionFeature(entry: {
  readonly docs?: readonly string[];
  readonly id: string;
  readonly sourceShape: string;
  readonly summary: string;
  readonly targetSupport: FeatureTargetSupportInput;
  readonly title: string;
}): SkillsetFeatureEntry {
  return feature({
    docs: entry.docs ?? ["docs/features/plugins.md"],
    evidence: [source("packages/core/src/render.ts")],
    id: entry.id,
    kind: "target-native",
    renderOwner: "packages/core/src/render.ts",
    sourceShape: entry.sourceShape,
    status: "implemented",
    summary: entry.summary,
    targetSupport: entry.targetSupport,
    title: entry.title,
    validationOwner: "packages/core/src/resolver.ts",
  });
}

function withDefaultEvidence(
  featureId: string,
  target: TargetName,
  support: SkillsetTargetSupport,
  fallbackEvidence: readonly SkillsetFeatureEvidence[]
): SkillsetTargetSupport {
  const supportEvidence = support.evidence ?? [];
  const providerEvidence = providerEvidenceForSupport(featureId, target, support);
  const evidence = uniqueEvidence([
    ...(supportEvidence.length > 0 ? supportEvidence : fallbackEvidence),
    ...providerEvidence,
  ]);
  if (evidence.length === 0) return support;
  return { ...support, evidence };
}

function bothTargets(
  status: SkillsetTargetSupportStatus,
  evidence?: readonly SkillsetFeatureEvidence[]
): FeatureTargetSupportInput {
  const support = { ...(evidence === undefined ? {} : { evidence }), status };
  return {
    claude: support,
    codex: support,
  };
}

function bothTargetsWithTargetEvidence(
  status: SkillsetTargetSupportStatus,
  commonEvidence: readonly SkillsetFeatureEvidence[],
  targetEvidence: Partial<Readonly<Record<TargetName, readonly SkillsetFeatureEvidence[]>>>,
  targetProvider?: Partial<Readonly<Record<TargetName, SkillsetProviderSupportEvidence>>>
): FeatureTargetSupportInput {
  const supports: Partial<Record<TargetName, SkillsetTargetSupport>> = {};
  for (const target of targetNames()) {
    if (target !== "claude" && target !== "codex" && targetEvidence[target] === undefined && targetProvider?.[target] === undefined) {
      continue;
    }
    supports[target] = {
      evidence: [...commonEvidence, ...(targetEvidence[target] ?? [])],
      ...(targetProvider?.[target] === undefined ? {} : { provider: targetProvider[target] }),
      status,
    };
  }
  return supports as FeatureTargetSupportInput;
}

function notTargetRuntime(): FeatureTargetSupportInput {
  return bothTargets("not_applicable");
}

function plannedProviderSupport(target: TargetName): SkillsetTargetSupport {
  return {
    evidence: target === "cursor" ? CURSOR_PROVIDER_EVIDENCE : [],
    reason: `${target} provider support is not registered for this feature yet.`,
    status: "planned",
  };
}

function docs(ref: string): SkillsetFeatureEvidence {
  return { kind: "docs", ref };
}

function providerSnapshot(ref: ProviderDestinationFormatSnapshotId): SkillsetFeatureEvidence {
  const snapshot = getProviderDestinationFormatSnapshot(ref);
  if (snapshot === undefined) {
    throw new Error(`skillset: provider destination format snapshot ${ref} does not exist`);
  }
  return {
    kind: "provider-snapshot",
    note: snapshot.provenance.contentHash,
    ref,
    verifiedAt: snapshot.provenance.fetchedAt.slice(0, 10),
  };
}

function providerSchemaSnapshot(ref: ProviderSchemaSnapshotId): SkillsetFeatureEvidence {
  const snapshot = getProviderSchemaSnapshot(ref);
  if (snapshot === undefined) {
    throw new Error(`skillset: provider schema snapshot ${ref} does not exist`);
  }
  return {
    kind: "provider-schema",
    note: snapshot.provenance.contentHash,
    ref,
    verifiedAt: snapshot.provenance.fetchedAt.slice(0, 10),
  };
}

function providerOverlay(ref: ProviderSchemaManualOverlayId): SkillsetFeatureEvidence {
  const overlay = providerSchemaManualOverlays.find((candidate) => candidate.id === ref);
  if (overlay === undefined) {
    throw new Error(`skillset: provider schema manual overlay ${ref} does not exist`);
  }
  return {
    kind: "provider-overlay",
    note: overlay.note,
    ref,
  };
}

function providerEvidenceForSupport(
  featureId: string,
  target: TargetName,
  support: SkillsetTargetSupport
): readonly SkillsetFeatureEvidence[] {
  const provider = support.provider;
  if (provider === undefined) return [];

  const evidence: SkillsetFeatureEvidence[] = [];
  if (provider.destinationFormat !== undefined) {
    const snapshot = getProviderDestinationFormatSnapshot(provider.destinationFormat);
    if (snapshot === undefined) {
      throw new Error(`skillset: provider destination format snapshot ${provider.destinationFormat} does not exist`);
    }
    if (snapshot.target !== target) {
      throw new Error(`skillset: ${featureId} ${target} provider destination format ${provider.destinationFormat} targets ${snapshot.target}`);
    }
    evidence.push(providerSnapshot(provider.destinationFormat));
  }

  for (const schemaId of provider.schemaSnapshots ?? []) {
    const snapshot = getProviderSchemaSnapshot(schemaId);
    if (snapshot === undefined) {
      throw new Error(`skillset: provider schema snapshot ${schemaId} does not exist`);
    }
    if (snapshot.target !== target) {
      throw new Error(`skillset: ${featureId} ${target} provider schema ${schemaId} targets ${snapshot.target}`);
    }
    evidence.push(providerSchemaSnapshot(schemaId));
  }

  for (const overlayId of provider.manualOverlays ?? []) {
    const overlay = providerSchemaManualOverlays.find((candidate) => candidate.id === overlayId);
    if (overlay === undefined) {
      throw new Error(`skillset: provider schema manual overlay ${overlayId} does not exist`);
    }
    if (overlay.target !== target) {
      throw new Error(`skillset: ${featureId} ${target} provider overlay ${overlayId} targets ${overlay.target}`);
    }
    if (provider.destinationFormat !== undefined && overlay.formatSnapshotId !== provider.destinationFormat) {
      throw new Error(`skillset: ${featureId} ${target} provider overlay ${overlayId} belongs to ${overlay.formatSnapshotId}, not ${provider.destinationFormat}`);
    }
    evidence.push(providerOverlay(overlayId));
  }

  for (const destination of provider.unsupportedDestinations ?? []) {
    if (destination.trim().length === 0) {
      throw new Error(`skillset: ${featureId} ${target} provider unsupported destination must be non-empty`);
    }
  }

  return evidence;
}

function uniqueEvidence(evidence: readonly SkillsetFeatureEvidence[]): readonly SkillsetFeatureEvidence[] {
  const seen = new Set<string>();
  const unique: SkillsetFeatureEvidence[] = [];
  for (const item of evidence) {
    const key = `${item.kind}\0${item.ref}\0${item.verifiedAt ?? ""}\0${item.note ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function source(ref: string): SkillsetFeatureEvidence {
  return { kind: "source", ref };
}

function test(ref: string, note: string): SkillsetFeatureEvidence {
  return { kind: "test", note, ref };
}

function fixture(ref: string): SkillsetFeatureEvidence {
  return { kind: "fixture", ref };
}
