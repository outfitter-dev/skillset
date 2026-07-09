import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";

import { renderValidatedJson } from "@skillset/core/internal/structured-output";
import type { BuildGraph, JsonRecord, SkillsetOptions } from "@skillset/core/internal/types";

export interface RetainedRunIdOptions {
  readonly fallbackName?: string;
  readonly includeName?: boolean;
}

export interface RetainedRunRootPaths {
  readonly absolute: {
    readonly latestJsonPath: string;
    readonly rootPath: string;
    readonly runsRoot: string;
  };
  readonly logical: {
    readonly latestJsonPath: string;
    readonly rootPath: string;
    readonly runsRoot: string;
  };
}

export interface RetainedRunPaths extends RetainedRunRootPaths {
  readonly absolute: RetainedRunRootPaths["absolute"] & {
    readonly runPath: string;
  };
  readonly logical: RetainedRunRootPaths["logical"] & {
    readonly runPath: string;
  };
}

export function makeRetainedRunId(name: string, options: RetainedRunIdOptions = {}): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const safeName = slugifyRunName(name, options.fallbackName ?? "run");
  const digest = createHash("sha256").update(`${safeName}:${stamp}:${randomBytes(8).toString("hex")}`).digest("hex").slice(0, 8);
  return options.includeName === true ? `${stamp}-${safeName}-${digest}` : `${stamp}-${digest}`;
}

export function retainedRunRootPaths(
  rootPath: string,
  graph: BuildGraph,
  logicalRoot: string,
  xdg: SkillsetOptions["xdg"] = undefined
): RetainedRunRootPaths {
  const normalizedRoot = normalizeLogicalPath(logicalRoot);
  const context = createOperationalPathContext(rootPath, {
    ...(graph.root.workspace.cacheKey === undefined ? {} : { workspaceCacheKey: graph.root.workspace.cacheKey }),
    ...(xdg?.env === undefined ? {} : { env: xdg.env }),
    ...(xdg?.homeDir === undefined ? {} : { homeDir: xdg.homeDir }),
  });
  return {
    absolute: {
      latestJsonPath: resolveOperationalPath(context, join(normalizedRoot, "latest.json")),
      rootPath: resolveOperationalPath(context, normalizedRoot),
      runsRoot: resolveOperationalPath(context, join(normalizedRoot, "runs")),
    },
    logical: {
      latestJsonPath: normalizeLogicalPath(join(normalizedRoot, "latest.json")),
      rootPath: normalizedRoot,
      runsRoot: normalizeLogicalPath(join(normalizedRoot, "runs")),
    },
  };
}

export function retainedRunPaths(
  rootPath: string,
  graph: BuildGraph,
  logicalRoot: string,
  runId: string,
  xdg: SkillsetOptions["xdg"] = undefined
): RetainedRunPaths {
  const root = retainedRunRootPaths(rootPath, graph, logicalRoot, xdg);
  return {
    absolute: {
      ...root.absolute,
      runPath: join(root.absolute.runsRoot, runId),
    },
    logical: {
      ...root.logical,
      runPath: normalizeLogicalPath(join(root.logical.runsRoot, runId)),
    },
  };
}

export function resolveRetainedRunPath(
  rootPath: string,
  graph: BuildGraph,
  logicalPath: string,
  xdg: SkillsetOptions["xdg"] = undefined
): string {
  const context = createOperationalPathContext(rootPath, {
    ...(graph.root.workspace.cacheKey === undefined ? {} : { workspaceCacheKey: graph.root.workspace.cacheKey }),
    ...(xdg?.env === undefined ? {} : { env: xdg.env }),
    ...(xdg?.homeDir === undefined ? {} : { homeDir: xdg.homeDir }),
  });
  return resolveOperationalPath(context, logicalPath);
}

export async function writeRetainedRunLatest(
  paths: RetainedRunRootPaths,
  record: JsonRecord
): Promise<void> {
  await mkdir(paths.absolute.rootPath, { recursive: true });
  await writeFile(paths.absolute.latestJsonPath, renderValidatedJson(record, paths.logical.latestJsonPath), "utf8");
}

export async function readRetainedRunLatest(
  rootPath: string,
  graph: BuildGraph,
  logicalRoot: string,
  xdg: SkillsetOptions["xdg"] = undefined
): Promise<JsonRecord> {
  const paths = retainedRunRootPaths(rootPath, graph, logicalRoot, xdg);
  const latest = JSON.parse(await readFile(paths.absolute.latestJsonPath, "utf8")) as unknown;
  if (!isJsonRecord(latest)) throw new Error("skillset: retained run latest is malformed");
  return latest;
}

function slugifyRunName(name: string, fallbackName: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallbackName;
}

function normalizeLogicalPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
