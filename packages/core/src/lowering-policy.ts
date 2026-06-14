import { SkillsetLoweringError, type SkillsetLoweringOutcome } from "./lowering-outcome";
import type { CompileUnsupportedPolicy } from "./types";

export function enforceLoweringOutcomePolicy(
  loweringOutcomes: readonly SkillsetLoweringOutcome[],
  unsupportedPolicy: CompileUnsupportedPolicy
): void {
  const blocked = loweringOutcomes.filter(isPolicyBlockingOutcome);
  if (blocked.length === 0) return;

  throw new SkillsetLoweringError(
    formatLoweringPolicyError(blocked, unsupportedPolicy),
    blocked
  );
}

function isPolicyBlockingOutcome(outcome: SkillsetLoweringOutcome): boolean {
  return outcome.status === "failed" || outcome.status === "lossy" || outcome.status === "unsupported";
}

function formatLoweringPolicyError(
  outcomes: readonly SkillsetLoweringOutcome[],
  unsupportedPolicy: CompileUnsupportedPolicy
): string {
  const noun = outcomes.length === 1 ? "outcome" : "outcomes";
  return [
    `skillset: lowering policy blocked ${outcomes.length} ${noun} (compile.unsupported: ${unsupportedPolicy})`,
    ...outcomes.map(formatBlockedOutcome),
  ].join("\n");
}

function formatBlockedOutcome(outcome: SkillsetLoweringOutcome): string {
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

function suggestionForBlockedOutcome(outcome: SkillsetLoweringOutcome): string {
  if (outcome.target === "codex" && outcome.featureId === "plugin-agents") {
    return "set codex: false for the plugin, move portable project agents to .skillset/src/agents, or keep Claude-only files in a Claude target-native island";
  }
  if (outcome.target === "codex" && outcome.featureId === "plugin-bin") {
    return "set bin: false, set codex: false for the plugin, remove Codex plugin output selection, or keep executable helpers in a Claude target-native island";
  }
  return "scope the command away from this source, disable the unsupported target for this source, or move provider-specific files into a target-native island";
}
