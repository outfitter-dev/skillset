import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MigrationFlag } from "@skillset/schema";
import { ISOLATED_OUT_ROOT, type SkillsetBuildResult } from "./build";
import { createInitialMigrationFlag } from "./migration-state-reconcile";
import { resolveInside } from "./path";
import { isOutputSelected } from "./config";
import { pluginBundleRoot, pluginManifestPath } from "./plugin-output";
import type { BuildGraph, JsonValue, SourceOrigin } from "./types";
import { isJsonRecord } from "./yaml";

interface LocalCandidate {
  readonly pointer: string;
  readonly path?: string;
  readonly originalFile: boolean;
}

/** Ephemeral capture of a selected native Cursor MCP source, not runtime authority. */
export interface McpDependencySource {
  readonly path: string;
  readonly configPath: string;
  readonly contentHash: string;
  readonly origin?: SourceOrigin;
  readonly candidates: readonly LocalCandidate[];
}

export interface McpDependencyFindingSource extends McpDependencySource {
  readonly outputRoot: string;
  readonly emittedPaths: readonly string[];
}

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** Reject symlinks at every component, including links that remain inside the owner. */
async function originalRegularFile(root: string, path: string): Promise<boolean> {
  let current = root;
  const parts = path.split("/");
  try {
    for (const [index, part] of parts.entries()) {
      current = resolveInside(current, part);
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory())) return false;
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return false;
    throw error;
  }
}

export async function captureMcpDependencyCandidates(
  root: string, parsed: JsonValue, content: string, source: Omit<McpDependencySource, "candidates" | "contentHash">
): Promise<McpDependencySource> {
  const servers = isJsonRecord(parsed) && isJsonRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const candidates: LocalCandidate[] = [];
  for (const name of Object.keys(servers).sort()) {
    const server = servers[name];
    if (!isJsonRecord(server) || server.command !== "node") continue;
    const pointer = `/mcpServers/${name.replaceAll("~", "~0").replaceAll("/", "~1")}${Array.isArray(server.args) && server.args.length > 0 ? "/args/0" : ""}`;
    const arg = Array.isArray(server.args) && server.args.length === 1 ? server.args[0] : undefined;
    // This is a candidate inventory, never a claim about Node's cwd or dependency closure.
    const path = server.cwd === undefined && typeof arg === "string" && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js$/.test(arg) ? arg : undefined;
    candidates.push({ pointer, ...(path === undefined ? {} : { path }), originalFile: path !== undefined && await originalRegularFile(root, path) });
  }
  return { ...source, candidates, contentHash: digest(content) };
}

/** Only a successful complete render of the selected provider establishes absence. */
export function qualifyMcpDependencySources(
  sources: readonly McpDependencySource[], graph: BuildGraph, build: Pick<SkillsetBuildResult, "ok" | "data">
): readonly McpDependencyFindingSource[] {
  if (!build.ok) return [];
  const emittedPaths = build.data.map((file) => file.path);
  return sources.flatMap((source) => {
    const plugin = graph.plugins.find((item) => resolve(graph.rootPath, item.configPath) === resolve(graph.rootPath, source.configPath));
    if (plugin === undefined || !plugin.targets.cursor.enabled || !isOutputSelected(graph.root.outputs.targetOutputs.cursor.plugins, plugin.id)) return [];
    const manifestPath = `${ISOLATED_OUT_ROOT}/${pluginManifestPath(graph.root.outputs.plugins.cursor, "cursor", plugin)}`;
    if (!emittedPaths.includes(manifestPath)) return [];
    const outputRoot = `${ISOLATED_OUT_ROOT}/${pluginBundleRoot(graph.root.outputs.plugins.cursor, "cursor", plugin)}`;
    return [{ ...source, outputRoot, emittedPaths }];
  });
}

export function mcpDependencyFindings(source: McpDependencyFindingSource, content: string): readonly MigrationFlag[] {
  if (digest(content) !== source.contentHash) throw new Error(`skillset: ${source.path} changed after MCP dependency capture; repeat adoption before recording projection findings.`);
  return source.candidates.flatMap((candidate) => {
    const output = candidate.path === undefined ? undefined : join(source.outputRoot, candidate.path).replaceAll("\\", "/");
    if (candidate.originalFile && output !== undefined && source.emittedPaths.includes(output)) return [];
    const omitted = candidate.originalFile && output !== undefined;
    return [createInitialMigrationFlag({
      code: omitted ? "adopt.mcp-local-candidate-omitted" : "adopt.mcp-local-candidate-unverified",
      severity: omitted ? "error" : "warning",
      disposition: omitted ? "lossy-unsupported" : "ambiguous",
      message: omitted
        ? `Original local candidate ${candidate.path} exists but is absent from the selected generated package; relative runtime base requires review. Preserve the file at the required packaged path or explicitly revise the command and package layout, then verify that arrangement.`
        : "Node MCP declaration has no verified original local script candidate in the supported literal-path scope; review runtime dependencies manually and explicitly declare the intended script path and runtime base before relying on the package.",
      source: { path: source.path },
      ...(source.origin === undefined ? {} : { origin: { path: source.origin.path } }),
      fingerprints: { content: digest(content), context: digest(candidate.pointer) },
      placement: { kind: "sidecar", reason: "MCP JSON must remain unchanged." },
      evidence: [
        { summary: `Cursor source declaration ${candidate.pointer}; only command=node with one literal relative .js argument and no cwd is inventoried. Runtime working directory and transitive dependencies remain unverified.` },
        ...(omitted ? [{ summary: `Original regular file captured without following symlinks; complete successful isolated render omitted ${output}.` }] : []),
        ...(source.origin?.repo === undefined ? [] : [{ summary: "Original repository.", reference: source.origin.repo }]),
        ...(source.origin?.ref === undefined ? [] : [{ summary: `Original revision: ${source.origin.ref}.` }]),
      ],
      relatedReportIds: [],
    })];
  });
}
