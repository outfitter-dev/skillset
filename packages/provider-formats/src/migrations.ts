import type {
  ProviderDestinationFormatSnapshotId,
  ProviderDestinationFormatTarget,
} from "./index";

export const PROVIDER_FORMAT_MIGRATION_SAFETY_VALUES = [
  "compatible",
  "adapter-only",
  "source-migration",
  "unsupported-drift",
  "manual-review",
] as const;

export type ProviderFormatMigrationSafety = (typeof PROVIDER_FORMAT_MIGRATION_SAFETY_VALUES)[number];

export interface ProviderFormatMigrationEntry {
  readonly appliesTo: readonly ProviderDestinationFormatSnapshotId[];
  readonly description: string;
  readonly from: string;
  readonly id: string;
  readonly previewable: boolean;
  readonly provider: ProviderDestinationFormatTarget;
  readonly requiresConfirmation: boolean;
  readonly safe: boolean;
  readonly safety: ProviderFormatMigrationSafety;
  readonly sourcePreserving: boolean;
  readonly surface: string;
  readonly to: string;
  readonly updatePath: "none" | "adapter" | "source" | "manual";
}

export interface ProviderFormatMigrationQuery {
  readonly from: string;
  readonly provider: ProviderDestinationFormatTarget;
  readonly snapshotId: ProviderDestinationFormatSnapshotId;
  readonly surface: string;
  readonly to: string;
}

export type ProviderFormatMigrationSelection =
  | {
    readonly entry: ProviderFormatMigrationEntry;
    readonly kind: "matched";
  }
  | {
    readonly kind: "manual-review";
    readonly previewable: false;
    readonly reason: string;
    readonly requiresConfirmation: true;
    readonly safe: false;
    readonly safety: "manual-review";
    readonly sourcePreserving: true;
    readonly updatePath: "manual";
  };

const PROVIDER_FORMAT_MIGRATION_SNAPSHOTS: Record<
  ProviderDestinationFormatSnapshotId,
  { readonly provider: ProviderDestinationFormatTarget; readonly surface: string }
> = {
  "claude-hooks": { provider: "claude", surface: "hooks" },
  "claude-plugin": { provider: "claude", surface: "plugin" },
  "claude-skill": { provider: "claude", surface: "skill" },
  "claude-subagent": { provider: "claude", surface: "agent" },
  "codex-agents-md": { provider: "codex", surface: "instructions" },
  "codex-plugin": { provider: "codex", surface: "plugin" },
  "codex-skill": { provider: "codex", surface: "skill" },
  "codex-subagent": { provider: "codex", surface: "agent" },
};

const PROVIDER_FORMAT_MIGRATION_TARGETS = new Set<ProviderDestinationFormatTarget>(
  Object.values(PROVIDER_FORMAT_MIGRATION_SNAPSHOTS).map((snapshot) => snapshot.provider)
);

const migrations = [
  migration({
    appliesTo: ["claude-skill"],
    description: "Claude skill frontmatter remains compatible with the adopted snapshot.",
    from: "2026-06-23T09:31:27-04:00",
    id: "claude-skill-2026-06-23-compatible",
    previewable: true,
    provider: "claude",
    requiresConfirmation: false,
    safe: true,
    safety: "compatible",
    sourcePreserving: true,
    surface: "skill",
    to: "2026-06-23T09:31:27-04:00",
    updatePath: "none",
  }),
  migration({
    appliesTo: ["codex-plugin"],
    description: "Codex plugin manifests can derive dotted relative component paths during rendering.",
    from: "2026-06-23T09:31:27-04:00",
    id: "codex-plugin-component-paths-adapter-update",
    previewable: true,
    provider: "codex",
    requiresConfirmation: false,
    safe: true,
    safety: "adapter-only",
    sourcePreserving: true,
    surface: "plugin",
    to: "2026-06-23T09:31:27-04:00+adapter-paths",
    updatePath: "adapter",
  }),
  migration({
    appliesTo: ["codex-subagent"],
    description: "Codex custom-agent TOML source changes require maintainer review before rewriting source.",
    from: "2026-06-23T09:31:27-04:00",
    id: "codex-subagent-toml-manual-review",
    previewable: true,
    provider: "codex",
    requiresConfirmation: true,
    safe: false,
    safety: "manual-review",
    sourcePreserving: true,
    surface: "agent",
    to: "manual-review",
    updatePath: "manual",
  }),
] as const satisfies readonly ProviderFormatMigrationEntry[];

export const providerFormatMigrations = defineProviderFormatMigrations(migrations);

export function defineProviderFormatMigrations(
  entries: readonly ProviderFormatMigrationEntry[]
): readonly ProviderFormatMigrationEntry[] {
  assertProviderFormatMigrations(entries);
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

export function listProviderFormatMigrations(): readonly ProviderFormatMigrationEntry[] {
  return providerFormatMigrations;
}

export function selectProviderFormatMigration(
  query: ProviderFormatMigrationQuery
): ProviderFormatMigrationSelection {
  const entry = providerFormatMigrations.find((candidate) =>
    candidate.provider === query.provider &&
    candidate.appliesTo.includes(query.snapshotId) &&
    candidate.surface === query.surface &&
    candidate.from === query.from &&
    candidate.to === query.to
  );
  if (entry !== undefined) {
    return { entry, kind: "matched" };
  }
  return {
    kind: "manual-review",
    previewable: false,
    reason: `No safe migration is registered for ${query.provider} ${query.surface} from ${query.from} to ${query.to}.`,
    requiresConfirmation: true,
    safe: false,
    safety: "manual-review",
    sourcePreserving: true,
    updatePath: "manual",
  };
}

export function assertProviderFormatMigrations(
  entries: readonly ProviderFormatMigrationEntry[]
): void {
  const ids = new Set<string>();
  const selectionKeys = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`skillset: duplicate provider format migration ${entry.id}`);
    ids.add(entry.id);
    if (!PROVIDER_FORMAT_MIGRATION_TARGETS.has(entry.provider)) {
      throw new Error(`skillset: unsupported provider format migration provider ${entry.provider}`);
    }
    if (!PROVIDER_FORMAT_MIGRATION_SAFETY_VALUES.includes(entry.safety)) {
      throw new Error(`skillset: unsupported provider format migration safety ${entry.safety}`);
    }
    if (entry.appliesTo.length === 0) {
      throw new Error(`skillset: provider format migration ${entry.id} must reference at least one snapshot`);
    }
    assertProviderFormatMigrationSafety(entry);
    for (const snapshotId of entry.appliesTo) {
      const snapshot = PROVIDER_FORMAT_MIGRATION_SNAPSHOTS[snapshotId];
      if (snapshot === undefined) {
        throw new Error(`skillset: provider format migration ${entry.id} references unknown snapshot ${snapshotId}`);
      }
      if (snapshot.provider !== entry.provider || snapshot.surface !== entry.surface) {
        throw new Error(
          `skillset: provider format migration ${entry.id} snapshot ${snapshotId} is ${snapshot.provider}:${snapshot.surface}, not ${entry.provider}:${entry.surface}`
        );
      }
      const selectionKey = [
        entry.provider,
        snapshotId,
        entry.surface,
        entry.from,
        entry.to,
      ].join("\0");
      if (selectionKeys.has(selectionKey)) {
        throw new Error(`skillset: duplicate provider format migration selection key for ${entry.provider} ${entry.surface} ${snapshotId} ${entry.from} -> ${entry.to}`);
      }
      selectionKeys.add(selectionKey);
    }
  }
}

function assertProviderFormatMigrationSafety(entry: ProviderFormatMigrationEntry): void {
  if (entry.safety === "compatible") {
    if (entry.updatePath !== "none") {
      throw new Error(`skillset: compatible provider format migration ${entry.id} must not rewrite anything`);
    }
    if (!entry.safe || !entry.previewable || !entry.sourcePreserving || entry.requiresConfirmation) {
      throw new Error(`skillset: compatible provider format migration ${entry.id} must be safe, previewable, source-preserving, and confirmation-free`);
    }
    return;
  }
  if (entry.safety === "adapter-only") {
    if (entry.updatePath !== "adapter" || !entry.safe || !entry.previewable || !entry.sourcePreserving || entry.requiresConfirmation) {
      throw new Error(`skillset: adapter-only provider format migration ${entry.id} must be safe, previewable, source-preserving, confirmation-free, and adapter-scoped`);
    }
    return;
  }
  if (entry.safety === "source-migration") {
    if (entry.updatePath !== "source" || !entry.safe || !entry.previewable || !entry.sourcePreserving) {
      throw new Error(`skillset: source provider format migration ${entry.id} must be safe, previewable, source-preserving, and source-scoped`);
    }
    return;
  }
  if (entry.safety === "unsupported-drift" || entry.safety === "manual-review") {
    if (entry.safe || !entry.requiresConfirmation || entry.updatePath !== "manual") {
      throw new Error(`skillset: manual provider format migration ${entry.id} must be unsafe, confirmation-required, and manual-scoped`);
    }
    return;
  }
}

function migration(entry: ProviderFormatMigrationEntry): ProviderFormatMigrationEntry {
  return entry;
}
