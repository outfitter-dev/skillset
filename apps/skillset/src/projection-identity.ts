import type { StandardProfileStatus } from "@skillset/core";
import type {
  GeneratedEntry,
  ProjectionConsumer,
  ProjectionOwner,
} from "@skillset/core/internal/types";

interface RenderResultIdentity {
  readonly standardProfile?: string;
  readonly target?: string;
}

export function formatGeneratedEntryIdentity(entry: GeneratedEntry): string {
  const consumers = entry.consumers ?? [];
  if (consumers.length === 0) return legacyEntryIdentity(entry);
  const hasStandardBaseline = consumers.some(
    (consumer) => "standardProfile" in consumer
  );
  return consumers
    .map((consumer) =>
      formatProjectionConsumer(consumer, hasStandardBaseline)
    )
    .join(" + ");
}

export function formatGeneratedEntryOwner(
  owner: ProjectionOwner | undefined,
  consumers: readonly ProjectionConsumer[] = []
): string | undefined {
  if (owner === undefined) return undefined;
  return "standardProfile" in owner
    ? `${owner.standardProfile} baseline`
    : consumers.some((consumer) => "standardProfile" in consumer)
      ? `${owner.target} delta`
      : owner.target;
}

export function formatProjectionConsumer(
  consumer: ProjectionConsumer,
  hasStandardBaseline = false
): string {
  return "standardProfile" in consumer
    ? `${consumer.standardProfile} baseline`
    : hasStandardBaseline
      ? `${consumer.target} delta`
      : consumer.target;
}

export function formatRenderResultIdentity(
  result: RenderResultIdentity
): string {
  if (result.standardProfile !== undefined) {
    return `${result.standardProfile} baseline`;
  }
  return result.target ?? "workspace";
}

export function generatedEntryIdentityKeys(
  entry: GeneratedEntry
): readonly string[] {
  if (entry.consumers !== undefined && entry.consumers.length > 0) {
    const hasStandardBaseline = entry.consumers.some(
      (consumer) => "standardProfile" in consumer
    );
    return entry.consumers.map((consumer) =>
      formatProjectionConsumer(consumer, hasStandardBaseline)
    );
  }
  const legacy = legacyEntryIdentity(entry);
  return legacy === "workspace" ? [] : [legacy];
}

export function formatStandardProfileSummary(
  profiles: readonly StandardProfileStatus[]
): string {
  const active = profiles.filter((profile) => profile.active);
  const inactive = profiles.filter((profile) => !profile.active);
  const activeText =
    active.length === 0
      ? "none"
      : active.map((profile) => `${profile.id} (${profile.scope})`).join(", ");
  const inactiveText = inactive
    .map((profile) => `${profile.id} ${profile.lifecycle}`)
    .join(", ");
  return `active ${activeText}${inactiveText.length === 0 ? "" : `; registry ${inactiveText}`}`;
}

function legacyEntryIdentity(entry: GeneratedEntry): string {
  const output = entry.outputPath;
  if (output.startsWith(".claude/") || output.includes("/claude/")) {
    return "claude";
  }
  if (
    output.startsWith(".agents/") ||
    output.startsWith(".codex/") ||
    output.includes("/codex/") ||
    output.includes("/chatgpt/")
  ) {
    return "codex";
  }
  if (output.startsWith(".cursor/") || output.includes("/cursor/")) {
    return "cursor";
  }
  return entry.target === "workspace" ? "workspace" : entry.target;
}
