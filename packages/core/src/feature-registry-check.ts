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
import type { TargetName } from "./types";

const FEATURE_SUPPORT_MATRIX_START = "<!-- skillset:feature-support:start -->";
const FEATURE_SUPPORT_MATRIX_END = "<!-- skillset:feature-support:end -->";

export type FeatureRegistryDriftCode =
  | "feature-support-table-drift"
  | "missing-doc-ref"
  | "missing-evidence"
  | "missing-evidence-ref"
  | "missing-owner-ref"
  | "missing-ref-fragment"
  | "outside-root-ref";

export interface FeatureRegistryDriftIssue {
  readonly actual?: string;
  readonly code: FeatureRegistryDriftCode;
  readonly expected?: string;
  readonly featureId: string;
  readonly field: string;
  readonly message: string;
  readonly ref?: string;
  readonly target?: TargetName;
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
  await checkFeatureSupportMatrices(issues, resolvedRootPath, registry);

  return {
    checkedFeatures: registry.length,
    issues: issues.sort(compareDriftIssues),
    ok: issues.length === 0,
  };
}

export function renderFeatureSupportMatrix(registry: SkillsetFeatureRegistry): string {
  const targets = targetNames();
  const header = ["Feature", "Feature status", ...targets];
  const rows = [...registry]
    .sort((left, right) => compareStrings(left.id, right.id))
    .map((feature) => [
      codeCell(feature.id),
      codeCell(feature.status),
      ...targets.map((target) => codeCell(feature.targetSupport[target].status)),
    ]);
  return [
    FEATURE_SUPPORT_MATRIX_START,
    markdownTableRow(header),
    markdownTableRow(header.map(() => "---")),
    ...rows.map(markdownTableRow),
    FEATURE_SUPPORT_MATRIX_END,
  ].join("\n");
}

async function checkFeatureSupportMatrices(
  issues: FeatureRegistryDriftIssue[],
  rootPath: string,
  registry: SkillsetFeatureRegistry
): Promise<void> {
  const targets = targetNames();
  for (const [ref, features] of featureDocs(registry)) {
    if (!isInsideRoot(rootPath, ref) || !(await existsExactLocalRef(rootPath, ref))) continue;
    const markdown = await readFile(resolve(rootPath, ref), "utf8");
    const actual = parseFeatureSupportMatrix(markdown);

    if (actual !== undefined) {
      const expectedColumns = ["Feature", "Feature status", ...targets];
      if (!sameStrings(actual.columns, expectedColumns)) {
        const feature = features[0];
        const target = targets[0];
        if (feature !== undefined && target !== undefined) {
          const expected = expectedColumns.join(", ");
          const found = actual.columns.join(", ");
          issues.push({
            actual: found,
            code: "feature-support-table-drift",
            expected,
            featureId: feature.id,
            field: "matrix.columns",
            message: `${feature.id} ${target} matrix.columns expected ${expected} but found ${found}`,
            ref,
            target,
          });
        }
      }

      const expectedRows = features.map((feature) => feature.id);
      if (!sameStrings(actual.rows, expectedRows)) {
        const mismatchIndex = firstMismatchIndex(actual.rows, expectedRows);
        const featureId = expectedRows[mismatchIndex] ?? actual.rows[mismatchIndex] ?? features[0]?.id;
        const target = targets[0];
        if (featureId !== undefined && target !== undefined) {
          const expected = expectedRows.join(", ");
          const found = actual.rows.join(", ");
          issues.push({
            actual: found,
            code: "feature-support-table-drift",
            expected,
            featureId,
            field: "matrix.rows",
            message: `${featureId} ${target} matrix.rows expected ${expected} but found ${found}`,
            ref,
            target,
          });
        }
      }
    }

    for (const feature of features) {
      const actualFeature = actual?.features.get(feature.id);
      pushFeatureSupportMismatch(issues, {
        actual: actualFeature?.status,
        expected: feature.status,
        featureId: feature.id,
        field: "status",
        ref,
      });
      for (const target of targets) {
        pushFeatureSupportMismatch(issues, {
          actual: actualFeature?.targetSupport.get(target),
          expected: feature.targetSupport[target].status,
          featureId: feature.id,
          field: `targetSupport.${target}.status`,
          ref,
          target,
        });
      }
    }

    if (actual === undefined) continue;
    const expectedIds = new Set(features.map((feature) => feature.id));
    for (const featureId of actual.features.keys()) {
      if (expectedIds.has(featureId)) continue;
      issues.push({
        actual: "present",
        code: "feature-support-table-drift",
        expected: "absent",
        featureId,
        field: "id",
        message: `${featureId} feature id expected absent but found present`,
        ref,
      });
    }
  }
}

function featureDocs(
  registry: SkillsetFeatureRegistry
): readonly (readonly [string, readonly SkillsetFeatureEntry[]])[] {
  const grouped = new Map<string, Map<string, SkillsetFeatureEntry>>();
  for (const feature of registry) {
    for (const docRef of feature.docs) {
      const { path } = parseRef(docRef);
      if (!path.startsWith("docs/features/") || !path.endsWith(".md")) continue;
      const features = grouped.get(path) ?? new Map<string, SkillsetFeatureEntry>();
      features.set(feature.id, feature);
      grouped.set(path, features);
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([path, features]) => [
      path,
      [...features.values()].sort((left, right) => compareStrings(left.id, right.id)),
    ] as const);
}

function pushFeatureSupportMismatch(
  issues: FeatureRegistryDriftIssue[],
  args: {
    readonly actual: string | undefined;
    readonly expected: string;
    readonly featureId: string;
    readonly field: string;
    readonly ref: string;
    readonly target?: TargetName;
  }
): void {
  if (args.actual === args.expected) return;
  const actual = args.actual ?? "missing";
  const subject = args.target === undefined ? `${args.featureId} feature` : `${args.featureId} ${args.target}`;
  issues.push({
    actual,
    code: "feature-support-table-drift",
    expected: args.expected,
    featureId: args.featureId,
    field: args.field,
    message: `${subject} ${args.field} expected ${args.expected} but found ${actual}`,
    ref: args.ref,
    ...(args.target === undefined ? {} : { target: args.target }),
  });
}

function parseFeatureSupportMatrix(markdown: string): {
  readonly columns: readonly string[];
  readonly features: ReadonlyMap<
    string,
    { readonly status: string | undefined; readonly targetSupport: ReadonlyMap<string, string> }
  >;
  readonly rows: readonly string[];
} | undefined {
  const start = markdown.indexOf(FEATURE_SUPPORT_MATRIX_START);
  const end = markdown.indexOf(FEATURE_SUPPORT_MATRIX_END);
  if (
    start === -1 ||
    end === -1 ||
    end < start ||
    markdown.indexOf(FEATURE_SUPPORT_MATRIX_START, start + FEATURE_SUPPORT_MATRIX_START.length) !== -1 ||
    markdown.indexOf(FEATURE_SUPPORT_MATRIX_END, end + FEATURE_SUPPORT_MATRIX_END.length) !== -1
  ) {
    return undefined;
  }

  const block = markdown.slice(start + FEATURE_SUPPORT_MATRIX_START.length, end).trim();
  const tableLines = block.length === 0 ? [] : block.split(/\r?\n/u).map((line) => line.trim());
  if (
    tableLines.length < 3 ||
    tableLines.some((line) => !line.startsWith("|") || !line.endsWith("|"))
  ) {
    return undefined;
  }
  const header = tableLines[0] === undefined ? [] : parseMarkdownTableRow(tableLines[0]);
  const separator = tableLines[1] === undefined ? [] : parseMarkdownTableRow(tableLines[1]);
  if (
    separator.length !== header.length ||
    separator.some((cell) => cell !== "---")
  ) {
    return undefined;
  }
  const featureIndex = header.indexOf("Feature");
  const statusIndex = header.indexOf("Feature status");
  if (featureIndex === -1 || statusIndex === -1) return undefined;

  const targetIndexes = new Map<string, number>();
  for (const [index, cell] of header.entries()) {
    if (index === featureIndex || index === statusIndex) continue;
    targetIndexes.set(cell, index);
  }

  const features = new Map<
    string,
    { readonly status: string | undefined; readonly targetSupport: ReadonlyMap<string, string> }
  >();
  const rows: string[] = [];
  for (const line of tableLines.slice(2)) {
    const cells = parseMarkdownTableRow(line);
    if (cells.length !== header.length) return undefined;
    const featureId = plainCodeCell(cells[featureIndex]);
    if (featureId === undefined || featureId.length === 0) return undefined;
    rows.push(featureId);
    const support = new Map<string, string>();
    for (const [target, index] of targetIndexes) {
      const value = plainCodeCell(cells[index]);
      if (value !== undefined && value.length > 0) support.set(target, value);
    }
    features.set(featureId, {
      status: plainCodeCell(cells[statusIndex]),
      targetSupport: support,
    });
  }
  return { columns: header, features, rows };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function firstMismatchIndex(left: readonly string[], right: readonly string[]): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return sharedLength;
}

function markdownTableRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function parseMarkdownTableRow(line: string): readonly string[] {
  return line.slice(1, -1).split("|").map((cell) => cell.trim());
}

function codeCell(value: string): string {
  return `\`${value}\``;
}

function plainCodeCell(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("`") && value.endsWith("`") && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
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
