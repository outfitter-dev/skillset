export type StandardCompatibilityId = "mcp-skills-extension";

export type StandardLifecycleStatus = "adopted" | "candidate" | "retired";

export interface StandardCompatibilitySource {
  readonly note?: string;
  readonly url: string;
}

export interface StandardCompatibilityEntry {
  readonly contentHash: `sha256:${string}`;
  readonly extensionId: string;
  readonly id: StandardCompatibilityId;
  readonly limits: {
    readonly maxResourcesPerSkill: number;
    readonly maxTotalResourceBytesPerSkill: number;
  };
  readonly observedAt: string;
  readonly optionalMethods: readonly string[];
  readonly protocolRevision: string;
  readonly proposal: string;
  readonly requiredMethods: readonly string[];
  readonly revision: string;
  readonly skillFormat: {
    readonly directoryNameMatchesSkillName: boolean;
    readonly name: string;
  };
  readonly sources: readonly StandardCompatibilitySource[];
  readonly status: StandardLifecycleStatus;
}

export type StandardConsumerProfileId = "openai-plugin-submission-skill-import";

export interface StandardConsumerProfile {
  readonly consumer: string;
  readonly id: StandardConsumerProfileId;
  readonly limitations: readonly string[];
  readonly limits: {
    readonly maxArchiveBytesPerScan: number;
    readonly maxCatalogPagesPerScan: number;
    readonly maxResourcesPerSkill: number;
    readonly maxSkillMarkdownBytes: number;
    readonly maxSkillsPerScan: number;
    readonly maxSupportingFileBytes: number;
    readonly maxTotalResourceBytesPerSkill: number;
  };
  readonly mode: "submission-snapshot";
  readonly observedAt: string;
  readonly source: StandardCompatibilitySource;
  readonly standardId: StandardCompatibilityId;
}

export interface StandardCompatibilityRegistry {
  readonly consumers: readonly StandardConsumerProfile[];
  readonly standards: readonly StandardCompatibilityEntry[];
}

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
};

const assertIdentifier = (value: string, label: string): void => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new Error(`skillset: invalid ${label} ${value}`);
  }
};

const assertRequiredText = (value: string, label: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`skillset: ${label} is required`);
  }
};

const assertObservedDate = (value: string, label: string): void => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`skillset: ${label} has invalid observation date ${value}`);
  }
};

const assertSource = (
  source: StandardCompatibilitySource,
  label: string
): void => {
  let parsed: URL;
  try {
    parsed = new URL(source.url);
  } catch {
    throw new Error(`skillset: ${label} requires an HTTPS source URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error(`skillset: ${label} requires an HTTPS source URL`);
  }
};

const assertPositiveLimits = (limits: object, label: string): void => {
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value <= 0
    )
  ) {
    throw new Error(`skillset: ${label} requires positive integer limits`);
  }
};

const assertMethodSets = (entry: StandardCompatibilityEntry): void => {
  const required = new Set(entry.requiredMethods);
  const optional = new Set(entry.optionalMethods);
  if (
    required.size === 0 ||
    required.size !== entry.requiredMethods.length ||
    optional.size !== entry.optionalMethods.length ||
    entry.requiredMethods.some((method) => optional.has(method))
  ) {
    throw new Error(
      `skillset: standard compatibility entry ${entry.id} requires unique, non-empty required methods disjoint from optional methods`
    );
  }
};

export const assertStandardCompatibilityRegistry = (
  registry: StandardCompatibilityRegistry
): void => {
  const standardsById = new Map<string, StandardCompatibilityEntry>();
  for (const entry of registry.standards) {
    assertIdentifier(entry.id, "standard compatibility ID");
    if (standardsById.has(entry.id)) {
      throw new Error(
        `skillset: duplicate standard compatibility ID ${entry.id}`
      );
    }
    standardsById.set(entry.id, entry);
    if (
      !(["adopted", "candidate", "retired"] as const).includes(entry.status)
    ) {
      throw new Error(
        `skillset: standard compatibility entry ${entry.id} has invalid status ${entry.status}`
      );
    }
    assertRequiredText(
      entry.extensionId,
      `standard compatibility entry ${entry.id} extensionId`
    );
    assertRequiredText(
      entry.proposal,
      `standard compatibility entry ${entry.id} proposal`
    );
    assertRequiredText(
      entry.protocolRevision,
      `standard compatibility entry ${entry.id} protocolRevision`
    );
    assertRequiredText(
      entry.skillFormat.name,
      `standard compatibility entry ${entry.id} skill format name`
    );
    if (!/^[a-f0-9]{40}$/u.test(entry.revision)) {
      throw new Error(
        `skillset: standard compatibility entry ${entry.id} requires a full immutable revision`
      );
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(entry.contentHash)) {
      throw new Error(
        `skillset: standard compatibility entry ${entry.id} requires an exact SHA-256 content hash`
      );
    }
    assertObservedDate(
      entry.observedAt,
      `standard compatibility entry ${entry.id}`
    );
    if (entry.sources.length === 0) {
      throw new Error(
        `skillset: standard compatibility entry ${entry.id} requires source evidence`
      );
    }
    for (const source of entry.sources) {
      assertSource(source, `standard compatibility entry ${entry.id}`);
    }
    assertPositiveLimits(
      entry.limits,
      `standard compatibility entry ${entry.id}`
    );
    assertMethodSets(entry);
  }

  const consumerIds = new Set<string>();
  for (const profile of registry.consumers) {
    assertIdentifier(profile.id, "standard consumer profile ID");
    if (consumerIds.has(profile.id)) {
      throw new Error(
        `skillset: duplicate standard consumer profile ID ${profile.id}`
      );
    }
    consumerIds.add(profile.id);
    const standard = standardsById.get(profile.standardId);
    if (standard === undefined) {
      throw new Error(
        `skillset: standard consumer profile ${profile.id} references missing standard ${profile.standardId}`
      );
    }
    if (profile.mode !== "submission-snapshot") {
      throw new Error(
        `skillset: standard consumer profile ${profile.id} requires submission-snapshot mode`
      );
    }
    assertRequiredText(
      profile.consumer,
      `standard consumer profile ${profile.id} consumer`
    );
    assertObservedDate(
      profile.observedAt,
      `standard consumer profile ${profile.id}`
    );
    assertSource(profile.source, `standard consumer profile ${profile.id}`);
    assertPositiveLimits(
      profile.limits,
      `standard consumer profile ${profile.id}`
    );
    if (
      profile.limits.maxResourcesPerSkill > standard.limits.maxResourcesPerSkill
    ) {
      throw new Error(
        `skillset: standard consumer profile ${profile.id} exceeds standard ${standard.id} resource bounds`
      );
    }
    if (
      profile.limits.maxTotalResourceBytesPerSkill >
      standard.limits.maxTotalResourceBytesPerSkill
    ) {
      throw new Error(
        `skillset: standard consumer profile ${profile.id} exceeds standard ${standard.id} byte bounds`
      );
    }
  }
};

export const defineStandardCompatibilityRegistry = (
  registry: StandardCompatibilityRegistry
): StandardCompatibilityRegistry => {
  assertStandardCompatibilityRegistry(registry);
  return deepFreeze({
    consumers: registry.consumers
      .map((profile) => ({
        ...profile,
        limitations: [...profile.limitations],
        limits: { ...profile.limits },
        source: { ...profile.source },
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    standards: registry.standards
      .map((entry) => ({
        ...entry,
        limits: { ...entry.limits },
        optionalMethods: [...entry.optionalMethods],
        requiredMethods: [...entry.requiredMethods],
        skillFormat: { ...entry.skillFormat },
        sources: entry.sources.map((source) => ({ ...source })),
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  });
};

const standardEntries = [
  {
    contentHash:
      "sha256:4a3bc38e896b151494e7c2af47d3b877e58dbdd26aafe8646873953f7f2bd8b9",
    extensionId: "io.modelcontextprotocol/skills",
    id: "mcp-skills-extension",
    limits: {
      maxResourcesPerSkill: 512,
      maxTotalResourceBytesPerSkill: 16 * 1024 * 1024,
    },
    observedAt: "2026-09-11",
    optionalMethods: ["resources/directory/read"],
    proposal: "SEP-2640",
    protocolRevision: "2026-07-28",
    requiredMethods: ["resources/read", "skills/get", "skills/list"],
    revision: "d866efdba298b55b8156c7b7aa1bdebc1b625f4c",
    skillFormat: {
      directoryNameMatchesSkillName: true,
      name: "Agent Skills",
    },
    sources: [
      {
        note: "Immutable independently published extension specification. This supersedes the older 753b9f2 PR draft pin as contract evidence.",
        url: "https://github.com/modelcontextprotocol/ext-skills/blob/d866efdba298b55b8156c7b7aa1bdebc1b625f4c/specification/stable/skills.mdx",
      },
      {
        note: "Proposal and lifecycle discussion; the PR remained open and unmerged when observed.",
        url: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640",
      },
    ],
    status: "candidate",
  },
] as const satisfies readonly StandardCompatibilityEntry[];

const consumerProfiles = [
  {
    consumer: "OpenAI plugin submission",
    id: "openai-plugin-submission-skill-import",
    limitations: [
      "Imports are submission-time snapshots, not live runtime skill discovery.",
      "The importer implements a bounded static subset of the MCP Skills extension.",
      "The documented resource example includes URI and digest but omits the extension specification's required size field.",
      "If any skill entry fails validation, tool discovery can still succeed while the draft's imported skills remain unchanged.",
    ],
    limits: {
      maxArchiveBytesPerScan: 8 * 1024 * 1024,
      maxCatalogPagesPerScan: 10,
      maxResourcesPerSkill: 100,
      maxSkillMarkdownBytes: 256 * 1024,
      maxSkillsPerScan: 5,
      maxSupportingFileBytes: 1024 * 1024,
      maxTotalResourceBytesPerSkill: 5 * 1024 * 1024,
    },
    mode: "submission-snapshot",
    observedAt: "2026-09-11",
    source: {
      note: "Current OpenAI plugin-submission importer documentation.",
      url: "https://developers.openai.com/plugins/build/mcp-server#import-skills-from-the-mcp-server",
    },
    standardId: "mcp-skills-extension",
  },
] as const satisfies readonly StandardConsumerProfile[];

export const standardCompatibilityRegistry =
  defineStandardCompatibilityRegistry({
    consumers: consumerProfiles,
    standards: standardEntries,
  });

export const standardCompatibilityEntries =
  standardCompatibilityRegistry.standards;

export const standardConsumerProfiles = standardCompatibilityRegistry.consumers;

export const getStandardCompatibilityEntry = (
  id: StandardCompatibilityId
): StandardCompatibilityEntry => {
  const entry = standardCompatibilityEntries.find(
    (candidate) => candidate.id === id
  );
  if (entry === undefined) {
    throw new Error(`skillset: missing standard compatibility entry ${id}`);
  }
  return entry;
};

export const getStandardConsumerProfile = (
  id: StandardConsumerProfileId
): StandardConsumerProfile => {
  const profile = standardConsumerProfiles.find(
    (candidate) => candidate.id === id
  );
  if (profile === undefined) {
    throw new Error(`skillset: missing standard consumer profile ${id}`);
  }
  return profile;
};
