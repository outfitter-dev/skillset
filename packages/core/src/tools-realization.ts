import { getProviderDestinationFormatSnapshot } from "@skillset/registry";

import type { SkillsetFeatureEvidence } from "./feature-registry";
import { compareStrings } from "./path";
import type { SkillsetRenderResultStatus } from "./render-result";
import {
  classifyNativeToolRule,
  isToolsAspect,
  lowerClaudeToolAspect,
  PORTABLE_TOOL_ASPECTS,
  type EffectiveToolsPolicy,
  type ToolsAspect,
} from "./skill-policy";
import { targetNames } from "./targets";
import type { JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export { PORTABLE_TOOL_ASPECTS, type ToolsAspect } from "./skill-policy";

export const TOOLS_REALIZATION_TIERS = [
  "advisory",
  "approximate",
  "derived",
  "metadata-only",
  "native",
  "settings-required",
  "transformed",
  "unsupported",
] as const;

export type ToolsRealizationTier = (typeof TOOLS_REALIZATION_TIERS)[number];

export const TOOLS_REALIZATION_SURFACES = [
  "agent-definition",
  "hook",
  "managed-policy",
  "metadata",
  "none",
  "project-config",
  "settings-suggestion",
  "skill-frontmatter",
  "user-config",
] as const;

export type ToolsRealizationSurface = (typeof TOOLS_REALIZATION_SURFACES)[number];

export type ToolsRealizationDirection = "constrain" | "grant";

export type ToolsRealizationEnforcement =
  | "metadata"
  | "none"
  | "preapproval"
  | "provider-enforced";

/**
 * One realization fact: how a portable tools aspect lands (or could land) on a
 * provider surface. `rendered: true` rows describe what `skillset build` emits
 * today; `rendered: false` rows record known provider surfaces Skillset
 * deliberately does not drive, because build must not mutate provider settings
 * or claim unproven enforcement.
 */
export interface ToolsRealizationFact {
  readonly aspects: readonly ToolsAspect[];
  /** Absent means the fact applies to both grants and constraints. */
  readonly direction?: ToolsRealizationDirection;
  readonly diagnostic?: string;
  /** Emitted provider field/rule family when the fact is realized. */
  readonly emits?: string;
  readonly enforcement: ToolsRealizationEnforcement;
  readonly evidence: readonly SkillsetFeatureEvidence[];
  readonly provider: TargetName;
  readonly rendered: boolean;
  readonly surface: ToolsRealizationSurface;
  readonly tier: ToolsRealizationTier;
}

export interface ToolsNativeOverlayRealization {
  readonly diagnostic?: string;
  readonly emits: string;
  readonly evidence: readonly SkillsetFeatureEvidence[];
  readonly surface: ToolsRealizationSurface;
  readonly tier: ToolsRealizationTier;
}

const TOOLS_POLICY_DOCS = "docs/features/tools-policy.md";
const TOOLS_POLICY_ADR = "docs/adrs/0020-portable-skill-tools-policy.md";
const SKILL_POLICY_SOURCE = "packages/core/src/skill-policy.ts";
const RENDER_SOURCE = "packages/core/src/render.ts";

const CLAUDE_ROW_EVIDENCE: readonly SkillsetFeatureEvidence[] = [
  docs(TOOLS_POLICY_DOCS),
  docs(TOOLS_POLICY_ADR),
  source(SKILL_POLICY_SOURCE),
  test("apps/skillset/src/__tests__/skillset.test.ts", "portable tools render to Claude allowed-tools and disallowed-tools rules"),
];

const METADATA_ROW_EVIDENCE: readonly SkillsetFeatureEvidence[] = [
  docs(TOOLS_POLICY_DOCS),
  source(RENDER_SOURCE),
  test("apps/skillset/src/__tests__/skillset.test.ts", "tools policy renders .skillset.tools.yaml metadata sidecars"),
];

const CODEX_METADATA_DIAGNOSTIC =
  "Codex has no proven skill-local tools enforcement surface; policy is recorded as reviewable metadata only.";
const CURSOR_METADATA_DIAGNOSTIC =
  "Cursor has no proven skill-local tools enforcement surface; policy is recorded as reviewable metadata only.";
const CLAUDE_WRITE_RESIDUAL_RISK =
  "Claude disallowed-tools removes Write and Edit, but Bash and MCP tools can still change state unless paired with hooks or permission settings.";
const CURSOR_MCP_RESIDUAL_RISK =
  "Cursor has no proven per-skill or per-agent MCP allowlist; inherited MCP tools may remain available.";

function claudeAspectRow(args: {
  readonly aspect: ToolsAspect;
  readonly diagnostic?: string;
  readonly direction: ToolsRealizationDirection;
  readonly emits: string;
  readonly enforcement: ToolsRealizationEnforcement;
}): ToolsRealizationFact {
  return {
    aspects: [args.aspect],
    ...(args.diagnostic === undefined ? {} : { diagnostic: args.diagnostic }),
    direction: args.direction,
    emits: args.emits,
    enforcement: args.enforcement,
    evidence: CLAUDE_ROW_EVIDENCE,
    provider: "claude",
    rendered: true,
    surface: "skill-frontmatter",
    tier: "transformed",
  };
}

/**
 * Realization facts for the v1 portable tools aspects. Rows claim only what
 * checked-in evidence supports: Claude skill frontmatter rules are transformed
 * preapproval/denial (not a sandbox), Codex and Cursor skill-local policy is
 * metadata-only, and stronger provider surfaces (Codex sandbox_mode, Cursor
 * agent readonly) are settings-required facts that build never mutates.
 */
export const toolsRealizationFacts: readonly ToolsRealizationFact[] = [
  claudeAspectRow({
    aspect: "read",
    direction: "grant",
    emits: "allowed-tools: Read",
    enforcement: "preapproval",
  }),
  claudeAspectRow({
    aspect: "read",
    direction: "constrain",
    emits: "disallowed-tools: Read",
    enforcement: "provider-enforced",
  }),
  claudeAspectRow({
    aspect: "search",
    direction: "grant",
    emits: "allowed-tools: Grep, Glob",
    enforcement: "preapproval",
  }),
  claudeAspectRow({
    aspect: "search",
    direction: "constrain",
    emits: "disallowed-tools: Grep, Glob",
    enforcement: "provider-enforced",
  }),
  claudeAspectRow({
    aspect: "write",
    direction: "grant",
    emits: "allowed-tools: Write, Edit",
    enforcement: "preapproval",
  }),
  claudeAspectRow({
    aspect: "write",
    direction: "constrain",
    diagnostic: CLAUDE_WRITE_RESIDUAL_RISK,
    emits: "disallowed-tools: Write, Edit",
    enforcement: "provider-enforced",
  }),
  claudeAspectRow({
    aspect: "shell",
    direction: "grant",
    emits: "allowed-tools: Bash / Bash(<pattern>)",
    enforcement: "preapproval",
  }),
  claudeAspectRow({
    aspect: "shell",
    direction: "constrain",
    emits: "disallowed-tools: Bash",
    enforcement: "provider-enforced",
  }),
  claudeAspectRow({
    aspect: "mcp",
    direction: "grant",
    emits: "allowed-tools: mcp__<server> / mcp__<server>__<tool-glob>",
    enforcement: "preapproval",
  }),
  claudeAspectRow({
    aspect: "mcp",
    direction: "constrain",
    emits: "disallowed-tools: mcp__<server> / mcp__*",
    enforcement: "provider-enforced",
  }),
  {
    aspects: [...PORTABLE_TOOL_ASPECTS],
    diagnostic: CODEX_METADATA_DIAGNOSTIC,
    emits: ".skillset.tools.yaml: tools.portable.<aspect>",
    enforcement: "metadata",
    evidence: METADATA_ROW_EVIDENCE,
    provider: "codex",
    rendered: true,
    surface: "metadata",
    tier: "metadata-only",
  },
  {
    aspects: ["write"],
    diagnostic:
      "Skillset build must not mutate Codex configuration; realize write: false through a reviewed Codex custom-agent or config change.",
    direction: "constrain",
    emits: 'sandbox_mode = "read-only" (Codex custom agent / config)',
    enforcement: "provider-enforced",
    evidence: [
      docs(TOOLS_POLICY_ADR),
      externalDocs("https://developers.openai.com/codex/agent-approvals-security", "2026-07-02"),
    ],
    provider: "codex",
    rendered: false,
    surface: "agent-definition",
    tier: "settings-required",
  },
  {
    aspects: [...PORTABLE_TOOL_ASPECTS],
    diagnostic:
      "Agent Skills allowed-tools is experimental and Codex runtime enforcement is unproven; Skillset does not emit it.",
    direction: "grant",
    emits: "allowed-tools (Agent Skills experimental; not emitted)",
    enforcement: "none",
    evidence: [
      docs(TOOLS_POLICY_ADR),
      assumption(
        "agent-skills-allowed-tools-experimental",
        "Agent Skills spec allowed-tools remains experimental; replace with runtime evidence before emitting for Codex."
      ),
    ],
    provider: "codex",
    rendered: false,
    surface: "skill-frontmatter",
    tier: "advisory",
  },
  {
    aspects: [...PORTABLE_TOOL_ASPECTS],
    diagnostic: CURSOR_METADATA_DIAGNOSTIC,
    emits: ".skillset.tools.yaml: tools.portable.<aspect>",
    enforcement: "metadata",
    evidence: METADATA_ROW_EVIDENCE,
    provider: "cursor",
    rendered: true,
    surface: "metadata",
    tier: "metadata-only",
  },
  {
    aspects: ["write"],
    diagnostic:
      "Skillset build must not mutate Cursor agent definitions; realize write: false through a reviewed Cursor agent readonly: true change.",
    direction: "constrain",
    emits: "readonly: true (Cursor agent frontmatter)",
    enforcement: "provider-enforced",
    evidence: [docs(TOOLS_POLICY_ADR), cursorAgentSnapshotEvidence()],
    provider: "cursor",
    rendered: false,
    surface: "agent-definition",
    tier: "settings-required",
  },
  {
    aspects: ["mcp"],
    diagnostic: CURSOR_MCP_RESIDUAL_RISK,
    enforcement: "none",
    evidence: [docs(TOOLS_POLICY_ADR), externalDocs("https://cursor.com/docs/subagents", "2026-07-02")],
    provider: "cursor",
    rendered: false,
    surface: "none",
    tier: "unsupported",
  },
];

/**
 * How native allow/deny rule strings under tools.<provider> are realized.
 * Claude rules pass through verbatim; Codex and Cursor have no proven native
 * rule syntax, so strings are preserved as target_native metadata.
 */
export const toolsNativeOverlayRealizations: Readonly<Record<TargetName, ToolsNativeOverlayRealization>> = {
  claude: {
    emits: "allowed-tools / disallowed-tools (verbatim native rule strings)",
    evidence: CLAUDE_ROW_EVIDENCE,
    surface: "skill-frontmatter",
    tier: "native",
  },
  codex: {
    diagnostic: CODEX_METADATA_DIAGNOSTIC,
    emits: ".skillset.tools.yaml: tools.target_native",
    evidence: METADATA_ROW_EVIDENCE,
    surface: "metadata",
    tier: "metadata-only",
  },
  cursor: {
    diagnostic:
      "Cursor has no documented native tool rule syntax; strings are preserved as provenance metadata only.",
    emits: ".skillset.tools.yaml: tools.target_native",
    evidence: METADATA_ROW_EVIDENCE,
    surface: "metadata",
    tier: "metadata-only",
  },
};

export interface ToolsRealizationFactFilter {
  readonly aspect?: ToolsAspect;
  readonly provider?: TargetName;
  readonly rendered?: boolean;
}

export function listToolsRealizationFacts(
  filter: ToolsRealizationFactFilter = {}
): readonly ToolsRealizationFact[] {
  return toolsRealizationFacts.filter((fact) => {
    if (filter.provider !== undefined && fact.provider !== filter.provider) return false;
    if (filter.aspect !== undefined && !fact.aspects.includes(filter.aspect)) return false;
    if (filter.rendered !== undefined && fact.rendered !== filter.rendered) return false;
    return true;
  });
}

/**
 * The fact describing what `skillset build` emits for an aspect on a provider.
 * Exactly one rendered fact exists per provider/aspect/direction; the registry
 * seed test pins that invariant.
 */
export function getRenderedToolsRealization(
  provider: TargetName,
  aspect: ToolsAspect,
  direction: ToolsRealizationDirection
): ToolsRealizationFact {
  const matches = toolsRealizationFacts.filter(
    (fact) =>
      fact.provider === provider &&
      fact.rendered &&
      fact.aspects.includes(aspect) &&
      (fact.direction === undefined || fact.direction === direction)
  );
  const fact = matches[0];
  if (fact === undefined || matches.length > 1) {
    throw new Error(
      `skillset: tools realization registry must have exactly one rendered fact for ${provider} ${aspect} ${direction}`
    );
  }
  return fact;
}

/** Maps a rendered realization tier onto the render-result status vocabulary. */
export function renderResultStatusForToolsTier(tier: ToolsRealizationTier): SkillsetRenderResultStatus {
  if (tier === "native") return "target_native";
  if (tier === "transformed" || tier === "derived") return "transformed";
  if (tier === "metadata-only" || tier === "advisory") return "metadata_only";
  if (tier === "approximate") return "degraded";
  throw new Error(`skillset: tools realization tier ${tier} does not produce rendered output`);
}

export type ToolsRealizationDecidingLayer = "base" | "macro" | "native-overlay" | "provider-override";

export interface ToolsRealizationPlanEntry {
  /** Portable aspect, or the classified family of a native rule. */
  readonly aspect?: ToolsAspect;
  readonly decidingLayer: ToolsRealizationDecidingLayer;
  readonly diagnostics: readonly string[];
  readonly emits: readonly string[];
  readonly evidence: readonly SkillsetFeatureEvidence[];
  readonly kind: "native-overlay" | "portable";
  /** Raw native rule string for native-overlay entries. */
  readonly rule?: string;
  readonly ruleDirection?: "allow" | "deny";
  readonly surface: ToolsRealizationSurface;
  readonly tier: ToolsRealizationTier;
  /** True when a native rule matched no known capability family. */
  readonly unclassified?: boolean;
  /** Effective portable value for portable entries. */
  readonly value?: JsonValue;
}

export interface ToolsRealizationPlan {
  readonly entries: readonly ToolsRealizationPlanEntry[];
  readonly hasSource: boolean;
  readonly macro?: "readonly";
  readonly provider: TargetName;
}

/**
 * Computes per-aspect realization decisions for an effective tools policy by
 * combining registry facts (tier, surface, diagnostics, evidence) with the
 * the provider transform code (emitted rules). Transforms stay in provider code;
 * the plan cites their output.
 */
export function planToolsRealization(policy: EffectiveToolsPolicy): ToolsRealizationPlan {
  const entries: ToolsRealizationPlanEntry[] = [];

  for (const [key, value] of Object.entries(policy.portable)) {
    if (value === undefined || !isToolsAspect(key)) continue;
    const direction = portableDirectionFor(value);
    const fact = getRenderedToolsRealization(policy.target, key, direction);
    entries.push({
      aspect: key,
      decidingLayer: policy.portableLayers[key] ?? "base",
      diagnostics: portableDiagnosticsFor(policy.target, key, direction, fact),
      emits: portableEmitsFor(policy.target, key, value),
      evidence: fact.evidence,
      kind: "portable",
      surface: fact.surface,
      tier: fact.tier,
      value,
    });
  }

  const overlay = toolsNativeOverlayRealizations[policy.target];
  for (const { direction, rules } of [
    { direction: "allow" as const, rules: policy.nativeAllow },
    { direction: "deny" as const, rules: policy.nativeDeny },
  ]) {
    for (const rule of rules) {
      const aspect = classifyNativeToolRule(rule);
      entries.push({
        ...(aspect === undefined ? { unclassified: true } : { aspect }),
        decidingLayer: "native-overlay",
        diagnostics: overlay.diagnostic === undefined ? [] : [overlay.diagnostic],
        emits: [nativeOverlayEmit(policy.target, direction, rule)],
        evidence: overlay.evidence,
        kind: "native-overlay",
        rule,
        ruleDirection: direction,
        surface: overlay.surface,
        tier: overlay.tier,
      });
    }
  }

  return {
    entries: entries.sort(comparePlanEntries),
    hasSource: policy.hasSource,
    ...(policy.macro === undefined ? {} : { macro: policy.macro }),
    provider: policy.target,
  };
}

/**
 * `false` constrains; a map whose entries all deny constrains too (a deny-only
 * MCP map emits only denial rules); everything else is a grant or mixed grant.
 */
function portableDirectionFor(value: JsonValue): ToolsRealizationDirection {
  if (value === false) return "constrain";
  if (isJsonRecord(value)) {
    const servers = Object.values(value);
    if (servers.length > 0 && servers.every((server) => server === false)) return "constrain";
  }
  return "grant";
}

/**
 * Plan diagnostics for a portable aspect: the rendered fact's own diagnostic
 * plus residual risks from unsupported facts for the same aspect, so explain
 * shows "no enforcing surface exists" risks alongside what was emitted.
 */
function portableDiagnosticsFor(
  provider: TargetName,
  aspect: ToolsAspect,
  direction: ToolsRealizationDirection,
  fact: ToolsRealizationFact
): readonly string[] {
  const diagnostics = fact.diagnostic === undefined ? [] : [fact.diagnostic];
  for (const residual of listToolsRealizationFacts({ aspect, provider, rendered: false })) {
    if (residual.tier !== "unsupported" || residual.diagnostic === undefined) continue;
    if (residual.direction !== undefined && residual.direction !== direction) continue;
    diagnostics.push(residual.diagnostic);
  }
  return [...new Set(diagnostics)];
}

function portableEmitsFor(provider: TargetName, aspect: ToolsAspect, value: JsonValue): readonly string[] {
  if (provider === "claude") {
    const rules = lowerClaudeToolAspect(aspect, value, `tools.${aspect}`);
    return [
      ...rules.allow.map((rule) => `allowed-tools: ${rule}`),
      ...rules.deny.map((rule) => `disallowed-tools: ${rule}`),
    ];
  }
  return [`.skillset.tools.yaml: tools.portable.${aspect}`];
}

function nativeOverlayEmit(provider: TargetName, direction: "allow" | "deny", rule: string): string {
  if (provider === "claude") {
    return direction === "allow" ? `allowed-tools: ${rule}` : `disallowed-tools: ${rule}`;
  }
  return `.skillset.tools.yaml: tools.target_native.${direction}`;
}

function comparePlanEntries(left: ToolsRealizationPlanEntry, right: ToolsRealizationPlanEntry): number {
  return compareStrings(planEntryKey(left), planEntryKey(right));
}

function planEntryKey(entry: ToolsRealizationPlanEntry): string {
  return `${entry.kind}\0${entry.aspect ?? "~"}\0${entry.rule ?? ""}\0${entry.ruleDirection ?? ""}`;
}

/** Targets whose rendered tools realization is the metadata sidecar. */
export function toolsMetadataSidecarTargets(): readonly TargetName[] {
  return targetNames().filter((target) =>
    listToolsRealizationFacts({ provider: target, rendered: true }).some(
      (fact) => fact.surface === "metadata" && fact.tier === "metadata-only"
    )
  );
}

function cursorAgentSnapshotEvidence(): SkillsetFeatureEvidence {
  const snapshot = getProviderDestinationFormatSnapshot("cursor-agent");
  if (snapshot === undefined) {
    throw new Error("skillset: provider destination format snapshot cursor-agent does not exist");
  }
  return {
    kind: "provider-snapshot",
    note: snapshot.provenance.contentHash,
    ref: "cursor-agent",
    verifiedAt: snapshot.provenance.fetchedAt.slice(0, 10),
  };
}

function docs(ref: string): SkillsetFeatureEvidence {
  return { kind: "docs", ref };
}

function source(ref: string): SkillsetFeatureEvidence {
  return { kind: "source", ref };
}

function test(ref: string, note: string): SkillsetFeatureEvidence {
  return { kind: "test", note, ref };
}

function externalDocs(ref: string, verifiedAt: string): SkillsetFeatureEvidence {
  return { kind: "external-docs", ref, verifiedAt };
}

function assumption(ref: string, note: string): SkillsetFeatureEvidence {
  return { kind: "assumption", note, ref };
}
