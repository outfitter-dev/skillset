import { SkillsetRenderResultError, type SkillsetRenderResult } from "./render-result";
import type { UnsupportedDestinationPolicy } from "./types";

export function enforceRenderResultPolicy(
  renderResults: readonly SkillsetRenderResult[],
  unsupportedPolicy: UnsupportedDestinationPolicy
): void {
  const blocked = renderResults.filter(isPolicyBlockingOutcome);
  if (blocked.length === 0) return;

  throw new SkillsetRenderResultError(
    formatRenderResultPolicyError(blocked, unsupportedPolicy),
    blocked
  );
}

function isPolicyBlockingOutcome(outcome: SkillsetRenderResult): boolean {
  return outcome.status === "failed" || outcome.status === "lossy" || outcome.status === "unsupported";
}

function formatRenderResultPolicyError(
  outcomes: readonly SkillsetRenderResult[],
  unsupportedPolicy: UnsupportedDestinationPolicy
): string {
  const noun = outcomes.length === 1 ? "render result" : "render results";
  return [
    `skillset: unsupported destination policy blocked ${outcomes.length} ${noun} (compile.unsupportedDestination: ${unsupportedPolicy})`,
    ...outcomes.map(formatBlockedOutcome),
  ].join("\n");
}

function formatBlockedOutcome(outcome: SkillsetRenderResult): string {
  const target = outcome.target ?? "workspace";
  const sourcePath = outcome.sourcePath ?? "<unknown source path>";
  const policy = outcome.policy ?? "default";
  const reason = outcome.reason ?? "no reason recorded";
  return [
    `- ${sourcePath}: ${target} ${outcome.featureId} ${outcome.status} (${outcome.sourceUnit})`,
    `  reason: ${reason}`,
    `  policy: ${policy}`,
    `  suggestion: ${suggestionForBlockedOutcome(outcome)}`,
  ].join("\n");
}

function suggestionForBlockedOutcome(outcome: SkillsetRenderResult): string {
  if (outcome.target === "codex" && outcome.featureId === "adaptive-hooks") {
    return "scope the hook attachment to Claude with providers, disable Codex for this source, or wait for a documented Codex hook destination";
  }
  if (outcome.target === "codex" && outcome.featureId === "plugin-agents") {
    return "set codex: false for the plugin, move portable project agents to .skillset/src/agents, or keep Claude-only files in Claude provider source";
  }
  if (outcome.target === "codex" && outcome.featureId === "plugin-bin") {
    return "set bin: false, set codex: false for the plugin, remove Codex plugin output selection, or keep executable helpers in Claude provider source";
  }
  return "scope the command away from this source, disable the unsupported target for this source, or move provider-specific files into provider source";
}
