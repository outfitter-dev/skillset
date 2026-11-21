import {
  getStandardProfile,
  getProviderSchemaSnapshot,
  providerSchemaManualOverlays,
  getProviderDestinationFormatSnapshot,
} from "@skillset/provider-evidence";
import type {
  ProviderDestinationFormatSnapshot,
  StandardProfileId,
} from "@skillset/provider-evidence";
import { skillsetSchemaContracts } from "@skillset/schema";
import type {
  CapabilityFidelity,
  SkillsetSchemaContractId,
} from "@skillset/schema";

import { capabilityAuthorityHash as hashCapabilityAuthority } from "./capability-fidelity";
import { getSkillsetFeature } from "./feature-registry";
import type {
  SkillsetFeatureId,
  SkillsetFeatureEvidence,
  SkillsetProviderSupportEvidence,
  SkillsetTargetSupportStatus,
} from "./feature-registry";
import { compareStrings } from "./path";
import type { TargetName } from "./types";

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
export const assessCapabilityFidelity = (
  judgment: CapabilityFidelity | undefined,
  evidence: readonly CapabilityEvidenceAssessment[]
): CapabilityFidelityAssessment => {
  const reasons: string[] = [];
  if (judgment === undefined) {
    reasons.push("No semantic fidelity judgment is recorded.");
  }
  if (evidence.length === 0) {
    reasons.push("No semantic evidence is recorded.");
  }
  for (const item of evidence) {
    if (item.status !== "current") {
      reasons.push(`${item.id}: ${item.status}`);
    } else if (item.scope.trim().length === 0) {
      reasons.push(`${item.id}: insufficient semantic scope`);
    }
  }
  return {
    fidelity: reasons.length === 0 ? (judgment ?? "unknown") : "unknown",
    reasons: [...new Set(reasons)].toSorted(compareStrings),
  };
};

export interface CapabilityDefinition {
  readonly id: string;
  readonly title: string;
  readonly family:
    | "skills"
    | "agents"
    | "rules"
    | "hooks"
    | "plugins"
    | "mcp"
    | "standards";
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
    aliases: ["skill", "SKILL.md"],
    family: "skills",
    featureIds: ["standalone-skills", "plugin-skills"],
    id: "skills",
    sourceContractIds: ["skill-frontmatter"],
    standardProfileIds: ["agent-skills"],
    title: "Reusable skill content",
  },
  {
    aliases: [
      "implicit_invocation",
      "disable-model-invocation",
      "allow_implicit_invocation",
    ],
    family: "skills",
    featureIds: ["skill-invocation-policy"],
    id: "skill-invocation",
    sourceContractIds: ["skill-frontmatter"],
    standardProfileIds: [],
    title: "Implicit skill invocation",
  },
  {
    aliases: ["subagents", "developer_instructions"],
    family: "agents",
    featureIds: ["project-agents"],
    id: "project-agents",
    sourceContractIds: ["agent-frontmatter"],
    standardProfileIds: [],
    title: "Project agent instructions",
  },
  {
    aliases: ["rules", "AGENTS.md", "CLAUDE.md", "alwaysApply"],
    family: "rules",
    featureIds: ["project-instructions"],
    id: "project-rules",
    sourceContractIds: ["rule-frontmatter"],
    standardProfileIds: ["agent-instructions"],
    title: "Scoped project instructions",
  },
  {
    aliases: ["hooks", "hook.json"],
    family: "hooks",
    featureIds: ["adaptive-hooks"],
    id: "adaptive-hooks",
    sourceContractIds: ["adaptive-hook"],
    standardProfileIds: [],
    title: "Reusable hook behavior",
  },
  {
    aliases: ["hooks/hooks.json"],
    family: "hooks",
    featureIds: ["plugin-hooks"],
    id: "native-hooks",
    sourceContractIds: ["hook"],
    standardProfileIds: [],
    title: "Provider-native hook declarations",
  },
  {
    aliases: ["plugins", "plugin.json"],
    family: "plugins",
    featureIds: ["plugin-manifests"],
    id: "plugin-manifests",
    sourceContractIds: ["plugin-config", "source-metadata"],
    standardProfileIds: ["agent-plugins-1.0"],
    title: "Plugin identity and components",
  },
  {
    aliases: ["agents/"],
    family: "plugins",
    featureIds: ["plugin-agents"],
    id: "plugin-agents",
    sourceContractIds: ["plugin-config"],
    standardProfileIds: [],
    title: "Plugin-packaged agents",
  },
  {
    aliases: ["mcp", "mcpServers", ".mcp.json", "http_headers"],
    family: "mcp",
    featureIds: ["plugin-mcp"],
    id: "plugin-mcp",
    sourceContractIds: ["plugin-config"],
    standardProfileIds: ["agent-plugins-1.0"],
    title: "Plugin MCP servers",
  },
  {
    aliases: ["allowed-tools", "disallowed-tools", ".skillset.tools.yaml"],
    family: "mcp",
    featureIds: ["tools-policy"],
    id: "tools-policy",
    sourceContractIds: ["skill-frontmatter"],
    standardProfileIds: [],
    title: "Skill-local tool policy",
  },
  {
    aliases: ["agent-skills", "SKILL.md"],
    family: "standards",
    featureIds: [],
    id: "agent-skills-standard",
    sourceContractIds: [],
    standardProfileIds: ["agent-skills"],
    title: "Agent Skills portable baseline",
  },
  {
    aliases: ["agent-instructions", "AGENTS.md"],
    family: "standards",
    featureIds: [],
    id: "agent-instructions-standard",
    sourceContractIds: [],
    standardProfileIds: ["agent-instructions"],
    title: "Agent Instructions portable baseline",
  },
  {
    aliases: ["agent-plugins", "agent-plugins-1.0"],
    family: "standards",
    featureIds: [],
    id: "agent-plugins-standard",
    sourceContractIds: [],
    standardProfileIds: ["agent-plugins-1.0"],
    title: "Agent Plugins portable baseline",
  },
] as const satisfies readonly CapabilityDefinition[];

const capabilities: readonly CapabilityDefinition[] = Object.freeze(
  definitions
    .map((entry) =>
      Object.freeze({
        ...entry,
        aliases: Object.freeze([...entry.aliases]),
        featureIds: Object.freeze([...entry.featureIds]),
        sourceContractIds: Object.freeze([...entry.sourceContractIds]),
        standardProfileIds: Object.freeze([...entry.standardProfileIds]),
      })
    )
    .toSorted((left, right) => compareStrings(left.id, right.id))
);

export const listCapabilities = (): readonly CapabilityDefinition[] =>
  capabilities;

/** Exact aliases may name several concepts; preserve that ambiguity for callers. */
export const findCapabilities = (
  query: string
): readonly CapabilityDefinition[] => {
  const normalized = query.trim();
  return capabilities.filter(
    (entry) => entry.id === normalized || entry.aliases.includes(normalized)
  );
};

/** Validate references at the consumption boundary without introducing import-time cycles. */
export const assertCapabilityAuthorities = (): void => {
  const ids = new Set<string>();
  for (const entry of capabilities) {
    if (ids.has(entry.id)) {
      throw new Error(`skillset: duplicate capability ${entry.id}`);
    }
    ids.add(entry.id);
    for (const id of entry.featureIds) {
      if (getSkillsetFeature(id) === undefined) {
        throw new Error(
          `skillset: ${entry.id} references missing feature ${id}`
        );
      }
    }
    for (const id of entry.sourceContractIds) {
      if (!skillsetSchemaContracts.some((contract) => contract.id === id)) {
        throw new Error(
          `skillset: ${entry.id} references missing source contract ${id}`
        );
      }
    }
    for (const id of entry.standardProfileIds) {
      getStandardProfile(id);
    }
  }
};

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
  readonly implementationEvidence: readonly {
    readonly path: string;
    readonly contentHash: string;
  }[];
  readonly limitations: readonly string[];
  readonly evidence: readonly (SkillsetFeatureEvidence & {
    readonly id: string;
  })[];
  readonly standards: readonly StandardProfileId[];
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
export const capabilityAuthorityHash = (
  definition: CapabilityDefinition,
  featureId: string,
  target: TargetName
): string => {
  const feature = getSkillsetFeature(featureId);
  if (feature === undefined) {
    throw new Error(`skillset: missing capability feature ${featureId}`);
  }
  const support = feature.targetSupport[target];
  const { provider } = support;
  // Key order is part of the reviewed authority digest.
  // oxlint-disable-next-line sort-keys
  return hashCapabilityAuthority({
    feature,
    target,
    destination:
      provider?.destinationFormat === undefined
        ? null
        : getProviderDestinationFormatSnapshot(provider.destinationFormat),
    schemas: (provider?.schemaSnapshots ?? []).map((id) =>
      getProviderSchemaSnapshot(id)
    ),
    overlays: (provider?.manualOverlays ?? []).map((id) =>
      providerSchemaManualOverlays.find((overlay) => overlay.id === id)
    ),
    contracts: definition.sourceContractIds.map((id) =>
      skillsetSchemaContracts.find((contract) => contract.id === id)
    ),
    standards: definition.standardProfileIds.map((id) => {
      const profile = getStandardProfile(id);
      // oxlint-disable-next-line sort-keys
      return {
        id,
        lifecycle: profile.lifecycle,
        contentHash: profile.provenance.contentHash,
      };
    }),
  });
};

export const assessPinnedCapabilityJudgment = (
  judgment: CapabilityJudgment | undefined,
  authorityHash?: string
): CapabilityFidelityAssessment => {
  if (judgment === undefined) {
    return assessCapabilityFidelity(undefined, []);
  }
  let status: CapabilityEvidenceAssessment["status"] = "missing";
  if (authorityHash !== undefined) {
    status = authorityHash === judgment.authorityHash ? "current" : "stale";
  }
  return assessCapabilityFidelity(judgment.fidelity, [
    {
      id: `${judgment.capabilityId}:${judgment.featureId}:${judgment.target}`,
      scope: judgment.scope,
      status,
    },
  ]);
};

// These narrow judgments were reviewed against the pinned authorities and the
// named compiler regressions. Updating an authority hash requires reviewing the
// semantics again; never regenerate these hashes merely to restore a verdict.
const judgments: readonly CapabilityJudgment[] = [
  {
    authorityHash:
      "sha256:f75055451ba906f201a1000360ac42e05696f5b5e3bc547c1bac66eb26b76fa9",
    capabilityId: "skill-invocation",
    featureId: "skill-invocation-policy",
    fidelity: "exact",
    implementationPaths: [
      "packages/core/src/render-codex-skill-sidecars.ts",
      "packages/core/src/skill-policy.ts",
      "packages/core/src/__tests__/skill-invocation-policy.test.ts",
      "docs/reference/features/skills.md",
    ],
    limitations: [
      "Scope is invocation eligibility only, not model compliance or user invocation. Explicit provider overrides are outside this judgment.",
    ],
    scope:
      "The resolved implicit_invocation boolean is represented directly as policy.allow_implicit_invocation in agents/openai.yaml.",
    target: "codex",
  },
  {
    authorityHash:
      "sha256:881316c3151aa8e4da5994858106862812011cdb4314968051d1c1f09a5adc68",
    capabilityId: "skill-invocation",
    featureId: "skill-invocation-policy",
    fidelity: "equivalent",
    implementationPaths: [
      "packages/core/src/render.ts",
      "packages/core/src/skill-policy.ts",
      "packages/core/src/__tests__/skill-invocation-policy.test.ts",
      "docs/reference/features/skills.md",
    ],
    limitations: [
      "Scope is invocation eligibility only; this does not disable explicit user invocation or prove runtime enforcement. Explicit provider overrides are outside this judgment.",
    ],
    scope:
      "The resolved implicit_invocation boolean is inverted into disable-model-invocation; false eligibility becomes true disablement and vice versa.",
    target: "claude",
  },
  {
    authorityHash:
      "sha256:9ef3d5e5bfab312cb15b3d4455ff914c136c78223e70c0d0aa87dcc9096b5601",
    capabilityId: "project-agents",
    featureId: "project-agents",
    fidelity: "partial",
    implementationPaths: [
      "packages/core/src/render.ts",
      "packages/core/src/project-agent-skills.ts",
      "packages/core/src/__tests__/project-agent-skills.test.ts",
      "apps/skillset/src/__tests__/skillset.test.ts",
      "docs/reference/features/agents.md",
    ],
    limitations: [
      "The skills preface is advisory, not target-enforced skill metadata. Provider-only fields require explicit provider configuration.",
    ],
    scope:
      "Project-agent name, description and instructions receive native TOML fields; shared skill-loading intent is only an instruction preface.",
    target: "codex",
  },
  {
    authorityHash:
      "sha256:bbeafbbf025b130dafbeb55deeaaad150e64ed7c7e58543e4269a3de7bd9bd40",
    capabilityId: "project-rules",
    featureId: "project-instructions",
    fidelity: "synthesized",
    implementationPaths: [
      "packages/core/src/render-rules.ts",
      "packages/core/src/render-standard-instructions.ts",
      "packages/core/src/__tests__/render-standard-instructions.test.ts",
      "apps/skillset/src/__tests__/authoring-model-rules.test.ts",
      "docs/reference/features/rules.md",
    ],
    limitations: [
      "This judgment excludes paths narrowing, which is degraded, and wildcard scopes, which are unsupported. It describes generated files only. Native context limits and AGENTS.override.md shadowing still apply.",
    ],
    scope:
      "Generated rules with literal directory scope and no paths narrowing are combined in deterministic source-path order into the directory AGENTS.md.",
    target: "codex",
  },
  {
    authorityHash:
      "sha256:69cdb29880ac838f610030b9a714229efeb9fa034c35cd909426e1a0f5ac65fd",
    capabilityId: "native-hooks",
    featureId: "plugin-hooks",
    fidelity: "provider-only",
    implementationPaths: [
      "packages/core/src/hooks.ts",
      "packages/core/src/render-hooks.ts",
      "packages/core/src/hook-capabilities.ts",
      "docs/reference/features/hooks.md",
    ],
    limitations: [
      "The declaration is provider-native; identically spelled events on other providers do not establish equivalence. Use adaptive hooks for explicitly supported adaptation.",
    ],
    scope:
      "Claude-native plugin hook declarations retain Claude event and handler semantics through validated pass-through.",
    target: "claude",
  },
  {
    authorityHash:
      "sha256:2f53e3b41d9d118724b6c36a899dfb54c0eff3d52bb66fbc0f9f532fa16fccb0",
    capabilityId: "plugin-agents",
    featureId: "plugin-agents",
    fidelity: "unavailable",
    implementationPaths: [
      "packages/core/src/render.ts",
      "apps/skillset/src/__tests__/skillset.test.ts",
      "docs/reference/features/agents.md",
    ],
    limitations: [
      "This is a plugin-packaging limitation. It does not mean Codex project agents are unavailable.",
    ],
    scope:
      "The pinned Codex plugin contract has no plugin agents component; Skillset cannot faithfully emit plugin-packaged agents there.",
    target: "codex",
  },
];

/** Reviewed implementation content; the crosswalk regression gate rejects drift. */
export const CAPABILITY_IMPLEMENTATION_EVIDENCE = [
  {
    contentHash:
      "sha256:6e0a1024c6eefc5c2edd4ffd67cc41ee48f869d4ed0213e3075152685aaafbeb",
    path: "apps/skillset/src/__tests__/authoring-model-rules.test.ts",
  },
  {
    contentHash:
      "sha256:528aa89a64e4db437acacd5cb85c1cbe4f36e20f6fed380a68a4bf535863e1d1",
    path: "packages/core/src/render-codex-skill-sidecars.ts",
  },
  {
    contentHash:
      "sha256:363e45eb80ade28ac14e4272987ac0269cbcf4d239cd117aadc4975b697ff5fd",
    path: "packages/core/src/render.ts",
  },
  {
    contentHash:
      "sha256:a3de6ef0d5e691ec12f53d5f7d66965b38c25d54e79ace39c500e7c3072f7715",
    path: "packages/core/src/skill-policy.ts",
  },
  {
    contentHash:
      "sha256:3cd2a7199c8e64f49162939376a017052aa011404455482adda7e3b3f6240561",
    path: "packages/core/src/__tests__/skill-invocation-policy.test.ts",
  },
  {
    contentHash:
      "sha256:61ec143b8422d29aa96334d1ece03d4d12c7d874087a95f2762595644980a281",
    path: "packages/core/src/project-agent-skills.ts",
  },
  {
    contentHash:
      "sha256:e491ac044e0b72d701ff3cf6dc2d5ebc5c69cd87ee8212ae433534118f6336e0",
    path: "packages/core/src/__tests__/project-agent-skills.test.ts",
  },
  {
    contentHash:
      "sha256:3de8e1facabf580e6cccf1ca4e6736f5c286d1e54fd8fefb235d7a17793c88d3",
    path: "apps/skillset/src/__tests__/skillset.test.ts",
  },
  {
    contentHash:
      "sha256:4f38ecdcfeee9d7d6514c8ad8fedbdd4549d6c90b835851bdcc7f98935f54b9c",
    path: "packages/core/src/render-rules.ts",
  },
  {
    contentHash:
      "sha256:9c45bc3e9b12b5540ac503d2c867a44bac29c6448a8a2ae18eada6182dce1f98",
    path: "packages/core/src/render-standard-instructions.ts",
  },
  {
    contentHash:
      "sha256:ea2548155b937c075f2d7b5aaf105866ff36a92bee277cba3d812fd94a8297f2",
    path: "packages/core/src/__tests__/render-standard-instructions.test.ts",
  },
  {
    contentHash:
      "sha256:8659ebcef8468a700f3240075b2f6128fd21cccd2364379734e7057239d75d70",
    path: "packages/core/src/hooks.ts",
  },
  {
    contentHash:
      "sha256:b5ef546bae66dad2a96fd764f240512169d4ea9e23c9932a486be1958ab973b1",
    path: "packages/core/src/render-hooks.ts",
  },
  {
    contentHash:
      "sha256:e826d394225da940ec7693ebf4887feb4f0e94d9c482bfa5961e97d0afc36fa1",
    path: "packages/core/src/hook-capabilities.ts",
  },
  {
    contentHash:
      "sha256:5ac78a6a9907b6528aa04e5450e852791fccd3e201798ffa500e8e7fc3d8bf27",
    path: "docs/reference/features/skills.md",
  },
  {
    contentHash:
      "sha256:7671e005dffba571ccf0e00f75f99d57a2d6086adb45c38012c0ce67e8ebab7a",
    path: "docs/reference/features/agents.md",
  },
  {
    contentHash:
      "sha256:cc350c2a78ca9dce118a13bd04bf3f1924e99dccf01f4accd68e2d5944418adf",
    path: "docs/reference/features/rules.md",
  },
  {
    contentHash:
      "sha256:c32bf59ee8a5c3df4dc5fe90cef9cf44368fbb276b3e81666d4f230daf13fe4f",
    path: "docs/reference/features/hooks.md",
  },
] as const;

/** Join current authorities without converting structural support into semantics. */
export const compareCapability = (
  definition: CapabilityDefinition,
  targets: readonly TargetName[]
): readonly CapabilityComparison[] => {
  assertCapabilityAuthorities();
  const featureIds = [
    ...new Set([
      ...definition.featureIds,
      ...(definition.family === "standards"
        ? definition.standardProfileIds.flatMap((id) =>
            getStandardProfile(id).envelopes.map(
              (envelope) => envelope.featureId
            )
          )
        : []),
    ]),
  ].toSorted(compareStrings);
  return featureIds.flatMap((featureId) => {
    const feature = getSkillsetFeature(featureId);
    if (feature === undefined) {
      throw new Error(`skillset: missing crosswalk feature ${featureId}`);
    }
    return [...new Set(targets)]
      .toSorted(compareStrings)
      .map((target): CapabilityComparison => {
        const support = feature.targetSupport[target];
        const destinationId = support.provider?.destinationFormat;
        const destination =
          destinationId === undefined
            ? undefined
            : getProviderDestinationFormatSnapshot(destinationId);
        const evidence = [
          ...new Map(
            [...feature.evidence, ...(support.evidence ?? [])].map((item) => {
              const id = `${item.kind}:${item.ref}`;
              return [id, { ...item, id }] as const;
            })
          ).values(),
        ].toSorted((left, right) => compareStrings(left.id, right.id));
        const authorityHash = capabilityAuthorityHash(
          definition,
          featureId,
          target
        );
        const judgment = judgments.find(
          (entry) =>
            entry.capabilityId === definition.id &&
            entry.featureId === featureId &&
            entry.target === target
        );
        const assessment = assessPinnedCapabilityJudgment(
          judgment,
          authorityHash
        );
        return {
          authorityHash,
          canonical: {
            contracts: definition.sourceContractIds,
            shape: feature.sourceShape,
          },
          capabilityId: definition.id,
          ...(destination === undefined ? {} : { destination }),
          evidence,
          featureId,
          fidelity: assessment.fidelity,
          implementationEvidence:
            judgment === undefined
              ? []
              : CAPABILITY_IMPLEMENTATION_EVIDENCE.filter(({ path }) =>
                  judgment.implementationPaths.includes(path)
                ),
          limitations: [
            ...assessment.reasons,
            ...(assessment.fidelity === "unknown"
              ? []
              : (judgment?.limitations ?? [])),
            ...(support.reason === undefined ? [] : [support.reason]),
          ],
          ...(support.provider === undefined
            ? {}
            : { providerEvidence: support.provider }),
          realization: {
            description: support.note ?? feature.summary,
            destinationSupport: support.status,
            owner: feature.renderOwner,
          },
          ...(judgment !== undefined && assessment.fidelity !== "unknown"
            ? { semanticScope: judgment.scope }
            : {}),
          standards: definition.standardProfileIds,
          target,
          title: definition.title,
        };
      });
  });
};
