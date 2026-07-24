import { relative, sep } from "node:path";

import {
  ACTIVATION_READINESS_SCHEMA,
  ACTIVATION_READINESS_SUMMARIES,
  ACTIVATION_REQUIREMENT_STAGES,
  ACTIVATION_REQUIREMENT_STATES,
} from "@skillset/schema";
import type {
  ActivationCapability,
  ActivationEvidenceOrigin,
  ActivationNextAction,
  ActivationObservationEffect,
  ActivationReadinessCounts,
  ActivationReadinessReport,
  ActivationReadinessSummary,
  ActivationRequirement,
  ActivationRequirementStage,
  ActivationRequirementState,
} from "@skillset/schema";

import { readPluginDependencies } from "./dependencies";
import {
  assertProviderActivationDescriptors,
  listProviderActivationDescriptors,
} from "./activation-policy";
import type {
  ProviderActivationClaim,
  ProviderActivationDescriptor,
} from "./activation-policy";
import { isOutputSelected } from "./config";
import { compareStrings } from "./path";
import type { SkillsetRenderResult } from "./render-result";
import {
  pluginIdForSelector,
  selectorForPluginFeature,
  selectorForPluginSkill,
  selectorForTargetNativeIsland,
} from "./source-unit-selector";
import { targetNames } from "./targets";
import type { BuildGraph, SourcePluginDependency, TargetName } from "./types";

export {
  ACTIVATION_READINESS_SCHEMA,
  ACTIVATION_READINESS_SUMMARIES,
  ACTIVATION_REQUIREMENT_STAGES,
  ACTIVATION_REQUIREMENT_STATES,
};
export type {
  ActivationCapability,
  ActivationEvidenceOrigin,
  ActivationNextAction,
  ActivationObservationEffect,
  ActivationReadinessCounts,
  ActivationReadinessReport,
  ActivationReadinessSummary,
  ActivationRequirement,
  ActivationRequirementStage,
  ActivationRequirementState,
};

export type ActivationSubjectOrigin = "external" | "internal" | "source";

export type ActivationReadinessDescriptor = ProviderActivationDescriptor;

export interface ActivationSubject {
  readonly capability: ActivationCapability;
  readonly origin: ActivationSubjectOrigin;
  readonly required: boolean;
  readonly sourcePaths: readonly string[];
  readonly sourceUnits: readonly string[];
  readonly subject: string;
  readonly target: TargetName;
}

export interface ActivationObservation {
  readonly capability: ActivationCapability;
  readonly claim: ProviderActivationClaim;
  readonly inspectorId: string;
  readonly observationEffect: ActivationObservationEffect;
  readonly origin: "observed";
  readonly reasonCode?: string;
  readonly stage: ActivationRequirementStage;
  readonly state: ActivationRequirementState;
  readonly subject: string;
  readonly target: TargetName;
}

export interface PlanActivationReadinessOptions {
  readonly descriptors?: readonly ActivationReadinessDescriptor[];
  readonly graph: BuildGraph;
  readonly observations?: readonly ActivationObservation[];
  readonly renderResults: readonly SkillsetRenderResult[];
}

export function planActivationReadiness(
  options: PlanActivationReadinessOptions
): ActivationReadinessReport {
  const enabledTargets = targetNames().filter(
    (target) => options.graph.root.targets[target].enabled
  );
  const subjects = deriveActivationSubjects(options.graph);
  const descriptors =
    options.descriptors ?? listProviderActivationDescriptors();
  assertProviderActivationDescriptors(descriptors);
  const observations = indexObservations(
    descriptors,
    options.observations ?? []
  );
  const requirements = subjects
    .flatMap((subject) => {
      const descriptor = descriptors.find(
        (candidate) =>
          candidate.target === subject.target &&
          candidate.capability === subject.capability
      );
      if (descriptor === undefined) {
        return [];
      }
      return descriptor.stages.map((stage) =>
        requirementFor(
          descriptor,
          subject,
          stage,
          options.renderResults,
          observations
        )
      );
    })
    .toSorted(compareRequirements);

  return {
    counts: countRequirementStates(requirements),
    enabledTargets,
    requirements,
    schema: ACTIVATION_READINESS_SCHEMA,
    summary: summarizeActivationReadiness(requirements),
  };
}

export function deriveActivationSubjects(
  graph: BuildGraph
): readonly ActivationSubject[] {
  const subjects: ActivationSubject[] = [];

  for (const plugin of graph.plugins) {
    for (const target of targetNames()) {
      if (
        !graph.root.targets[target].enabled ||
        !plugin.targets[target].enabled ||
        !isOutputSelected(
          graph.root.outputs.targetOutputs[target].plugins,
          plugin.id
        )
      ) {
        continue;
      }
      subjects.push(...pluginDependencySubjects(graph, plugin, target));
      for (const feature of plugin.features) {
        if (feature.key === "app") {
          if (target !== "codex") continue;
          subjects.push({
            capability: "app",
            origin: "source",
            required: true,
            sourcePaths: [
              relativeSourcePath(graph.rootPath, feature.sourcePath),
            ],
            sourceUnits: [selectorForPluginFeature(plugin.id, "app")],
            subject: plugin.id,
            target,
          });
          continue;
        }
        if (feature.key !== "mcp") {
          continue;
        }
        const names = feature.subjects ?? [];
        for (const name of names) {
          subjects.push({
            capability: "mcp-server",
            origin: "source",
            required: true,
            sourcePaths: [
              relativeSourcePath(graph.rootPath, feature.sourcePath),
            ],
            sourceUnits: [selectorForPluginFeature(plugin.id, "mcp")],
            subject: name,
            target,
          });
        }
      }
    }
  }

  for (const island of graph.projectIslands) {
    const owner =
      island.plugin === undefined
        ? undefined
        : graph.plugins.find((plugin) => plugin.id === island.plugin);
    if (
      island.relativePath !== ".app.json" ||
      island.target !== "codex" ||
      island.plugin === undefined ||
      owner === undefined ||
      !owner.targets[island.target].enabled ||
      !isOutputSelected(
        graph.root.outputs.targetOutputs[island.target].plugins,
        owner.id
      ) ||
      !graph.root.targets[island.target].enabled
    ) {
      continue;
    }
    subjects.push({
      capability: "app",
      origin: "source",
      required: true,
      sourcePaths: [relativeSourcePath(graph.rootPath, island.sourcePath)],
      sourceUnits: [
        selectorForTargetNativeIsland(
          island.target,
          `plugin:${island.plugin}`,
          island.relativePath
        ),
      ],
      subject: island.plugin,
      target: island.target,
    });
  }

  return mergeSubjects(subjects);
}

export function activationRequirementId(input: {
  readonly capability: ActivationCapability;
  readonly stage: ActivationRequirementStage;
  readonly subject: string;
  readonly target: TargetName;
}): string {
  return [
    "activation",
    input.target,
    input.capability,
    encodeURIComponent(input.subject),
    input.stage,
  ].join(":");
}

export function summarizeActivationReadiness(
  requirements: readonly ActivationRequirement[]
): ActivationReadinessSummary {
  const required = requirements.filter((requirement) => requirement.required);
  if (required.some((requirement) => requirement.state === "blocked")) {
    return "blocked";
  }
  if (
    required.some(
      (requirement) =>
        requirement.state === "missing" || requirement.state === "stale"
    )
  ) {
    return "attention";
  }
  if (required.some((requirement) => requirement.state === "unverified")) {
    return "ready_unverified";
  }
  return "ready";
}

function pluginDependencySubjects(
  graph: BuildGraph,
  plugin: BuildGraph["plugins"][number],
  target: TargetName,
): readonly ActivationSubject[] {
  const declarations = [
    ...plugin.dependencies.map((dependency) => ({
      dependency,
      sourceUnit: selectorForPluginFeature(plugin.id, "dependencies"),
    })),
    ...plugin.skills.flatMap((skill) =>
      readPluginDependencies(
        skill.frontmatter.dependencies,
        relativeSourcePath(graph.rootPath, skill.sourcePath)
      ).map((dependency) => ({
        dependency,
        sourceUnit: selectorForPluginSkill(plugin.id, skill.id),
      }))
    ),
  ];
  return declarations.map(({ dependency, sourceUnit }) =>
    pluginDependencySubject(plugin.id, target, dependency, sourceUnit)
  );
}

function pluginDependencySubject(
  pluginId: string,
  target: TargetName,
  dependency: SourcePluginDependency,
  sourceUnit: string
): ActivationSubject {
  const externalPrefix =
    dependency.marketplace === undefined ? "" : `${dependency.marketplace}/`;
  return {
    capability: "plugin-dependency",
    origin: dependency.kind,
    required: true,
    sourcePaths: [dependency.sourceLabel],
    sourceUnits: [sourceUnit],
    subject:
      dependency.kind === "internal"
        ? dependency.name
        : `${externalPrefix}${dependency.name}`,
    target,
  };
}

function requirementFor(
  descriptor: ActivationReadinessDescriptor,
  subject: ActivationSubject,
  stage: ActivationRequirementStage,
  renderResults: readonly SkillsetRenderResult[],
  observations: ReadonlyMap<string, ActivationObservation>
): ActivationRequirement {
  const observation = observations.get(
    activationRequirementId({
      capability: subject.capability,
      stage,
      subject: subject.subject,
      target: subject.target,
    })
  );
  if (observation !== undefined) {
    const evidence = observationEvidence(descriptor, observation);
    return {
      capability: subject.capability,
      id: activationRequirementId({ ...subject, stage }),
      nextActions: evidence.nextActions,
      observationEffect: observation.observationEffect,
      origin: observation.origin,
      reason: evidence.reason,
      required: stage === "proven" ? false : subject.required,
      sourcePaths: subject.sourcePaths,
      sourceUnits: subject.sourceUnits,
      stage,
      state: observation.state,
      subject: subject.subject,
      target: subject.target,
    };
  }

  const staticState = staticRequirementState(
    descriptor,
    subject,
    stage,
    renderResults
  );
  return {
    capability: subject.capability,
    id: activationRequirementId({ ...subject, stage }),
    nextActions: staticState.nextActions,
    observationEffect: "none",
    origin: stage === "declared" ? "declared" : "derived",
    reason: staticState.reason,
    required: stage === "proven" ? false : subject.required,
    sourcePaths: subject.sourcePaths,
    sourceUnits: subject.sourceUnits,
    stage,
    state: staticState.state,
    subject: subject.subject,
    target: subject.target,
  };
}

function indexObservations(
  descriptors: readonly ActivationReadinessDescriptor[],
  observations: readonly ActivationObservation[]
): ReadonlyMap<string, ActivationObservation> {
  const indexed = new Map<string, ActivationObservation>();
  for (const observation of observations) {
    const descriptor = descriptors.find(
      (candidate) =>
        candidate.target === observation.target &&
        candidate.capability === observation.capability
    );
    if (descriptor === undefined) {
      throw new Error(
        `skillset: activation observation has no descriptor for ${observation.target}:${observation.capability}`
      );
    }
    const inspector = descriptor.inspectors.find(
      (candidate) => candidate.id === observation.inspectorId
    );
    if (inspector === undefined) {
      throw new Error(
        `skillset: activation observation references unknown inspector ${observation.inspectorId}`
      );
    }
    if (
      observation.claim !== observation.stage ||
      !descriptor.allowedClaims.includes(observation.claim) ||
      descriptor.forbiddenClaims.includes(observation.claim) ||
      !inspector.allowedClaims.includes(observation.claim) ||
      inspector.forbiddenClaims.includes(observation.claim)
    ) {
      throw new Error(
        `skillset: activation inspector ${observation.inspectorId} cannot claim ${observation.claim} for ${observation.stage}`
      );
    }
    if (observation.observationEffect !== inspector.effect) {
      throw new Error(
        `skillset: activation inspector ${observation.inspectorId} requires ${inspector.effect} effect`
      );
    }
    if (observation.state !== "satisfied") {
      const reason = descriptor.reasons.find(
        (candidate) => candidate.code === observation.reasonCode
      );
      if (reason === undefined || reason.stage !== observation.stage) {
        throw new Error(
          `skillset: activation observation for ${observation.inspectorId} requires a Core policy reason for ${observation.stage}`
        );
      }
    } else if (observation.reasonCode !== undefined) {
      throw new Error(
        `skillset: satisfied activation observation for ${observation.inspectorId} must not declare a failure reason`
      );
    }

    const id = activationRequirementId(observation);
    if (indexed.has(id)) {
      throw new Error(`skillset: duplicate activation observation ${id}`);
    }
    indexed.set(id, observation);
  }
  return indexed;
}

function observationEvidence(
  descriptor: ActivationReadinessDescriptor,
  observation: ActivationObservation
): Pick<ActivationRequirement, "nextActions" | "reason"> {
  if (observation.state === "satisfied") {
    return {
      nextActions: [],
      reason: `${observation.inspectorId} reported ${observation.claim}`,
    };
  }
  const reason = descriptor.reasons.find(
    (candidate) => candidate.code === observation.reasonCode
  );
  if (reason === undefined) {
    throw new Error(
      `skillset: activation observation references unknown reason ${observation.reasonCode}`
    );
  }
  return {
    nextActions: actionsForReason(descriptor, reason.code),
    reason: reason.message,
  };
}

function staticRequirementState(
  descriptor: ActivationReadinessDescriptor,
  subject: ActivationSubject,
  stage: ActivationRequirementStage,
  renderResults: readonly SkillsetRenderResult[]
): Pick<ActivationRequirement, "nextActions" | "reason" | "state"> {
  if (stage === "declared") {
    return {
      nextActions: [],
      reason: "activation requirement is declared by canonical source",
      state: "satisfied",
    };
  }
  if (stage !== "rendered") {
    const reason = descriptor.reasons.find(
      (candidate) => candidate.stage === stage
    );
    return {
      nextActions:
        reason === undefined ? [] : actionsForReason(descriptor, reason.code),
      reason:
        reason?.message ?? "no authoritative provider observation is available",
      state: "unverified",
    };
  }

  const candidates = renderResults.filter(
    (result) =>
      result.target === subject.target &&
      renderResultMatchesSubject(result, subject) &&
      featureMatchesCapability(result.featureId, subject.capability)
  );
  if (candidates.length === 0) {
    return {
      nextActions: [],
      reason: "no current render result establishes this requirement",
      state: "missing",
    };
  }
  if (
    candidates.some(
      (result) => result.status === "failed" || result.status === "unsupported"
    )
  ) {
    return {
      nextActions: [],
      reason: "current rendering reports an explicit provider block",
      state: "blocked",
    };
  }
  if (
    candidates.some(
      (result) =>
        result.status === "rendered" ||
        result.status === "target_native" ||
        result.status === "transformed" ||
        result.status === "metadata_only" ||
        result.status === "degraded" ||
        result.status === "lossy"
    )
  ) {
    return {
      nextActions: [],
      reason: "current render evidence exists",
      state: "satisfied",
    };
  }
  return {
    nextActions: [],
    reason: "current rendering did not emit the requirement",
    state: "missing",
  };
}

function renderResultMatchesSubject(
  result: SkillsetRenderResult,
  subject: ActivationSubject
): boolean {
  if (subject.sourceUnits.includes(result.sourceUnit)) return true;
  if (subject.capability !== "plugin-dependency") return false;
  const resultPluginId = pluginIdForSelector(result.sourceUnit);
  return (
    resultPluginId !== undefined &&
    subject.sourceUnits.some(
      (sourceUnit) => pluginIdForSelector(sourceUnit) === resultPluginId
    )
  );
}

function featureMatchesCapability(
  featureId: string,
  capability: ActivationCapability
): boolean {
  if (capability === "plugin-dependency") {
    return featureId === "dependencies";
  }
  if (capability === "mcp-server") {
    return featureId === "plugin-mcp";
  }
  return featureId === "plugin-apps" || featureId === "target-native-islands";
}

function mergeSubjects(
  subjects: readonly ActivationSubject[]
): readonly ActivationSubject[] {
  const merged = new Map<string, ActivationSubject>();
  for (const subject of subjects) {
    const key = `${subject.target}\0${subject.capability}\0${subject.subject}`;
    const prior = merged.get(key);
    if (prior === undefined) {
      merged.set(key, {
        ...subject,
        sourcePaths: [...subject.sourcePaths].toSorted(compareStrings),
        sourceUnits: [...subject.sourceUnits].toSorted(compareStrings),
      });
      continue;
    }
    merged.set(key, {
      ...prior,
      required: prior.required || subject.required,
      sourcePaths: [
        ...new Set([...prior.sourcePaths, ...subject.sourcePaths]),
      ].toSorted(compareStrings),
      sourceUnits: [
        ...new Set([...prior.sourceUnits, ...subject.sourceUnits]),
      ].toSorted(compareStrings),
    });
  }
  return [...merged.values()].toSorted((left, right) =>
    compareStrings(subjectKey(left), subjectKey(right))
  );
}

function actionsForReason(
  descriptor: ActivationReadinessDescriptor,
  reasonCode: string
): readonly ActivationNextAction[] {
  return normalizeActions(
    descriptor.actions
      .filter((action) => action.reasonCode === reasonCode)
      .map((action) => ({
        id: action.code,
        label: action.label,
        mutates: action.mutatesProviderState,
        url: action.url,
      }))
  );
}

function normalizeActions(
  actions: readonly ActivationNextAction[]
): readonly ActivationNextAction[] {
  return [...actions].toSorted((left, right) =>
    compareStrings(`${left.id}\0${left.label}`, `${right.id}\0${right.label}`)
  );
}

function compareRequirements(
  left: ActivationRequirement,
  right: ActivationRequirement
): number {
  return compareStrings(left.id, right.id);
}

function subjectKey(subject: ActivationSubject): string {
  return `${subject.target}\0${subject.capability}\0${subject.subject}`;
}

function relativeSourcePath(rootPath: string, sourcePath: string): string {
  return relative(rootPath, sourcePath).split(sep).join("/");
}

function countRequirementStates(
  requirements: readonly ActivationRequirement[]
): ActivationReadinessCounts {
  const counts = {
    blocked: 0,
    missing: 0,
    notApplicable: 0,
    satisfied: 0,
    stale: 0,
    unverified: 0,
  };
  for (const requirement of requirements) {
    if (requirement.state === "not_applicable") {
      counts.notApplicable += 1;
    } else {
      counts[requirement.state] += 1;
    }
  }
  return counts;
}
