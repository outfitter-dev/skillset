/* eslint-disable func-style, no-use-before-define -- Named planner phases and hoisted guards keep the ownership algorithm readable. */

import { compareStrings } from "./path";
import type {
  ProjectionConsumer,
  ProjectionOwner,
  RenderedFile,
} from "./types";

export type OutputConsumer = ProjectionConsumer;
export type OutputOwner = ProjectionOwner;

export type OutputOwnership = "managed" | "provider-native";

export interface LogicalOutputProjection {
  readonly consumer: OutputConsumer;
  readonly ownership: OutputOwnership;
  /** Stable resolved-source identity; paths and output names are not identity. */
  readonly sourceUnit: string;
}

export interface PhysicalOutputPlan {
  /** Baselines precede provider deltas; this order is lock provenance. */
  readonly consumers: readonly OutputConsumer[];
  readonly owner: OutputOwner;
  readonly ownership: OutputOwnership;
  readonly sourceUnit: string;
}

export interface LogicalRenderedFile extends RenderedFile {
  readonly outputProjection: LogicalOutputProjection;
}

export interface PlannedRenderedFile extends RenderedFile {
  readonly outputPlan?: PhysicalOutputPlan;
}

/**
 * Assign exactly one physical writer to every destination. Existing renderers
 * may remain unannotated while standards renderers migrate onto the logical
 * projection seam; a shared destination must be fully annotated so ownership
 * and source identity can never be inferred from insertion order.
 */
export function planRenderedFiles(
  files: readonly (RenderedFile | LogicalRenderedFile)[]
): readonly PlannedRenderedFile[] {
  assertCasePortableRenderedPaths(files.map((file) => file.path));
  const byPath = new Map<string, (RenderedFile | LogicalRenderedFile)[]>();
  for (const file of files) {
    const existing = byPath.get(file.path) ?? [];
    existing.push(file);
    byPath.set(file.path, existing);
  }

  return [...byPath.entries()]
    .toSorted(([left], [right]) => compareStrings(left, right))
    .map(([path, candidates]) => planDestination(path, candidates));
}

export function mapPlannedOutputPaths(
  files: readonly PlannedRenderedFile[],
  mapPath: (path: string) => string
): readonly PlannedRenderedFile[] {
  return files.map((file) => ({ ...file, path: mapPath(file.path) }));
}

/** The prior set comes from validated lock ownership, including inactive roots. */
export function stalePlannedOutputPaths(
  previousManagedPaths: ReadonlySet<string>,
  planned: readonly PlannedRenderedFile[]
): readonly string[] {
  const expected = new Set(planned.map((file) => file.path));
  return [...previousManagedPaths]
    .filter((path) => !expected.has(path))
    .toSorted(compareStrings);
}

export function assertCasePortableRenderedPaths(
  paths: readonly string[]
): void {
  const byCaseInsensitivePrefix = new Map<
    string,
    { readonly destination: string; readonly prefix: string }
  >();
  for (const path of paths) {
    const destination = path.replaceAll("\\", "/");
    let prefix = "";
    for (const segment of path.split(/[\\/]/u)) {
      prefix = prefix === "" ? segment : `${prefix}/${segment}`;
      const caseVariant = byCaseInsensitivePrefix.get(prefix.toLowerCase());
      if (caseVariant !== undefined && caseVariant.prefix !== prefix) {
        const [left, right] = [caseVariant.destination, destination].toSorted(
          compareStrings
        );
        const [leftPrefix, rightPrefix] = [caseVariant.prefix, prefix].toSorted(
          compareStrings
        );
        throw new Error(
          "skillset: generated output destinations use case-conflicting paths and are not portable: " +
            `${left} and ${right} (prefixes ${leftPrefix} and ${rightPrefix}); ` +
            "rename one source destination"
        );
      }
      byCaseInsensitivePrefix.set(prefix.toLowerCase(), {
        destination,
        prefix,
      });
    }
  }
}

function planDestination(
  path: string,
  candidates: readonly (RenderedFile | LogicalRenderedFile)[]
): PlannedRenderedFile {
  const annotated = candidates.filter(isLogicalRenderedFile);
  if (annotated.length === 0) {
    return planLegacyDestination(path, candidates);
  }
  if (annotated.length !== candidates.length) {
    throw new Error(
      `skillset: generated output collision at ${path} mixes planned and unplanned ownership`
    );
  }

  const ordered = annotated.toSorted((left, right) =>
    compareStrings(
      consumerKey(left.outputProjection.consumer),
      consumerKey(right.outputProjection.consumer)
    )
  );
  const [first] = ordered;
  if (first === undefined) {
    throw new Error(`skillset: missing output candidate at ${path}`);
  }

  const sourceUnits = [
    ...new Set(ordered.map((file) => file.outputProjection.sourceUnit)),
  ].toSorted(compareStrings);
  if (sourceUnits.length !== 1) {
    throw new Error(
      `skillset: generated output collision at ${path} has conflicting source identities: ${sourceUnits.join(", ")}`
    );
  }

  const ownerships = [
    ...new Set(ordered.map((file) => file.outputProjection.ownership)),
  ].toSorted(compareStrings);
  if (ownerships.length !== 1) {
    throw new Error(
      `skillset: generated output collision at ${path} requires incompatible ownership: ${ownerships.join(", ")}`
    );
  }

  const modes = [...new Set(ordered.map((file) => file.mode))];
  if (modes.length !== 1) {
    throw new Error(
      `skillset: generated output collision at ${path} requires incompatible modes`
    );
  }
  if (ordered.some((file) => !bytesEqual(first.content, file.content))) {
    throw new Error(
      `skillset: generated output collision at ${path} requires incompatible bytes`
    );
  }

  const consumers = ordered.map((file) => file.outputProjection.consumer);
  const consumerKeys = consumers.map(consumerKey);
  if (new Set(consumerKeys).size !== consumerKeys.length) {
    throw new Error(
      `skillset: generated output collision at ${path} repeats a logical consumer`
    );
  }
  const standardConsumers = consumers.filter(isStandardConsumer);
  if (standardConsumers.length > 1) {
    throw new Error(
      `skillset: generated output collision at ${path} has multiple standard owners`
    );
  }
  if (standardConsumers.length === 0 && consumers.length > 1) {
    throw new Error(
      `skillset: generated output collision at ${path} has multiple provider consumers without a standard owner`
    );
  }

  const [standard] = standardConsumers;
  const [soleConsumer] = consumers;
  const owner: OutputOwner =
    standard === undefined
      ? {
          target: (soleConsumer as Extract<OutputConsumer, { phase: "delta" }>)
            .target,
        }
      : { standardProfile: standard.standardProfile };
  const [ownership] = ownerships;
  const [sourceUnit] = sourceUnits;
  const { outputProjection: _projection, ...file } = first;
  return {
    ...file,
    outputPlan: {
      consumers,
      owner,
      ownership: ownership as OutputOwnership,
      sourceUnit: sourceUnit as string,
    },
  };
}

function planLegacyDestination(
  path: string,
  candidates: readonly RenderedFile[]
): PlannedRenderedFile {
  const [first] = candidates;
  if (first === undefined) {
    throw new Error(`skillset: missing output candidate at ${path}`);
  }
  for (const candidate of candidates.slice(1)) {
    if (
      bytesEqual(first.content, candidate.content) &&
      first.mode === candidate.mode
    ) {
      continue;
    }
    throw new Error(
      `skillset: generated output collision at ${path} from ` +
        `${first.sourcePath ?? "generated output"} and ${candidate.sourcePath ?? "generated output"}`
    );
  }
  return first;
}

function isLogicalRenderedFile(
  file: RenderedFile
): file is LogicalRenderedFile {
  return "outputProjection" in file;
}

function isStandardConsumer(
  consumer: OutputConsumer
): consumer is Extract<OutputConsumer, { phase: "baseline" }> {
  return consumer.phase === "baseline";
}

function consumerKey(consumer: OutputConsumer): string {
  return consumer.phase === "baseline"
    ? `0:${consumer.standardProfile}`
    : `1:${consumer.target}`;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((byte, index) => byte === right[index]);
}
