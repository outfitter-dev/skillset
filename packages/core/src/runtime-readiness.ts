import { createHash } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";

import {
  ACTIVATION_READINESS_SCHEMA,
  ACTIVATION_READINESS_SUMMARIES,
  ACTIVATION_REQUIREMENT_STAGES,
  ACTIVATION_REQUIREMENT_STATES,
  validateActivationProofReceipt,
} from "@skillset/schema";
import type {
  ActivationCapability,
  ActivationEvidenceOrigin,
  ActivationNextAction,
  ActivationObservationEffect,
  ActivationProofClaim,
  ActivationProofIdentity,
  ActivationProofReceipt,
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
import type {
  BuildGraph,
  RenderedFile,
  SourcePluginDependency,
  TargetName,
} from "./types";
import { isJsonRecord } from "./yaml";

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
  ActivationProofClaim,
  ActivationProofIdentity,
  ActivationProofReceipt,
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
  readonly currentProofIdentities?: Readonly<
    Record<string, readonly ActivationProofIdentity[]>
  >;
  readonly descriptors?: readonly ActivationReadinessDescriptor[];
  readonly graph: BuildGraph;
  readonly includeSourcePath?: (path: string) => boolean;
  readonly includeSubject?: (subject: ActivationSubject) => boolean;
  readonly observations?: readonly ActivationObservation[];
  readonly proofReceipts?: readonly ActivationProofReceipt[];
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly untrustedOutputPaths?: readonly string[];
}

export interface ResolvedActivationProofClaim {
  readonly claim: ActivationProofClaim;
  readonly requirementIds: readonly string[];
}

export interface ResolveActivationProofClaimsOptions {
  readonly claims: readonly ActivationProofClaim[];
  readonly graph: BuildGraph;
  readonly renderResults?: readonly SkillsetRenderResult[];
  readonly sourceUnits?: readonly string[];
  readonly targets: readonly TargetName[];
}

export interface CreateActivationProofIdentityOptions {
  readonly adapterId: string;
  readonly declarationHash: string;
  readonly graph: BuildGraph;
  readonly projectionSourceUnits?: readonly string[];
  readonly rendered: readonly RenderedFile[];
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly requirementIds: readonly string[];
  readonly untrustedOutputPaths?: readonly string[];
}

export interface ActivationProofReceiptEvaluation {
  readonly receipt?: ActivationProofReceipt;
  readonly requirementId: string;
  readonly state: "proven" | "stale" | "unverified";
}

export function planActivationReadiness(
  options: PlanActivationReadinessOptions
): ActivationReadinessReport {
  const allSubjects = deriveActivationSubjects(options.graph, {
    ...(options.includeSourcePath === undefined
      ? {}
      : { includeSourcePath: options.includeSourcePath }),
  });
  const subjects =
    options.includeSubject === undefined
      ? allSubjects
      : allSubjects.filter(options.includeSubject);
  const scopeTargets =
    options.includeSubject !== undefined ||
    options.includeSourcePath !== undefined;
  const enabledTargets = targetNames().filter(
    (target) =>
      options.graph.root.targets[target].enabled &&
      (!scopeTargets ||
        subjects.some((subject) => subject.target === target))
  );
  const descriptors =
    options.descriptors ?? listProviderActivationDescriptors();
  assertProviderActivationDescriptors(descriptors);
  const observations = indexObservations(
    descriptors,
    options.observations ?? []
  );
  const proofEvaluations = evaluateActivationProofReceipts({
    currentIdentities: options.currentProofIdentities ?? {},
    receipts: options.proofReceipts ?? [],
  });
  const untrustedOutputPaths = new Set(
    (options.untrustedOutputPaths ?? []).map(normalizeProofOutputPath)
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
          observations,
          proofEvaluations,
          untrustedOutputPaths
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

export interface DeriveActivationSubjectsOptions {
  readonly includeSourcePath?: (path: string) => boolean;
}

/**
 * Resolves author-facing capability subjects to current, stable `proven`
 * requirement ids. Callers may scope matching to a staged source projection.
 */
export function resolveActivationProofClaims(
  options: ResolveActivationProofClaimsOptions
): readonly ResolvedActivationProofClaim[] {
  const requestedTargets = new Set(options.targets);
  if (requestedTargets.size === 0) {
    throw new Error(
      "skillset: activation proof claims require at least one target"
    );
  }
  const sourceUnits =
    options.sourceUnits === undefined
      ? undefined
      : new Set(options.sourceUnits);
  const claims = normalizeActivationProofClaims(options.claims);
  const report =
    options.renderResults === undefined
      ? undefined
      : planActivationReadiness({
          graph: options.graph,
          renderResults: options.renderResults,
        });

  return claims.map((claim) => {
    const subjects = deriveActivationSubjects(options.graph).filter(
      (subject) =>
        requestedTargets.has(subject.target) &&
        subject.capability === claim.capability &&
        subject.subject === claim.subject &&
        (sourceUnits === undefined ||
          subject.sourceUnits.some((unit) => sourceUnits.has(unit)))
    );
    if (subjects.length === 0) {
      throw new Error(
        `skillset: activation proof claim ${claim.capability}:${claim.subject} does not match the selected target/source projection`
      );
    }

    const requirementIds = subjects
      .map((subject) =>
        activationRequirementId({ ...subject, stage: "proven" })
      )
      .toSorted(compareStrings);
    if (report !== undefined) {
      for (const id of requirementIds) {
        const requirement = report.requirements.find(
          (candidate) => candidate.id === id
        );
        const rendered = report.requirements.find(
          (candidate) =>
            candidate.target === requirement?.target &&
            candidate.capability === requirement?.capability &&
            candidate.subject === requirement?.subject &&
            candidate.stage === "rendered"
        );
        if (rendered === undefined || rendered.state !== "satisfied") {
          throw new Error(
            `skillset: activation proof claim ${claim.capability}:${claim.subject} is unavailable for ${requirement?.target ?? "the selected target"}: ${rendered?.reason ?? "no current render requirement exists"}`
          );
        }
      }
    }
    return { claim, requirementIds };
  });
}

/**
 * Produces a portable freshness identity from caller-supplied rendered lock
 * data. Core never reads retained runtime-report paths or app-owned caches.
 */
export function createActivationProofIdentity(
  options: CreateActivationProofIdentityOptions
): ActivationProofIdentity {
  if (options.adapterId.trim().length === 0) {
    throw new Error("skillset: activation proof adapterId is required");
  }
  if (options.declarationHash.trim().length === 0) {
    throw new Error(
      "skillset: activation proof declarationHash is required"
    );
  }
  const requirementIds = [...new Set(options.requirementIds)].toSorted(
    compareStrings
  );
  if (requirementIds.length === 0) {
    throw new Error(
      "skillset: activation proof identity requires at least one requirement id"
    );
  }
  const readiness = planActivationReadiness({
    graph: options.graph,
    renderResults: options.renderResults,
  });
  const requirements = readiness.requirements.filter((requirement) =>
    requirementIds.includes(requirement.id)
  );
  if (requirements.length !== requirementIds.length) {
    throw new Error(
      "skillset: activation proof identity references an unknown requirement id"
    );
  }
  const targets = [
    ...new Set(requirements.map((requirement) => requirement.target)),
  ];
  if (targets.length !== 1 || targets[0] === undefined) {
    throw new Error("skillset: activation proof identity requires one target");
  }
  const lockItems = collectActivationProofLockItems(options.rendered);
  const untrustedOutputPaths = new Set(
    (options.untrustedOutputPaths ?? []).map(normalizeProofOutputPath)
  );
  const sourceParts: string[] = [];
  const projectionParts: string[] = [];
  const appendProjection = (
    scope: string,
    resultOutputs: readonly string[]
  ): void => {
    if (
      resultOutputs.some((path) =>
        untrustedOutputPaths.has(normalizeProofOutputPath(path))
      )
    ) {
      throw new Error(
        `skillset: activation proof identity requires current generated output for ${scope}`
      );
    }
    const items = lockItems.filter((item) =>
      resultOutputs.some((path) => item.outputPaths.includes(path))
    );
    if (items.length === 0) {
      throw new Error(
        `skillset: activation proof identity cannot find rendered lock provenance for ${scope}`
      );
    }
    for (const item of items) {
      sourceParts.push(`${scope}\0${item.sourceHash}`);
      projectionParts.push(
        `${scope}\0${item.outputHash}\0${item.renderInputsHash ?? ""}`
      );
    }
  };
  for (const requirement of requirements) {
    const renderedRequirement = readiness.requirements.find(
      (candidate) =>
        candidate.target === requirement.target &&
        candidate.capability === requirement.capability &&
        candidate.subject === requirement.subject &&
        candidate.stage === "rendered"
    );
    if (
      renderedRequirement === undefined ||
      renderedRequirement.state !== "satisfied"
    ) {
      throw new Error(
        `skillset: activation proof identity requires a current rendered projection for ${requirement.id}`
      );
    }
    const resultOutputs = options.renderResults
      .filter(
        (result) =>
          result.target === requirement.target &&
          requirement.sourceUnits.includes(result.sourceUnit) &&
          featureMatchesCapability(result.featureId, requirement.capability)
      )
      .flatMap((result) => result.outputs?.map((output) => output.path) ?? []);
    appendProjection(requirement.id, resultOutputs);
  }
  for (const sourceUnit of [
    ...new Set(options.projectionSourceUnits ?? []),
  ].toSorted(compareStrings)) {
    const resultOutputs = options.renderResults
      .filter(
        (result) =>
          result.target === targets[0] && result.sourceUnit === sourceUnit
      )
      .flatMap((result) => result.outputs?.map((output) => output.path) ?? []);
    appendProjection(`source-unit:${sourceUnit}`, resultOutputs);
  }
  return {
    adapterId: options.adapterId,
    declarationHash: options.declarationHash,
    projectionHash: hashProofIdentity("projection", projectionParts),
    sourceHash: hashProofIdentity("source", sourceParts),
    target: targets[0],
  };
}

function normalizeProofOutputPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/**
 * Evaluates retained, app-supplied receipts against current identities. A
 * receipt may only establish proof when its claimed id and every freshness
 * component match exactly; runtime binary versions remain informational.
 */
export function evaluateActivationProofReceipts(input: {
  readonly currentIdentities: Readonly<
    Record<string, readonly ActivationProofIdentity[]>
  >;
  readonly receipts: readonly ActivationProofReceipt[];
}): ReadonlyMap<string, ActivationProofReceiptEvaluation> {
  const receiptsByRequirement = new Map<string, ActivationProofReceipt[]>();
  for (const receipt of input.receipts) {
    const validation = validateActivationProofReceipt(receipt);
    if (!validation.ok) {
      throw new Error(
        `skillset: activation proof receipt is invalid: ${validation.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`
      );
    }
    for (const id of receipt.claimIds) {
      const matches = receiptsByRequirement.get(id) ?? [];
      matches.push(receipt);
      receiptsByRequirement.set(id, matches);
    }
  }

  const evaluations = new Map<string, ActivationProofReceiptEvaluation>();
  for (const [requirementId, receipts] of receiptsByRequirement) {
    const current = input.currentIdentities[requirementId] ?? [];
    const successful = receipts
      .filter((receipt) => receipt.outcome === "passed")
      .toSorted(compareProofReceipts);
    const matching = successful.find(
      (receipt) =>
        current.some((identity) =>
          proofIdentityEquals(receipt.identity, identity)
        )
    );
    if (matching !== undefined) {
      evaluations.set(requirementId, {
        receipt: matching,
        requirementId,
        state: "proven",
      });
      continue;
    }
    const stale = successful[0];
    if (stale !== undefined) {
      evaluations.set(requirementId, {
        receipt: stale,
        requirementId,
        state: "stale",
      });
      continue;
    }
    evaluations.set(requirementId, { requirementId, state: "unverified" });
  }
  return evaluations;
}

export function deriveActivationSubjects(
  graph: BuildGraph,
  options: DeriveActivationSubjectsOptions = {}
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

  const includeSourcePath = options.includeSourcePath;
  const selected =
    includeSourcePath === undefined
      ? subjects
      : subjects.filter((subject) =>
          subject.sourcePaths.some(includeSourcePath)
        );
  return mergeSubjects(selected);
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

export function filterActivationReadiness(
  report: ActivationReadinessReport,
  include: (requirement: ActivationRequirement) => boolean
): ActivationReadinessReport {
  const requirements = report.requirements.filter(include);
  return {
    counts: countRequirementStates(requirements),
    enabledTargets: report.enabledTargets.filter((target) =>
      requirements.some((requirement) => requirement.target === target)
    ),
    requirements,
    schema: report.schema,
    summary: summarizeActivationReadiness(requirements),
  };
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
  observations: ReadonlyMap<string, ActivationObservation>,
  proofEvaluations: ReadonlyMap<string, ActivationProofReceiptEvaluation>,
  untrustedOutputPaths: ReadonlySet<string>
): ActivationRequirement {
  const id = activationRequirementId({ ...subject, stage });
  if (stage === "proven") {
    const proof = proofEvaluations.get(id);
    if (proof?.state === "proven") {
      return {
        capability: subject.capability,
        id,
        nextActions: [],
        observationEffect: "none",
        origin: "proven",
        reason: "a current declared runtime receipt proved this requirement",
        required: false,
        sourcePaths: subject.sourcePaths,
        sourceUnits: subject.sourceUnits,
        stage,
        state: "satisfied",
        subject: subject.subject,
        target: subject.target,
      };
    }
    if (proof?.state === "stale") {
      return {
        capability: subject.capability,
        id,
        nextActions: [],
        observationEffect: "none",
        origin: "proven",
        reason:
          "a declared runtime receipt no longer matches current proof identity",
        required: false,
        sourcePaths: subject.sourcePaths,
        sourceUnits: subject.sourceUnits,
        stage,
        state: "stale",
        subject: subject.subject,
        target: subject.target,
      };
    }
  }
  const observation = observations.get(id);
  if (observation !== undefined) {
    const evidence = observationEvidence(descriptor, observation);
    return {
      capability: subject.capability,
      id,
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
    renderResults,
    untrustedOutputPaths
  );
  return {
    capability: subject.capability,
    id,
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
  renderResults: readonly SkillsetRenderResult[],
  untrustedOutputPaths: ReadonlySet<string>
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
    candidates.some((result) =>
      (result.outputs ?? []).some((output) =>
        untrustedOutputPaths.has(normalizeProofOutputPath(output.path))
      )
    )
  ) {
    return {
      nextActions: [],
      reason: "generated output for this requirement is missing or stale",
      state: "missing",
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

interface ActivationProofLockItem {
  readonly outputHash: string;
  readonly outputPaths: readonly string[];
  readonly renderInputsHash?: string;
  readonly sourceHash: string;
}

function normalizeActivationProofClaims(
  claims: readonly ActivationProofClaim[]
): readonly ActivationProofClaim[] {
  const seen = new Set<string>();
  return claims
    .map((claim) => {
      const subject = claim.subject.trim();
      if (subject.length === 0) {
        throw new Error("skillset: activation proof claim subject is required");
      }
      const key = `${claim.capability}\0${subject}`;
      if (seen.has(key)) {
        throw new Error(
          `skillset: duplicate activation proof claim ${claim.capability}:${subject}`
        );
      }
      seen.add(key);
      return { capability: claim.capability, subject };
    })
    .toSorted((left, right) =>
      compareStrings(
        `${left.capability}\0${left.subject}`,
        `${right.capability}\0${right.subject}`
      )
    );
}

function collectActivationProofLockItems(
  rendered: readonly RenderedFile[]
): readonly ActivationProofLockItem[] {
  const items = new Map<string, ActivationProofLockItem>();
  const decoder = new TextDecoder();
  for (const file of rendered) {
    if (
      file.path !== "skillset.lock" &&
      !file.path.endsWith("/skillset.lock")
    ) {
      continue;
    }
    let lock: unknown;
    try {
      lock = JSON.parse(decoder.decode(file.content));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `skillset: activation proof identity cannot parse ${file.path}: ${detail}`
      );
    }
    if (!isJsonRecord(lock) || !Array.isArray(lock.items)) continue;
    const outputRoot = dirname(file.path);
    for (const rawItem of lock.items) {
      if (!isJsonRecord(rawItem)) continue;
      if (
        typeof rawItem.sourceHash !== "string" ||
        rawItem.sourceHash.length === 0 ||
        typeof rawItem.outputHash !== "string" ||
        rawItem.outputHash.length === 0
      ) {
        continue;
      }
      const files = Array.isArray(rawItem.files)
        ? rawItem.files.filter(
            (entry): entry is string => typeof entry === "string"
          )
        : typeof rawItem.outputPath === "string"
          ? [rawItem.outputPath]
          : [];
      if (files.length === 0) continue;
      const item: ActivationProofLockItem = {
        outputHash: rawItem.outputHash,
        outputPaths: files
          .map((path) => join(outputRoot, path).replaceAll("\\", "/"))
          .toSorted(compareStrings),
        ...(typeof rawItem.renderInputsHash === "string"
          ? { renderInputsHash: rawItem.renderInputsHash }
          : {}),
        sourceHash: rawItem.sourceHash,
      };
      const key = `${item.sourceHash}\0${item.outputHash}\0${item.renderInputsHash ?? ""}\0${item.outputPaths.join("\0")}`;
      items.set(key, item);
    }
  }
  return [...items.values()].toSorted((left, right) =>
    compareStrings(
      `${left.sourceHash}\0${left.outputHash}\0${left.outputPaths.join("\0")}`,
      `${right.sourceHash}\0${right.outputHash}\0${right.outputPaths.join("\0")}`
    )
  );
}

function hashProofIdentity(
  kind: "projection" | "source",
  parts: readonly string[]
): string {
  const hash = createHash("sha256");
  hash.update(`skillset.activation-proof.${kind}@1\0`);
  for (const part of [...new Set(parts)].toSorted(compareStrings)) {
    hash.update(part);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function compareProofReceipts(
  left: ActivationProofReceipt,
  right: ActivationProofReceipt
): number {
  return compareStrings(proofReceiptKey(left), proofReceiptKey(right));
}

function proofReceiptKey(receipt: ActivationProofReceipt): string {
  return [
    receipt.identity.target,
    receipt.identity.adapterId,
    receipt.identity.declarationHash,
    receipt.identity.sourceHash,
    receipt.identity.projectionHash,
    receipt.outcome,
    receipt.runtimeVersion ?? "",
    receipt.claimIds.join("\0"),
  ].join("\0");
}

function proofIdentityEquals(
  left: ActivationProofIdentity,
  right: ActivationProofIdentity
): boolean {
  return (
    left.adapterId === right.adapterId &&
    left.declarationHash === right.declarationHash &&
    left.projectionHash === right.projectionHash &&
    left.sourceHash === right.sourceHash &&
    left.target === right.target
  );
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
