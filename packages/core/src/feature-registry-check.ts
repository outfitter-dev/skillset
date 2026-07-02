import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { compareStrings } from "./path";
import {
  skillsetFeatureRegistry,
  type SkillsetFeatureEntry,
  type SkillsetFeatureEvidence,
  type SkillsetFeatureRegistry,
  type SkillsetRuntimeId,
  type SkillsetRuntimeSupport,
  type SkillsetTargetSupport,
} from "./feature-registry";
import { targetNames } from "./targets";

export type FeatureRegistryDriftCode =
  | "missing-doc-ref"
  | "missing-evidence"
  | "missing-evidence-ref"
  | "missing-owner-ref"
  | "missing-ref-fragment"
  | "outside-root-ref";

export interface FeatureRegistryDriftIssue {
  readonly code: FeatureRegistryDriftCode;
  readonly featureId: string;
  readonly field: string;
  readonly message: string;
  readonly ref?: string;
}

export interface FeatureRegistryDriftReport {
  readonly checkedFeatures: number;
  readonly issues: readonly FeatureRegistryDriftIssue[];
  readonly ok: boolean;
}

export async function checkFeatureRegistryDrift(
  rootPath: string,
  registry: SkillsetFeatureRegistry = skillsetFeatureRegistry
): Promise<FeatureRegistryDriftReport> {
  const resolvedRootPath = resolve(rootPath);
  const issues: FeatureRegistryDriftIssue[] = [];

  for (const feature of registry) {
    checkEvidencePresence(issues, feature);
    await checkDocs(issues, resolvedRootPath, feature);
    await checkOwners(issues, resolvedRootPath, feature);
    await checkEvidenceRefs(issues, resolvedRootPath, feature);
  }

  return {
    checkedFeatures: registry.length,
    issues: issues.sort(compareDriftIssues),
    ok: issues.length === 0,
  };
}

function checkEvidencePresence(
  issues: FeatureRegistryDriftIssue[],
  feature: SkillsetFeatureEntry
): void {
  if (feature.status === "implemented" && feature.evidence.length === 0) {
    issues.push({
      code: "missing-evidence",
      featureId: feature.id,
      field: "evidence",
      message: `implemented feature ${feature.id} requires at least one evidence ref`,
    });
  }

  for (const target of targetNames()) {
    const support = feature.targetSupport[target];
    if (supportRequiresEvidence(support) && (support.evidence?.length ?? 0) === 0) {
      issues.push({
        code: "missing-evidence",
        featureId: feature.id,
        field: `targetSupport.${target}.evidence`,
        message: `${feature.id} ${target} support requires evidence`,
      });
    }
  }

  for (const [runtime, support] of Object.entries(feature.runtimeSupport ?? {}) as ReadonlyArray<
    readonly [SkillsetRuntimeId, SkillsetRuntimeSupport]
  >) {
    if (supportRequiresEvidence(support) && (support.evidence?.length ?? 0) === 0) {
      issues.push({
        code: "missing-evidence",
        featureId: feature.id,
        field: `runtimeSupport.${runtime}.evidence`,
        message: `${feature.id} ${runtime} runtime support requires evidence`,
      });
    }
  }
}

async function checkDocs(
  issues: FeatureRegistryDriftIssue[],
  rootPath: string,
  feature: SkillsetFeatureEntry
): Promise<void> {
  if (feature.docs.length === 0) {
    issues.push({
      code: "missing-doc-ref",
      featureId: feature.id,
      field: "docs",
      message: `${feature.id} requires at least one docs ref`,
    });
    return;
  }

  for (const [index, ref] of feature.docs.entries()) {
    await pushMissingLocalRef(issues, rootPath, {
      code: "missing-doc-ref",
      featureId: feature.id,
      field: `docs[${index}]`,
      kind: "doc",
      ref,
    });
  }
}

async function checkOwners(
  issues: FeatureRegistryDriftIssue[],
  rootPath: string,
  feature: SkillsetFeatureEntry
): Promise<void> {
  await pushMissingLocalRef(issues, rootPath, {
    code: "missing-owner-ref",
    featureId: feature.id,
    field: "renderOwner",
    kind: "owner",
    ref: feature.renderOwner,
  });
  await pushMissingLocalRef(issues, rootPath, {
    code: "missing-owner-ref",
    featureId: feature.id,
    field: "validationOwner",
    kind: "owner",
    ref: feature.validationOwner,
  });
}

async function checkEvidenceRefs(
  issues: FeatureRegistryDriftIssue[],
  rootPath: string,
  feature: SkillsetFeatureEntry
): Promise<void> {
  await checkEvidenceList(issues, rootPath, feature.id, "evidence", feature.evidence);

  for (const target of targetNames()) {
    await checkEvidenceList(
      issues,
      rootPath,
      feature.id,
      `targetSupport.${target}.evidence`,
      feature.targetSupport[target].evidence ?? []
    );
  }

  for (const [runtime, support] of Object.entries(feature.runtimeSupport ?? {}) as ReadonlyArray<
    readonly [SkillsetRuntimeId, SkillsetRuntimeSupport]
  >) {
    await checkEvidenceList(
      issues,
      rootPath,
      feature.id,
      `runtimeSupport.${runtime}.evidence`,
      support.evidence ?? []
    );
  }
}

async function checkEvidenceList(
  issues: FeatureRegistryDriftIssue[],
  rootPath: string,
  featureId: string,
  field: string,
  evidence: readonly SkillsetFeatureEvidence[]
): Promise<void> {
  for (const [index, item] of evidence.entries()) {
    if (!isLocalEvidenceKind(item.kind)) continue;
    await pushMissingLocalRef(issues, rootPath, {
      code: "missing-evidence-ref",
      featureId,
      field: `${field}[${index}]`,
      kind: item.kind,
      ref: item.ref,
    });
  }
}

async function pushMissingLocalRef(
  issues: FeatureRegistryDriftIssue[],
  rootPath: string,
  args: {
    readonly code: FeatureRegistryDriftCode;
    readonly featureId: string;
    readonly field: string;
    readonly kind: string;
    readonly ref: string;
  }
): Promise<void> {
  const { fragment, path: ref } = parseRef(args.ref);
  if (ref === "future" || ref.length === 0 || isExternalRef(ref)) return;
  if (!isInsideRoot(rootPath, ref)) {
    issues.push({
      code: "outside-root-ref",
      featureId: args.featureId,
      field: args.field,
      message: `${args.featureId} ${args.field} points outside root with ${args.kind} ref ${args.ref}`,
      ref: args.ref,
    });
    return;
  }
  const resolvedRef = resolve(rootPath, ref);
  if (await existsExactLocalRef(rootPath, ref)) {
    if (fragment !== undefined) {
      await pushMissingMarkdownFragment(issues, resolvedRef, { ...args, fragment });
    }
    return;
  }
  issues.push({
    code: args.code,
    featureId: args.featureId,
    field: args.field,
    message: `${args.featureId} ${args.field} points to missing ${args.kind} ref ${args.ref}`,
    ref: args.ref,
  });
}

async function pushMissingMarkdownFragment(
  issues: FeatureRegistryDriftIssue[],
  path: string,
  args: {
    readonly featureId: string;
    readonly field: string;
    readonly fragment: string;
    readonly kind: string;
    readonly ref: string;
  }
): Promise<void> {
  if (!path.endsWith(".md") || args.fragment.length === 0) return;
  const expected = normalizeFragment(args.fragment);
  if (expected.length === 0) return;
  const fragments = markdownHeadingFragments(await readFile(path, "utf8"));
  if (fragments.has(expected)) return;
  issues.push({
    code: "missing-ref-fragment",
    featureId: args.featureId,
    field: args.field,
    message: `${args.featureId} ${args.field} points to missing ${args.kind} ref fragment ${args.ref}`,
    ref: args.ref,
  });
}

function isInsideRoot(rootPath: string, ref: string): boolean {
  const relativePath = relative(rootPath, resolve(rootPath, ref));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function supportRequiresEvidence(
  support: Pick<SkillsetRuntimeSupport | SkillsetTargetSupport, "status">
): boolean {
  return support.status !== "future" && support.status !== "planned";
}

function isLocalEvidenceKind(kind: SkillsetFeatureEvidence["kind"]): boolean {
  return kind === "docs" || kind === "fixture" || kind === "source" || kind === "test";
}

function parseRef(ref: string): { readonly fragment?: string; readonly path: string } {
  const [path, fragment] = ref.split("#", 2);
  return {
    ...(fragment === undefined ? {} : { fragment }),
    path: path ?? "",
  };
}

function markdownHeadingFragments(markdown: string): ReadonlySet<string> {
  const fragments = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    const heading = match?.[2];
    if (heading === undefined) continue;
    const base = markdownHeadingSlug(heading);
    if (base.length === 0) continue;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    fragments.add(count === 0 ? base : `${base}-${count}`);
  }
  return fragments;
}

function markdownHeadingSlug(heading: string): string {
  return heading
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

function normalizeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment).toLowerCase();
  } catch {
    return fragment.toLowerCase();
  }
}

function isExternalRef(ref: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(ref);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function existsExactLocalRef(rootPath: string, ref: string): Promise<boolean> {
  const resolvedRef = resolve(rootPath, ref);
  const relativePath = relative(rootPath, resolvedRef);
  if (relativePath === "") return true;

  const parts = relativePath.split(/[\\/]+/u).filter(Boolean);
  let currentPath = rootPath;
  for (const part of parts) {
    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      ) {
        return false;
      }
      throw error;
    }
    if (!entries.includes(part)) return false;
    currentPath = resolve(currentPath, part);
  }
  return exists(currentPath);
}

function compareDriftIssues(
  left: FeatureRegistryDriftIssue,
  right: FeatureRegistryDriftIssue
): number {
  return compareStrings(
    `${left.featureId}\0${left.field}\0${left.code}\0${left.ref ?? ""}`,
    `${right.featureId}\0${right.field}\0${right.code}\0${right.ref ?? ""}`
  );
}
