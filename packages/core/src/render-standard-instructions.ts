import type { LogicalOutputProjection, OutputConsumer } from "./output-plan";
import { compareStrings } from "./path";
import { selectorForInstruction } from "./source-unit-selector";
import type { BuildGraph, SourceRule } from "./types";

export interface AgentInstructionProjection {
  readonly destination: string;
  readonly outputProjection: LogicalOutputProjection;
  readonly rules: readonly SourceRule[];
}

type RuleDestinations = (
  graph: BuildGraph,
  rule: SourceRule
) => Promise<readonly string[]>;

/**
 * Resolve the Agent Instructions baseline independently from provider rule
 * selection. A Codex consumer reuses the complete baseline at destinations it
 * discovers, so one physical AGENTS.md preserves standard scope and bytes.
 */
export async function planAgentInstructionProjections(
  graph: BuildGraph,
  destinationsForRule: RuleDestinations
): Promise<readonly AgentInstructionProjection[]> {
  const standardSelected =
    graph.root.compile.agents.instructions &&
    graph.standardProjections.adopted.includes("agent-instructions");
  const standardDestinations = standardSelected
    ? await rulesByDestination(graph, graph.rules, destinationsForRule)
    : new Map<string, readonly SourceRule[]>();
  const codexDestinations = graph.root.compile.agents.instructions
    ? await rulesByDestination(
        graph,
        graph.rules.filter((rule) => rule.targets.codex.enabled),
        destinationsForRule
      )
    : new Map<string, readonly SourceRule[]>();
  const destinations = new Set([
    ...standardDestinations.keys(),
    ...codexDestinations.keys(),
  ]);
  const projections: AgentInstructionProjection[] = [];

  for (const destination of [...destinations].sort(compareStrings)) {
    const baselineRules = standardDestinations.get(destination);
    const codexRules = codexDestinations.get(destination);
    if (baselineRules !== undefined) {
      projections.push(
        projection(destination, baselineRules, {
          phase: "baseline",
          standardProfile: "agent-instructions",
        })
      );
    }
    if (codexRules !== undefined) {
      projections.push(
        projection(destination, baselineRules ?? codexRules, {
          phase: "delta",
          target: "codex",
        })
      );
    }
  }

  return projections;
}

async function rulesByDestination(
  graph: BuildGraph,
  rules: readonly SourceRule[],
  destinationsForRule: RuleDestinations
): Promise<ReadonlyMap<string, readonly SourceRule[]>> {
  const destinations = new Map<string, SourceRule[]>();
  for (const rule of rules) {
    for (const destination of await destinationsForRule(graph, rule)) {
      const existing = destinations.get(destination) ?? [];
      destinations.set(destination, [...existing, rule]);
    }
  }
  return destinations;
}

function projection(
  destination: string,
  rules: readonly SourceRule[],
  consumer: OutputConsumer
): AgentInstructionProjection {
  return {
    destination,
    outputProjection: {
      consumer,
      ownership: "managed",
      sourceUnit: selectorForInstruction(destination),
    },
    rules,
  };
}
