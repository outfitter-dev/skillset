import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import { targetNames } from "@skillset/core/internal/config";
import { compareStrings } from "@skillset/core/internal/path";
import type { JsonRecord, TargetName } from "@skillset/core/internal/types";

import {
  portablePluginMetadataConflicts,
  type PortablePluginMetadataConflict,
} from "./plugin-manifest-authority";

export type PluginAdoptionRelation = "equivalent" | "single-source";

export interface PluginAdoptionGroup {
  readonly identity: string;
  readonly paths: readonly string[];
  readonly primaryPath: string;
  readonly providers: readonly TargetName[];
  readonly relation: PluginAdoptionRelation;
}

export interface PluginAdoptionDiagnostic {
  readonly code:
    | "competing-plugin-sources"
    | "invalid-plugin-manifest"
    | "plugin-identity-conflict"
    | "plugin-metadata-conflict"
    | "plugin-version-conflict"
    | "similar-plugin-sources";
  readonly evidence: readonly string[];
  readonly identities?: readonly string[];
  readonly identity?: string;
  readonly message: string;
  readonly paths: readonly string[];
  readonly providers: readonly TargetName[];
  readonly recommendation: string;
  readonly severity: "error" | "warning";
}

export interface PluginAdoptionClassification {
  readonly diagnostics: readonly PluginAdoptionDiagnostic[];
  readonly groups: readonly PluginAdoptionGroup[];
}

interface InspectedPluginSource {
  readonly identity: string;
  readonly identityFromManifest: boolean;
  readonly manifestHashes: ReadonlyMap<TargetName, string>;
  readonly manifests: ReadonlyMap<TargetName, JsonRecord>;
  readonly manifestVersions: ReadonlyMap<TargetName, string | undefined>;
  readonly materialEntries: readonly string[];
  readonly materialHash?: string;
  readonly path: string;
  readonly providers: readonly TargetName[];
}

/**
 * Classifies native plugin roots before adoption writes anything. Exact source
 * evidence can join provider-specific roots; a matching name alone cannot.
 */
export async function classifyPluginAdoptionCandidates(
  rootPath: string,
  paths: readonly string[]
): Promise<PluginAdoptionClassification> {
  const inspection = await inspectDistinctSources(rootPath, paths);
  const sources = inspection.sources;
  const diagnostics: PluginAdoptionDiagnostic[] = [...inspection.diagnostics];
  const groups: PluginAdoptionGroup[] = [];

  const byIdentity = new Map<string, InspectedPluginSource[]>();
  for (const source of sources) {
    const matches = byIdentity.get(source.identity) ?? [];
    matches.push(source);
    byIdentity.set(source.identity, matches);
  }

  for (const identity of [...byIdentity.keys()].sort(compareStrings)) {
    const matches = (byIdentity.get(identity) ?? []).sort(compareSource);
    if (matches.length === 1) {
      groups.push(groupForSources(matches, "single-source"));
      continue;
    }

    const evidence = equivalenceEvidence(matches);
    if (!evidence.equivalent) {
      groups.push(...matches.map((source) => groupForSources([source], "single-source")));
      const pathsForIdentity = matches.map((source) => source.path);
      const providers = providerUnion(matches);
      diagnostics.push({
        code: "competing-plugin-sources",
        evidence: evidence.details,
        identity,
        message:
          `Native plugin candidates ${formatPaths(pathsForIdentity)} declare the same plugin identity ` +
          `\`${identity}\` but do not have equivalent source evidence.`,
        paths: pathsForIdentity,
        providers,
        recommendation:
          "Consolidate the provider manifests around one shared plugin source, or give intentionally separate plugins distinct identities before adopting.",
        severity: "error",
      });
      continue;
    }

    const metadataConflicts = metadataConflictsForSources(matches);
    if (metadataConflicts.length > 0) {
      groups.push(...matches.map((source) => groupForSources([source], "single-source")));
      diagnostics.push(
        metadataConflictDiagnostic(
          identity,
          matches.map((source) => source.path),
          providerUnion(matches),
          metadataConflicts
        )
      );
      continue;
    }
    groups.push(groupForSources(matches, "equivalent"));
  }

  diagnostics.push(...similarIdentityDiagnostics(sources));

  return {
    diagnostics: diagnostics.sort(compareDiagnostic),
    groups: groups.sort(compareGroup),
  };
}

async function inspectDistinctSources(
  rootPath: string,
  paths: readonly string[]
): Promise<{
  readonly diagnostics: readonly PluginAdoptionDiagnostic[];
  readonly sources: readonly InspectedPluginSource[];
}> {
  const normalizedRoot = await realpath(rootPath);
  const seen = new Set<string>();
  const distinct: { readonly path: string; readonly realSource: string }[] = [];
  for (const path of [...paths].sort(compareStrings)) {
    const absolutePath = resolve(normalizedRoot, path);
    const realSource = await realpath(absolutePath);
    if (realSource !== normalizedRoot && !realSource.startsWith(`${normalizedRoot}/`)) {
      throw new Error(`skillset: plugin adoption candidate escapes the repo: ${path}`);
    }
    if (seen.has(realSource)) continue;
    seen.add(realSource);
    distinct.push({ path, realSource });
  }
  const inspections = await Promise.all(
    distinct.map(({ realSource }) =>
      inspectSource(
        normalizedRoot,
        realSource,
        new Set(
          distinct
            .map((candidate) => candidate.realSource)
            .filter((candidate) => candidate !== realSource && candidate.startsWith(`${realSource}/`))
        )
      )
    )
  );
  return {
    diagnostics: inspections.flatMap((inspection) => inspection.diagnostics).sort(compareDiagnostic),
    sources: inspections.map((inspection) => inspection.source).sort(compareSource),
  };
}

async function inspectSource(
  rootPath: string,
  sourcePath: string,
  excludedSourceRoots: ReadonlySet<string>
): Promise<{
  readonly diagnostics: readonly PluginAdoptionDiagnostic[];
  readonly source: InspectedPluginSource;
}> {
  const manifestHashes = new Map<TargetName, string>();
  const manifests = new Map<TargetName, JsonRecord>();
  const manifestVersions = new Map<TargetName, string | undefined>();
  const manifestNames: string[] = [];
  const providers: TargetName[] = [];
  const diagnostics: PluginAdoptionDiagnostic[] = [];
  const path = normalizedRelative(rootPath, sourcePath);

  for (const provider of targetNames()) {
    const manifestPath = join(sourcePath, `.${provider}-plugin`, "plugin.json");
    const content = await readOptionalFile(manifestPath);
    if (content === undefined) continue;
    providers.push(provider);
    manifestHashes.set(provider, hash(content));
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      diagnostics.push(invalidManifestDiagnostic(path, provider, error));
      continue;
    }
    if (!isRecord(parsed)) {
      diagnostics.push(
        invalidManifestDiagnostic(
          path,
          provider,
          new Error("the document must contain a JSON object")
        )
      );
      continue;
    }
    manifests.set(provider, parsed as JsonRecord);
    manifestVersions.set(
      provider,
      typeof parsed.version === "string" && parsed.version.trim().length > 0
        ? parsed.version.trim()
        : undefined
    );
    if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
      manifestNames.push(parsed.name.trim());
    }
  }

  const distinctNames = [...new Set(manifestNames)].sort(compareStrings);
  if (distinctNames.length > 1) {
    diagnostics.push({
      code: "plugin-identity-conflict",
      evidence: distinctNames.map((name) => `manifest identity ${name}`),
      identities: distinctNames,
      message:
        `Native plugin manifests in \`${path}\` disagree on plugin identity: ${distinctNames.map((name) => `\`${name}\``).join(", ")}.`,
      paths: [path],
      providers,
      recommendation: "Align the provider manifest names before adopting this plugin source.",
      severity: "error",
    });
  }
  const distinctVersions = new Set(
    [...manifestVersions.values()].map((version) => version ?? "<missing>")
  );
  if (distinctVersions.size > 1) {
    diagnostics.push({
      code: "plugin-version-conflict",
      evidence: [...manifestVersions.entries()].map(
        ([provider, version]) => `${provider} version ${version ?? "missing"}`
      ),
      message: `Native plugin manifests in \`${path}\` disagree on plugin version.`,
      paths: [path],
      providers,
      recommendation:
        "Align provider manifest versions before adoption; Skillset release state must have one authoritative plugin version.",
      severity: "error",
    });
  }
  const metadataConflicts = portablePluginMetadataConflicts(manifests);
  if (metadataConflicts.length > 0) {
    diagnostics.push(
      metadataConflictDiagnostic(
        distinctNames[0] ?? basename(sourcePath),
        [path],
        providers,
        metadataConflicts
      )
    );
  }

  const materialEntries = await collectMaterialEntries(sourcePath, excludedSourceRoots);
  return {
    diagnostics,
    source: {
      identity: distinctNames[0] ?? basename(sourcePath),
      identityFromManifest: distinctNames.length === 1,
      manifestHashes,
      manifests,
      manifestVersions,
      materialEntries,
      ...(materialEntries.length === 0 ? {} : { materialHash: hash(materialEntries.join("\n")) }),
      path,
      providers,
    },
  };
}

function metadataConflictsForSources(
  sources: readonly InspectedPluginSource[]
): readonly PortablePluginMetadataConflict[] {
  return portablePluginMetadataConflicts(
    sources.flatMap((source) => [...source.manifests.entries()])
  );
}

function metadataConflictDiagnostic(
  identity: string,
  paths: readonly string[],
  providers: readonly TargetName[],
  conflicts: readonly PortablePluginMetadataConflict[]
): PluginAdoptionDiagnostic {
  return {
    code: "plugin-metadata-conflict",
    evidence: conflicts.map(
      (conflict) =>
        `portable manifest field ${conflict.field} differs across ${conflict.providers.join(", ")}`
    ),
    identity,
    message: `Native plugin manifests for \`${identity}\` disagree on portable plugin metadata.`,
    paths,
    providers,
    recommendation:
      "Align portable metadata across provider manifests before adoption; Skillset source keeps one canonical value for every portable field.",
    severity: "error",
  };
}

function invalidManifestDiagnostic(
  sourcePath: string,
  provider: TargetName,
  error: unknown
): PluginAdoptionDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const relativeManifest = `${sourcePath === "." ? "" : `${sourcePath}/`}.${provider}-plugin/plugin.json`;
  return {
    code: "invalid-plugin-manifest",
    evidence: [`${relativeManifest}: ${message}`],
    message: `The ${provider} plugin manifest in \`${sourcePath}\` is not a valid JSON object.`,
    paths: [sourcePath],
    providers: [provider],
    recommendation: `Repair \`${relativeManifest}\` before adopting this plugin source.`,
    severity: "error",
  };
}

async function collectMaterialEntries(
  sourcePath: string,
  excludedSourceRoots: ReadonlySet<string>
): Promise<readonly string[]> {
  const entries: string[] = [];
  await walkMaterial(sourcePath, sourcePath, entries, excludedSourceRoots);
  return entries.sort(compareStrings);
}

async function walkMaterial(
  rootPath: string,
  currentPath: string,
  entries: string[],
  excludedSourceRoots: ReadonlySet<string>
): Promise<void> {
  for (const entry of (await readdir(currentPath, { withFileTypes: true })).sort((left, right) =>
    compareStrings(left.name, right.name)
  )) {
    if (entry.name === ".DS_Store" || entry.name === ".git") continue;
    if (currentPath === rootPath && isNativeManifestDirectory(entry.name)) continue;
    const path = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (excludedSourceRoots.has(await realpath(path))) continue;
      await walkMaterial(rootPath, path, entries, excludedSourceRoots);
    } else if (entry.isFile()) {
      const relativePath = normalizedRelative(rootPath, path);
      entries.push(`${relativePath}\0${hash(await readFile(path))}`);
    }
  }
}

function isNativeManifestDirectory(name: string): boolean {
  return targetNames().some((provider) => name === `.${provider}-plugin`);
}

function equivalenceEvidence(sources: readonly InspectedPluginSource[]): {
  readonly details: readonly string[];
  readonly equivalent: boolean;
} {
  const details = sources.map(
    (source) =>
      `${source.path}: providers ${source.providers.join(", ") || "none"}; ` +
      `identity ${source.identityFromManifest ? "manifest" : "directory"}; ` +
      `material ${source.materialHash ?? "none"}`
  );
  if (sources.some((source) => !source.identityFromManifest)) {
    return { details: [...details, "directory names alone do not prove plugin identity"], equivalent: false };
  }
  if (sources.some((source) => source.materialHash === undefined)) {
    return {
      details: [...details, "no shared non-manifest source files prove equivalence"],
      equivalent: false,
    };
  }
  const materialHash = sources[0]?.materialHash;
  if (sources.some((source) => source.materialHash !== materialHash)) {
    return { details: [...details, "non-manifest source trees differ"], equivalent: false };
  }
  const versions = new Set(
    sources.flatMap((source) =>
      [...source.manifestVersions.values()].map((version) => version ?? "<missing>")
    )
  );
  if (versions.size > 1) {
    return { details: [...details, "provider manifest versions differ"], equivalent: false };
  }
  if (hasConflictingProviderManifests(sources)) {
    return { details: [...details, "the same provider has conflicting native manifests"], equivalent: false };
  }
  return { details, equivalent: true };
}

function hasConflictingProviderManifests(sources: readonly InspectedPluginSource[]): boolean {
  for (const provider of targetNames()) {
    const hashes = new Set(
      sources.flatMap((source) => {
        const manifestHash = source.manifestHashes.get(provider);
        return manifestHash === undefined ? [] : [manifestHash];
      })
    );
    if (hashes.size > 1) return true;
  }
  return false;
}

function similarIdentityDiagnostics(
  sources: readonly InspectedPluginSource[]
): readonly PluginAdoptionDiagnostic[] {
  const byMaterial = new Map<string, InspectedPluginSource[]>();
  for (const source of sources) {
    if (source.materialHash === undefined) continue;
    const matches = byMaterial.get(source.materialHash) ?? [];
    matches.push(source);
    byMaterial.set(source.materialHash, matches);
  }

  const diagnostics: PluginAdoptionDiagnostic[] = [];
  for (const materialHash of [...byMaterial.keys()].sort(compareStrings)) {
    const matches = (byMaterial.get(materialHash) ?? []).sort(compareSource);
    const identities = [...new Set(matches.map((source) => source.identity))].sort(compareStrings);
    if (identities.length < 2) continue;
    const paths = matches.map((source) => source.path);
    diagnostics.push({
      code: "similar-plugin-sources",
      evidence: [`matching non-manifest source hash ${materialHash}`],
      identities,
      message:
        `Native plugin candidates ${formatPaths(paths)} use different identities but have identical non-manifest source material.`,
      paths,
      providers: providerUnion(matches),
      recommendation:
        "Review whether these are intentionally separate plugins. Keep them separate, or align their manifest identities before adopting if they are one plugin.",
      severity: "warning",
    });
  }
  return diagnostics;
}

function groupForSources(
  sources: readonly InspectedPluginSource[],
  relation: PluginAdoptionRelation
): PluginAdoptionGroup {
  const paths = sources.map((source) => source.path).sort(compareStrings);
  return {
    identity: sources[0]?.identity ?? "plugin",
    paths,
    primaryPath: paths[0] ?? ".",
    providers: providerUnion(sources),
    relation,
  };
}

function providerUnion(sources: readonly InspectedPluginSource[]): readonly TargetName[] {
  const providers = new Set<TargetName>();
  for (const source of sources) for (const provider of source.providers) providers.add(provider);
  return targetNames().filter((provider) => providers.has(provider));
}

function compareSource(left: InspectedPluginSource, right: InspectedPluginSource): number {
  return compareStrings(left.path, right.path);
}

function compareGroup(left: PluginAdoptionGroup, right: PluginAdoptionGroup): number {
  return compareStrings(left.identity, right.identity) || compareStrings(left.primaryPath, right.primaryPath);
}

function compareDiagnostic(left: PluginAdoptionDiagnostic, right: PluginAdoptionDiagnostic): number {
  return compareStrings(left.code, right.code) || compareStrings(left.paths[0] ?? "", right.paths[0] ?? "");
}

function normalizedRelative(rootPath: string, path: string): string {
  const value = relative(rootPath, path).replaceAll("\\", "/");
  return value.length === 0 ? "." : value;
}

function formatPaths(paths: readonly string[]): string {
  return paths.map((path) => `\`${path}\``).join(", ");
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
