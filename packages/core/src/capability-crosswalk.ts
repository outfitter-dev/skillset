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
    id: "claude-manifest-identity", title: "Direct Claude manifest identity round trip", family: "plugins",
    aliases: [], featureIds: ["plugin-manifests"],
    sourceContractIds: ["plugin-config", "source-metadata"], standardProfileIds: [],
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
  readonly evidenceStatus: "current" | "stale" | "missing";
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
        evidenceStatus: judgment === undefined ? "missing" : judgment.authorityHash === authorityHash ? "current" : "stale",
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
    capabilityId: "claude-manifest-identity", featureId: "plugin-manifests", target: "claude", fidelity: "exact",
    implementationPaths: ["packages/core/src/import-manifest-roundtrip.ts", "packages/core/src/render-plugin-manifest.ts", "packages/core/src/plugin-manifest-identity.ts", "apps/skillset/src/import.ts", "apps/skillset/src/adopt.ts", "packages/core/src/build.ts", "packages/core/src/__tests__/import-manifest-roundtrip.test.ts", "apps/skillset/src/__tests__/adopt-manifest-roundtrip.test.ts", "docs/guides/importing.md"],
    scope: "Selected direct Claude manifest name and description strings retain their identity and descriptive metadata meaning through canonical configuration and the actual same-provider manifest, only when all three values are equal and no overriding route participates.",
    limitations: ["Excludes name remaps, defaults, whitespace changes, listing or native overrides, absent or unselected output, all other fields and providers, and runtime activation or behavior."],
    authorityHash: "sha256:19713db35fc38ff601965fb3ad88fa98e74d9e9c3cc3bf744f48c14915046a33",
  },
  {
    capabilityId: "skill-invocation", featureId: "skill-invocation-policy", target: "codex", fidelity: "exact",
    implementationPaths: ["packages/core/src/render-codex-skill-sidecars.ts", "packages/core/src/skill-policy.ts", "packages/core/src/__tests__/skill-invocation-policy.test.ts", "docs/reference/features/skills.md"],
    scope: "The resolved implicit_invocation boolean is represented directly as policy.allow_implicit_invocation in agents/openai.yaml.",
    limitations: ["Scope is invocation eligibility only, not model compliance or user invocation. Explicit provider overrides are outside this judgment.", "Implementation proof: packages/core/src/__tests__/skill-invocation-policy.test.ts; render-codex-skill-sidecars.ts."],
    authorityHash: "sha256:86162871ff9d4e0de5c9cddf498cdeb564cd5adb90018a8e60eb809a4f1bb4d7",
  },
  {
    capabilityId: "skill-invocation", featureId: "skill-invocation-policy", target: "claude", fidelity: "equivalent",
    implementationPaths: ["packages/core/src/render.ts", "packages/core/src/skill-policy.ts", "packages/core/src/__tests__/skill-invocation-policy.test.ts", "docs/reference/features/skills.md"],
    scope: "The resolved implicit_invocation boolean is inverted into disable-model-invocation; false eligibility becomes true disablement and vice versa.",
    limitations: ["Scope is invocation eligibility only; this does not disable explicit user invocation or prove runtime enforcement. Explicit provider overrides are outside this judgment.", "Implementation proof: packages/core/src/__tests__/skill-invocation-policy.test.ts; render.ts."],
    authorityHash: "sha256:8ef90765af35eee69eabc5d166e12f82afe0b6b72859a2e7d7cd2bb41b523bce",
  },
  {
    capabilityId: "project-agents", featureId: "project-agents", target: "codex", fidelity: "partial",
    implementationPaths: ["packages/core/src/render.ts", "packages/core/src/project-agent-skills.ts", "packages/core/src/__tests__/project-agent-skills.test.ts", "apps/skillset/src/__tests__/skillset.test.ts", "docs/reference/features/agents.md"],
    scope: "Project-agent name, description and instructions receive native TOML fields; shared skill-loading intent is only an instruction preface.",
    limitations: ["The skills preface is advisory, not target-enforced skill metadata. Provider-only fields require explicit provider configuration.", "Implementation proof: apps/skillset/src/__tests__/skillset.test.ts and docs/reference/features/agents.md."],
    authorityHash: "sha256:e0334f3d7d50f07395dcf19d04261e1d9e62dc4eb7785eb1688d9327f9e1c241",
  },
  {
    capabilityId: "project-rules", featureId: "project-instructions", target: "codex", fidelity: "synthesized",
    implementationPaths: ["packages/core/src/render-rules.ts", "packages/core/src/render-standard-instructions.ts", "packages/core/src/__tests__/render-standard-instructions.test.ts", "packages/core/src/__tests__/native-root-rules.test.ts", "docs/reference/features/rules.md"],
    scope: "Generated rules with literal directory scope and no paths narrowing are combined in deterministic source-path order into the directory AGENTS.md.",
    limitations: ["This judgment excludes paths narrowing, which is degraded, and wildcard scopes, which are unsupported. Native root AGENTS.md is read in place and is outside this synthesis judgment. Native context limits and AGENTS.override.md shadowing still apply.", "Implementation proof: packages/core/src/__tests__/render-standard-instructions.test.ts and docs/reference/features/rules.md."],
    authorityHash: "sha256:1c7c37291996f44896222e680259fe9f9fcb196735d529d18d65fee97c42bba4",
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
    authorityHash: "sha256:89cf22a19c3f2ce9990b2015738328565695b9d935b79004797448ff34b49542",
  },
];


/** Reviewed implementation content; the crosswalk regression gate rejects drift. */
export const CAPABILITY_IMPLEMENTATION_EVIDENCE = [
  { path: "packages/core/src/import-manifest-roundtrip.ts", contentHash: "sha256:ef066fa15c81e4702d6479f2bf7296b8836374bdc6a18a592630cb7d8dcd762f" },
  { path: "packages/core/src/render-plugin-manifest.ts", contentHash: "sha256:9aae325c89c69850911d3a5b4566132b21aae5f2c5a9b9977ae106639505ce87" },
  { path: "packages/core/src/plugin-manifest-identity.ts", contentHash: "sha256:d10cb0004cb89c6c70ee5bc3e1ae91c15a52618cf9acece984bcc991195d61bd" },
  { path: "apps/skillset/src/import.ts", contentHash: "sha256:2010322a99aed9f9d494639039fbb6c02c35816fa881067e0dc87b800a66bcae" },
  { path: "apps/skillset/src/adopt.ts", contentHash: "sha256:275393521cd96b7088a5c776f8237964ab3669b59b5cdd243fd4e22c53328d9a" },
  { path: "packages/core/src/build.ts", contentHash: "sha256:442cef0d9919d2105d64fdc6d339c66e8b957d843fbedad590117a667930d216" },
  { path: "packages/core/src/__tests__/import-manifest-roundtrip.test.ts", contentHash: "sha256:e7be2ba62a564c10f5fd37ea4106b776d84de25695a0e740716bbccf55a8ea46" },
  { path: "apps/skillset/src/__tests__/adopt-manifest-roundtrip.test.ts", contentHash: "sha256:1b15aefb0d36f4e8352c978e30219fff4ea6ba6c094aa41e007ede6cfc9f3f6c" },
  { path: "docs/guides/importing.md", contentHash: "sha256:f8b760977c584fa702c217cb6a516b3e3cb56bd73be2af5578d2272c300b5744" },

  { path: "packages/core/src/__tests__/native-root-rules.test.ts", contentHash: "sha256:c0982bd95e17f682d551e719501cb5e70c7fd71aeb013900f70bece8fc5558c5" },
  { path: "packages/core/src/render-codex-skill-sidecars.ts", contentHash: "sha256:cddc2c7f379fe7701416805437167525ce71383e5589973a86bbcf685fb769c0" },
  { path: "packages/core/src/render.ts", contentHash: "sha256:30e695017c434de260ed1a6651f133b4b5756f0e07e68c286af7665f8598b3ae" },
  { path: "packages/core/src/skill-policy.ts", contentHash: "sha256:28cbfca4c3383b136c4bb27bd6bcbdc1144c5d0aba95f71704a2c2c34478689a" },
  { path: "packages/core/src/__tests__/skill-invocation-policy.test.ts", contentHash: "sha256:c1efd8f659af4b136d97994960cf3512ba40164bb9cde5e47f8be06ae7af7d41" },
  { path: "packages/core/src/project-agent-skills.ts", contentHash: "sha256:55e9dd9ee368a1153e2cf9262f98ea3cee428884e884ab680efd443e64d69085" },
  { path: "packages/core/src/__tests__/project-agent-skills.test.ts", contentHash: "sha256:38865be157c31c3be4de6b3a12a027946cf0e9d6847faed38e24dcc50c4c6105" },
  { path: "apps/skillset/src/__tests__/skillset.test.ts", contentHash: "sha256:98db4ceaabaa00aa6cbcf63a6e1224d526186d2fee6f0e05fe52d5ad9d855ac2" },
  { path: "packages/core/src/render-rules.ts", contentHash: "sha256:a3eb58e3a089c6d02cbc2764dcef12f95d5cc92408583bfe8748840176c777c4" },
  { path: "packages/core/src/render-standard-instructions.ts", contentHash: "sha256:608f1171d11ce31c910871a2027a2d6909a3a1106e750d5057eea46eebae33c2" },
  { path: "packages/core/src/__tests__/render-standard-instructions.test.ts", contentHash: "sha256:ea2548155b937c075f2d7b5aaf105866ff36a92bee277cba3d812fd94a8297f2" },
  { path: "packages/core/src/hooks.ts", contentHash: "sha256:8659ebcef8468a700f3240075b2f6128fd21cccd2364379734e7057239d75d70" },
  { path: "packages/core/src/render-hooks.ts", contentHash: "sha256:d6c7585225a8c017f97d02e0bb7852d10f8fb2760b68bbae58d4cb269bb56e36" },
  { path: "packages/core/src/hook-capabilities.ts", contentHash: "sha256:2f06a181cc347b256d4d4b4a3145a25f37a4d4f6eb1b5b7e448a7ab1af391296" },
  { path: "docs/reference/features/skills.md", contentHash: "sha256:ca8a77f9780c48bbb0161194c2108ac945c0e040fefe23792dcd9ec5532eee79" },
  { path: "docs/reference/features/agents.md", contentHash: "sha256:e721f30c2fdf7587f0bb7660c6e63b21500453d24b853e6a0fa7ead01d1b14fc" },
  { path: "docs/reference/features/rules.md", contentHash: "sha256:c4c5336a510285a4489beb5b2987e96a50a6fb902584ca2205d025f5b0914aa0" },
  { path: "docs/reference/features/hooks.md", contentHash: "sha256:2994ced1372beb687ce669bcffe419db9e668bb4841354154951e7d2aa7a1c65" },
] as const;
