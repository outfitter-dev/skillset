import { createHash } from "node:crypto";
import {
  getStandardProfile,
  getProviderSchemaSnapshot,
  providerSchemaManualOverlays,
  getProviderDestinationFormatSnapshot,
  type ProviderDestinationFormatSnapshot,
  type StandardProfileId,
} from "@skillset/registry";
import {
  skillsetSchemaContracts,
  type SkillsetSchemaContractId,
} from "@skillset/schema";

import { getSkillsetFeature, type SkillsetFeatureId, type SkillsetFeatureEvidence, type SkillsetProviderSupportEvidence, type SkillsetTargetSupportStatus } from "./feature-registry";
import { compareStrings } from "./path";
import type { TargetName } from "./types";

/** Semantic judgments, deliberately independent of destination support statuses. */
export const CAPABILITY_FIDELITIES = [
  "exact", "equivalent", "partial", "synthesized", "provider-only", "unavailable", "unknown",
] as const;
export type CapabilityFidelity = (typeof CAPABILITY_FIDELITIES)[number];

export interface CapabilityEvidenceAssessment {
  /** Existing authority identity, such as provider-snapshot:codex-subagent. */
  readonly id: string;
  readonly status: "current" | "stale" | "missing" | "insufficient";
  /** The semantics the evidence actually establishes, not merely a provider name. */
  readonly scope: string;
}

export interface CapabilityFidelityAssessment {
  readonly fidelity: CapabilityFidelity;
  readonly reasons: readonly string[];
}

/**
 * Evidence qualifies an explicit semantic judgment; it never supplies one from
 * a destination's presence, a support status, or a successful build.
 */
export function assessCapabilityFidelity(
  judgment: CapabilityFidelity | undefined,
  evidence: readonly CapabilityEvidenceAssessment[]
): CapabilityFidelityAssessment {
  const reasons: string[] = [];
  if (judgment === undefined) reasons.push("No semantic fidelity judgment is recorded.");
  if (evidence.length === 0) reasons.push("No semantic evidence is recorded.");
  for (const item of evidence) {
    if (item.status !== "current") reasons.push(`${item.id}: ${item.status}`);
    else if (item.scope.trim().length === 0) reasons.push(`${item.id}: insufficient semantic scope`);
  }
  return {
    fidelity: reasons.length === 0 ? judgment ?? "unknown" : "unknown",
    reasons: [...new Set(reasons)].sort(compareStrings),
  };
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly title: string;
  readonly family: "skills" | "agents" | "rules" | "hooks" | "plugins" | "mcp" | "standards";
  /** Query aliases only: these do not authorize source-text transformations. */
  readonly aliases: readonly string[];
  readonly featureIds: readonly SkillsetFeatureId[];
  readonly sourceContractIds: readonly SkillsetSchemaContractId[];
  readonly standardProfileIds: readonly StandardProfileId[];
}

// This is the semantic index. Provider fields, source shapes, support, and
// evidence stay with the referenced authorities and are joined by lookup.
const definitions = [
  {
    id: "skills", title: "Reusable skill content", family: "skills",
    aliases: ["skill", "SKILL.md"],
    featureIds: ["standalone-skills", "plugin-skills"],
    sourceContractIds: ["skill-frontmatter"], standardProfileIds: ["agent-skills"],
  },
  {
    id: "skill-invocation", title: "Implicit skill invocation", family: "skills",
    aliases: ["implicit_invocation", "disable-model-invocation", "allow_implicit_invocation"],
    featureIds: ["skill-invocation-policy"],
    sourceContractIds: ["skill-frontmatter"], standardProfileIds: [],
  },
  {
    id: "project-agents", title: "Project agent instructions", family: "agents",
    aliases: ["subagents", "developer_instructions"],
    featureIds: ["project-agents"],
    sourceContractIds: ["agent-frontmatter"], standardProfileIds: [],
  },
  {
    id: "project-rules", title: "Scoped project instructions", family: "rules",
    aliases: ["rules", "AGENTS.md", "CLAUDE.md", "alwaysApply"],
    featureIds: ["project-instructions"],
    sourceContractIds: ["rule-frontmatter"], standardProfileIds: ["agent-instructions"],
  },
  {
    id: "adaptive-hooks", title: "Reusable hook behavior", family: "hooks",
    aliases: ["hooks", "hook.json"],
    featureIds: ["adaptive-hooks"],
    sourceContractIds: ["adaptive-hook"], standardProfileIds: [],
  },
  {
    id: "native-hooks", title: "Provider-native hook declarations", family: "hooks",
    aliases: ["hooks/hooks.json"],
    featureIds: ["plugin-hooks"],
    sourceContractIds: ["hook"], standardProfileIds: [],
  },
  {
    id: "plugin-manifests", title: "Plugin identity and components", family: "plugins",
    aliases: ["plugins", "plugin.json"],
    featureIds: ["plugin-manifests"],
    sourceContractIds: ["plugin-config", "source-metadata"], standardProfileIds: ["agent-plugins-1.0"],
  },
  {
    id: "plugin-agents", title: "Plugin-packaged agents", family: "plugins",
    aliases: ["agents/"],
    featureIds: ["plugin-agents"], sourceContractIds: ["plugin-config"], standardProfileIds: [],
  },
  {
    id: "plugin-mcp", title: "Plugin MCP servers", family: "mcp",
    aliases: ["mcp", "mcpServers", ".mcp.json", "http_headers"],
    featureIds: ["plugin-mcp"],
    sourceContractIds: ["plugin-config"], standardProfileIds: ["agent-plugins-1.0"],
  },
  {
    id: "agent-skills-standard", title: "Agent Skills portable baseline", family: "standards",
    aliases: ["agent-skills", "SKILL.md"],
    featureIds: [], sourceContractIds: [], standardProfileIds: ["agent-skills"],
  },
  {
    id: "agent-instructions-standard", title: "Agent Instructions portable baseline", family: "standards",
    aliases: ["agent-instructions", "AGENTS.md"],
    featureIds: [], sourceContractIds: [], standardProfileIds: ["agent-instructions"],
  },
  {
    id: "agent-plugins-standard", title: "Agent Plugins portable baseline", family: "standards",
    aliases: ["agent-plugins", "agent-plugins-1.0"],
    featureIds: [], sourceContractIds: [], standardProfileIds: ["agent-plugins-1.0"],
  },
] as const satisfies readonly CapabilityDefinition[];

const capabilities: readonly CapabilityDefinition[] = Object.freeze(
  definitions.map((entry) => Object.freeze({
    ...entry,
    aliases: Object.freeze([...entry.aliases]),
    featureIds: Object.freeze([...entry.featureIds]),
    sourceContractIds: Object.freeze([...entry.sourceContractIds]),
    standardProfileIds: Object.freeze([...entry.standardProfileIds]),
  })).sort((left, right) => compareStrings(left.id, right.id))
);

export function listCapabilities(): readonly CapabilityDefinition[] {
  return capabilities;
}

/** Exact aliases may name several concepts; preserve that ambiguity for callers. */
export function findCapabilities(query: string): readonly CapabilityDefinition[] {
  const normalized = query.trim();
  return capabilities.filter((entry) => entry.id === normalized || entry.aliases.includes(normalized));
}

/** Validate references at the consumption boundary without introducing import-time cycles. */
export function assertCapabilityAuthorities(): void {
  const ids = new Set<string>();
  for (const entry of capabilities) {
    if (ids.has(entry.id)) throw new Error(`skillset: duplicate capability ${entry.id}`);
    ids.add(entry.id);
    for (const id of entry.featureIds) {
      if (getSkillsetFeature(id) === undefined) throw new Error(`skillset: ${entry.id} references missing feature ${id}`);
    }
    for (const id of entry.sourceContractIds) {
      if (!skillsetSchemaContracts.some((contract) => contract.id === id)) {
        throw new Error(`skillset: ${entry.id} references missing source contract ${id}`);
      }
    }
    for (const id of entry.standardProfileIds) getStandardProfile(id);
  }
}


export interface CapabilityComparison {
  readonly capabilityId: string;
  readonly title: string;
  readonly featureId: SkillsetFeatureId;
  readonly target: TargetName;
  readonly canonical: {
    readonly shape: string;
    readonly contracts: readonly SkillsetSchemaContractId[];
  };
  readonly destination?: ProviderDestinationFormatSnapshot;
  readonly providerEvidence?: SkillsetProviderSupportEvidence;
  readonly realization: {
    readonly description: string;
    readonly owner: string;
    readonly destinationSupport: SkillsetTargetSupportStatus;
  };
  readonly fidelity: CapabilityFidelity;
  readonly semanticScope?: string;
  readonly authorityHash: string;
  readonly implementationEvidence: readonly { readonly path: string; readonly contentHash: string }[];
  readonly limitations: readonly string[];
  readonly evidence: readonly (SkillsetFeatureEvidence & { readonly id: string })[];
  readonly standards: readonly StandardProfileId[];
}

/** Join current authorities without converting structural support into semantics. */
export function compareCapability(
  definition: CapabilityDefinition,
  targets: readonly TargetName[]
): readonly CapabilityComparison[] {
  assertCapabilityAuthorities();
  const featureIds = [...new Set([
    ...definition.featureIds,
    ...(definition.family === "standards" ? definition.standardProfileIds.flatMap((id) =>
      getStandardProfile(id).envelopes.map((envelope) => envelope.featureId)
    ) : []),
  ])].sort(compareStrings);
  return featureIds.flatMap((featureId) => {
    const feature = getSkillsetFeature(featureId);
    if (feature === undefined) throw new Error(`skillset: missing crosswalk feature ${featureId}`);
    return [...new Set(targets)].sort(compareStrings).map((target): CapabilityComparison => {
      const support = feature.targetSupport[target];
      const destinationId = support.provider?.destinationFormat;
      const destination = destinationId === undefined ? undefined : getProviderDestinationFormatSnapshot(destinationId);
      const evidence = [...new Map([...feature.evidence, ...(support.evidence ?? [])].map((item) => {
        const id = `${item.kind}:${item.ref}`;
        return [id, { ...item, id }] as const;
      })).values()].sort((left, right) => compareStrings(left.id, right.id));
      const authorityHash = capabilityAuthorityHash(definition, featureId, target);
      const judgment = judgments.find((entry) => entry.capabilityId === definition.id && entry.featureId === featureId && entry.target === target);
      const assessment = assessPinnedCapabilityJudgment(judgment, authorityHash);
      return {
        capabilityId: definition.id,
        title: definition.title,
        featureId,
        target,
        canonical: { shape: feature.sourceShape, contracts: definition.sourceContractIds },
        ...(destination === undefined ? {} : { destination }),
        ...(support.provider === undefined ? {} : { providerEvidence: support.provider }),
        realization: {
          description: support.note ?? feature.summary,
          owner: feature.renderOwner,
          destinationSupport: support.status,
        },
        fidelity: assessment.fidelity,
        authorityHash,
        implementationEvidence: judgment === undefined ? [] : CAPABILITY_IMPLEMENTATION_EVIDENCE.filter(({ path }) => judgment.implementationPaths.includes(path)),
        ...(judgment === undefined ? {} : { semanticScope: judgment.scope }),
        limitations: [...assessment.reasons, ...(judgment?.limitations ?? []), ...(support.reason === undefined ? [] : [support.reason]),
          "Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.",
          "Destination support and build output do not prove runtime activation or effectiveness."],
        evidence,
        standards: definition.standardProfileIds,
      };
    });
  });
}


export interface CapabilityJudgment {
  readonly implementationPaths: readonly string[];
  readonly capabilityId: string;
  readonly featureId: SkillsetFeatureId;
  readonly target: TargetName;
  readonly fidelity: CapabilityFidelity;
  readonly scope: string;
  readonly limitations: readonly string[];
  /** Reviewed authority state, not a hash recomputed to bless new evidence. */
  readonly authorityHash: string;
}

/** Pinned evidence freshness is revision-based, so ordinary lookup needs no clock or network. */
export function capabilityAuthorityHash(definition: CapabilityDefinition, featureId: string, target: TargetName): string {
  const feature = getSkillsetFeature(featureId);
  if (feature === undefined) throw new Error(`skillset: missing capability feature ${featureId}`);
  const support = feature.targetSupport[target];
  const provider = support.provider;
  return `sha256:${createHash("sha256").update(JSON.stringify({
    feature,
    target,
    destination: provider?.destinationFormat === undefined ? null : getProviderDestinationFormatSnapshot(provider.destinationFormat),
    schemas: (provider?.schemaSnapshots ?? []).map((id) => getProviderSchemaSnapshot(id)),
    overlays: (provider?.manualOverlays ?? []).map((id) => providerSchemaManualOverlays.find((overlay) => overlay.id === id)),
    contracts: definition.sourceContractIds.map((id) => skillsetSchemaContracts.find((contract) => contract.id === id)),
    standards: definition.standardProfileIds.map((id) => {
      const profile = getStandardProfile(id);
      return { id, lifecycle: profile.lifecycle, contentHash: profile.provenance.contentHash };
    }),
  })).digest("hex")}`;
}

export function assessPinnedCapabilityJudgment(
  judgment: CapabilityJudgment | undefined,
  authorityHash: string | undefined
): CapabilityFidelityAssessment {
  if (judgment === undefined) return assessCapabilityFidelity(undefined, []);
  return assessCapabilityFidelity(judgment.fidelity, [{
    id: `${judgment.capabilityId}:${judgment.featureId}:${judgment.target}`,
    scope: judgment.scope,
    status: authorityHash === undefined ? "missing" : authorityHash === judgment.authorityHash ? "current" : "stale",
  }]);
}


// These narrow judgments were reviewed against the pinned authorities and the
// named compiler regressions. Updating an authority hash requires reviewing the
// semantics again; never regenerate these hashes merely to restore a verdict.
const judgments: readonly CapabilityJudgment[] = [
  {
    capabilityId: "skill-invocation", featureId: "skill-invocation-policy", target: "codex", fidelity: "exact",
    implementationPaths: ["packages/core/src/render-codex-skill-sidecars.ts", "packages/core/src/skill-policy.ts", "packages/core/src/__tests__/skill-invocation-policy.test.ts", "docs/reference/features/skills.md"],
    scope: "The resolved implicit_invocation boolean is represented directly as policy.allow_implicit_invocation in agents/openai.yaml.",
    limitations: ["Scope is invocation eligibility only, not model compliance or user invocation. Explicit provider overrides are outside this judgment.", "Implementation proof: packages/core/src/__tests__/skill-invocation-policy.test.ts; render-codex-skill-sidecars.ts."],
    authorityHash: "sha256:f75055451ba906f201a1000360ac42e05696f5b5e3bc547c1bac66eb26b76fa9",
  },
  {
    capabilityId: "skill-invocation", featureId: "skill-invocation-policy", target: "claude", fidelity: "equivalent",
    implementationPaths: ["packages/core/src/render.ts", "packages/core/src/skill-policy.ts", "packages/core/src/__tests__/skill-invocation-policy.test.ts", "docs/reference/features/skills.md"],
    scope: "The resolved implicit_invocation boolean is inverted into disable-model-invocation; false eligibility becomes true disablement and vice versa.",
    limitations: ["Scope is invocation eligibility only; this does not disable explicit user invocation or prove runtime enforcement. Explicit provider overrides are outside this judgment.", "Implementation proof: packages/core/src/__tests__/skill-invocation-policy.test.ts; render.ts."],
    authorityHash: "sha256:881316c3151aa8e4da5994858106862812011cdb4314968051d1c1f09a5adc68",
  },
  {
    capabilityId: "project-agents", featureId: "project-agents", target: "codex", fidelity: "partial",
    implementationPaths: ["packages/core/src/render.ts", "packages/core/src/project-agent-skills.ts", "packages/core/src/__tests__/project-agent-skills.test.ts", "apps/skillset/src/__tests__/skillset.test.ts", "docs/reference/features/agents.md"],
    scope: "Project-agent name, description and instructions receive native TOML fields; shared skill-loading intent is only an instruction preface.",
    limitations: ["The skills preface is advisory, not target-enforced skill metadata. Provider-only fields require explicit provider configuration.", "Implementation proof: apps/skillset/src/__tests__/skillset.test.ts and docs/reference/features/agents.md."],
    authorityHash: "sha256:9ef3d5e5bfab312cb15b3d4455ff914c136c78223e70c0d0aa87dcc9096b5601",
  },
  {
    capabilityId: "project-rules", featureId: "project-instructions", target: "codex", fidelity: "synthesized",
    implementationPaths: ["packages/core/src/render-rules.ts", "packages/core/src/render-standard-instructions.ts", "packages/core/src/__tests__/render-standard-instructions.test.ts", "packages/core/src/__tests__/native-root-rules.test.ts", "docs/reference/features/rules.md"],
    scope: "Generated rules with literal directory scope and no paths narrowing are combined in deterministic source-path order into the directory AGENTS.md.",
    limitations: ["This judgment excludes paths narrowing, which is degraded, and wildcard scopes, which are unsupported. Native root AGENTS.md is read in place and is outside this synthesis judgment. Native context limits and AGENTS.override.md shadowing still apply.", "Implementation proof: packages/core/src/__tests__/render-standard-instructions.test.ts and docs/reference/features/rules.md."],
    authorityHash: "sha256:bbeafbbf025b130dafbeb55deeaaad150e64ed7c7e58543e4269a3de7bd9bd40",
  },
  {
    capabilityId: "native-hooks", featureId: "plugin-hooks", target: "claude", fidelity: "provider-only",
    implementationPaths: ["packages/core/src/hooks.ts", "packages/core/src/render-hooks.ts", "packages/core/src/hook-capabilities.ts", "docs/reference/features/hooks.md"],
    scope: "Claude-native plugin hook declarations retain Claude event and handler semantics through validated pass-through.",
    limitations: ["The declaration is provider-native; identically spelled events on other providers do not establish equivalence. Use adaptive hooks for explicitly supported adaptation.", "Implementation proof: packages/core/src/hooks.ts and render-hooks.ts; docs/reference/features/hooks.md."],
    authorityHash: "sha256:69cdb29880ac838f610030b9a714229efeb9fa034c35cd909426e1a0f5ac65fd",
  },
  {
    capabilityId: "plugin-agents", featureId: "plugin-agents", target: "codex", fidelity: "unavailable",
    implementationPaths: ["packages/core/src/render.ts", "apps/skillset/src/__tests__/skillset.test.ts", "docs/reference/features/agents.md"],
    scope: "The pinned Codex plugin contract has no plugin agents component; Skillset cannot faithfully emit plugin-packaged agents there.",
    limitations: ["This is a plugin-packaging limitation. It does not mean Codex project agents are unavailable.", "Implementation proof: feature plugin-agents unsupportedDestinations and docs/reference/features/agents.md."],
    authorityHash: "sha256:2f53e3b41d9d118724b6c36a899dfb54c0eff3d52bb66fbc0f9f532fa16fccb0",
  },
];


/** Reviewed implementation content; the crosswalk regression gate rejects drift. */
export const CAPABILITY_IMPLEMENTATION_EVIDENCE = [
  { path: "packages/core/src/__tests__/native-root-rules.test.ts", contentHash: "sha256:84aa20e153b19b5933056e177d2c4ae20319a4917d07dfb4afa0fbf07b9dd3b6" },
  { path: "packages/core/src/render-codex-skill-sidecars.ts", contentHash: "sha256:acf23268dced754dad23abb6e3c0e55ceb2fbb7009b689d6aad4ea2bfc7431e2" },
  { path: "packages/core/src/render.ts", contentHash: "sha256:ebfd6be09e8f265b738801a60a7e131a722e5af35d9976a782bb9fd890c7fd67" },
  { path: "packages/core/src/skill-policy.ts", contentHash: "sha256:a3de6ef0d5e691ec12f53d5f7d66965b38c25d54e79ace39c500e7c3072f7715" },
  { path: "packages/core/src/__tests__/skill-invocation-policy.test.ts", contentHash: "sha256:3cd2a7199c8e64f49162939376a017052aa011404455482adda7e3b3f6240561" },
  { path: "packages/core/src/project-agent-skills.ts", contentHash: "sha256:61ec143b8422d29aa96334d1ece03d4d12c7d874087a95f2762595644980a281" },
  { path: "packages/core/src/__tests__/project-agent-skills.test.ts", contentHash: "sha256:e491ac044e0b72d701ff3cf6dc2d5ebc5c69cd87ee8212ae433534118f6336e0" },
  { path: "apps/skillset/src/__tests__/skillset.test.ts", contentHash: "sha256:2148d7acb3eaf1aac275ee0af0efa89da9d106266c1f94a8cf3d4ab4df270c71" },
  { path: "packages/core/src/render-rules.ts", contentHash: "sha256:0d96c31d9dad2492b05629a59094b70ad7d9bb1d3263c1986c1a2ab4561a0ff6" },
  { path: "packages/core/src/render-standard-instructions.ts", contentHash: "sha256:608f1171d11ce31c910871a2027a2d6909a3a1106e750d5057eea46eebae33c2" },
  { path: "packages/core/src/__tests__/render-standard-instructions.test.ts", contentHash: "sha256:ea2548155b937c075f2d7b5aaf105866ff36a92bee277cba3d812fd94a8297f2" },
  { path: "packages/core/src/hooks.ts", contentHash: "sha256:8659ebcef8468a700f3240075b2f6128fd21cccd2364379734e7057239d75d70" },
  { path: "packages/core/src/render-hooks.ts", contentHash: "sha256:b5ef546bae66dad2a96fd764f240512169d4ea9e23c9932a486be1958ab973b1" },
  { path: "packages/core/src/hook-capabilities.ts", contentHash: "sha256:2f06a181cc347b256d4d4b4a3145a25f37a4d4f6eb1b5b7e448a7ab1af391296" },
  { path: "docs/reference/features/skills.md", contentHash: "sha256:5ac78a6a9907b6528aa04e5450e852791fccd3e201798ffa500e8e7fc3d8bf27" },
  { path: "docs/reference/features/agents.md", contentHash: "sha256:838e466c12e21195998898c009a5297d6d9da4bb98c43f5b4c7ea052cf1d828d" },
  { path: "docs/reference/features/rules.md", contentHash: "sha256:5272d1776cc67e1ad8b974b8ee53126ad588942495e56aeeaec8bd72f7662bad" },
  { path: "docs/reference/features/hooks.md", contentHash: "sha256:828d3b3b763bcad640e7b66eaa06c26c4125e8bb7cb17ab667809213e552991d" },
] as const;
