import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual, promisify } from "node:util";
import { join, relative } from "node:path";
import { getProviderHookEvidence, getProviderRuntimeHookDestination } from "@skillset/registry";

import { readString } from "./config";
import type { ParsedGeneratedLockItem } from "./generated-lock";
import { readCurrentGeneratedLockFromDisk } from "./generated-lock-read";
import { WORKSPACE_LOCK_ROOT } from "./render-support";
import { hashRenderedFiles } from "./rendered-files-hash";
import { targetNames } from "./targets";
import { hashCommand, hashForeignSettings } from "./settings-entry";
import { composeSessionStartText, hasCommand } from "./settings-json-edit";
import type { BuildGraph, JsonRecord, JsonValue, RenderedFile, SettingsEntryOwnership, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const execFile = promisify(execFileCallback);
export const SESSION_START_COMMAND = "npx skillset hooks run session-start";
export const SESSION_START_KEY_PATH = "hooks.SessionStart[*].hooks[*].command";
export const PROJECT_SESSION_START_TARGETS = ["claude", "codex"] as const satisfies readonly TargetName[];
const PROJECT_SESSION_START_TARGET_SET: ReadonlySet<TargetName> = new Set(PROJECT_SESSION_START_TARGETS);
type ProjectSessionStartTarget = (typeof PROJECT_SESSION_START_TARGETS)[number];
const CODEX_START_SOURCES = ["startup", "resume"] as const;
const CODEX_PROJECT_HOOKS_PATH = (() => {
  const destination = getProviderRuntimeHookDestination("codex");
  if (destination.status !== "verified" || !destination.path.startsWith("<project>/.codex/")) {
    throw new Error("skillset: Codex project hook destination has no verified project path");
  }
  return destination.path.slice("<project>/".length);
})();

export function isProjectSessionStartTarget(target: TargetName): target is ProjectSessionStartTarget {
  return PROJECT_SESSION_START_TARGET_SET.has(target);
}

export function projectSessionStartPath(target: ProjectSessionStartTarget, projectRoot = `.${target}`): string {
  return target === "claude"
    ? join(projectRoot, "settings.json")
    : join(projectRoot, relative(".codex", CODEX_PROJECT_HOOKS_PATH));
}

export function projectSessionStartEntry(target: ProjectSessionStartTarget): JsonRecord {
  const evidence = getProviderHookEvidence(target);
  const sessionStart = evidence.events.find((event) => event.name === "SessionStart");
  if (sessionStart === undefined) throw new Error(`skillset: missing ${target} SessionStart evidence`);
  const sources = target === "claude" ? sessionStart.matcherValues : CODEX_START_SOURCES;
  if (sources.some((source) => !sessionStart.matcherValues.includes(source))) {
    throw new Error(`skillset: unsupported ${target} SessionStart matcher`);
  }
  const handler: Record<string, JsonValue> = { type: "command", command: SESSION_START_COMMAND };
  if (target === "codex") {
    const configuredLimit = evidence.outputLimits.find((limit) => limit.field === "additionalContext" && limit.kind === "configured-example");
    if (configuredLimit === undefined) throw new Error("skillset: missing Codex additionalContextLimit evidence");
    handler.additionalContextLimit = configuredLimit.value;
  }
  return {
    matcher: sources.join("|"),
    hooks: [handler],
  };
}

export interface RenderedProjectHook {
  readonly file: RenderedFile;
  readonly managed: boolean;
  readonly ownership: SettingsEntryOwnership;
  readonly renderInputsHash?: string;
  readonly sourceHash: string;
  readonly target: ProjectSessionStartTarget;
}

export interface ProjectSettingsIsland {
  readonly file: RenderedFile;
  readonly sourceHash: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function renderProjectSessionStartHooks(
  graph: BuildGraph,
  sourceIslands: ReadonlyMap<string, ProjectSettingsIsland> = new Map()
): Promise<readonly RenderedProjectHook[]> {
  const targets = PROJECT_SESSION_START_TARGETS.filter(
    (target) => graph.root.targets[target].enabled
  );
  if (graph.root.compile.sessionStartHook === "off") return renderExistingOff(graph, targets, sourceIslands);
  if (graph.root.compile.sessionStartHook === "auto") {
    const skillRoots = targetNames()
      .filter((target) => graph.root.targets[target].enabled)
      .map((target) => graph.root.outputs.skills[target]);
    const enabled = await Promise.all(
      skillRoots.map((path) => outputRootIsIgnored(graph, path))
    );
    if (enabled.some((ignored) => !ignored)) return renderExistingOff(graph, targets, sourceIslands);
  }
  const results = await Promise.all(targets.map((target) => renderProjectHook(graph, target, false, sourceIslands)));
  return results.filter((result): result is RenderedProjectHook => result !== undefined);
}

async function renderExistingOff(
  graph: BuildGraph,
  targets: readonly ProjectSessionStartTarget[],
  sourceIslands: ReadonlyMap<string, ProjectSettingsIsland>
): Promise<readonly RenderedProjectHook[]> {
  const rendered: RenderedProjectHook[] = [];
  for (const target of targets) {
    const result = await renderProjectHook(graph, target, true, sourceIslands);
    if (result !== undefined) rendered.push(result);
  }
  return rendered;
}

async function renderProjectHook(
  graph: BuildGraph,
  target: ProjectSessionStartTarget,
  removeOnly = false,
  sourceIslands: ReadonlyMap<string, ProjectSettingsIsland> = new Map()
): Promise<RenderedProjectHook | undefined> {
  const projectRoot = readString(graph.root.targets[target].options, "projectRoot") ?? `.${target}`;
  const outputPath = projectSessionStartPath(target, projectRoot);
  if (target === "claude") await assertNoLegacyClaudeSessionStart(graph.rootPath, projectRoot);
  const absolutePath = join(graph.rootPath, outputPath);
  const island = sourceIslands.get(outputPath);
  const commandHash = hashCommand(SESSION_START_COMMAND);
  const sourceHash = hashBytes(textEncoder.encode(`${relative(graph.rootPath, graph.rootConfigPath)}\0${target}\0${commandHash}${island === undefined ? "" : `\0${hashBytes(island.file.content)}`}`));
  let existing: JsonRecord = {};
  let sourceText = "{}\n";
  let partialSourceHash = "absent";
  let liveBytes: Uint8Array | undefined;
  try {
    const sourceBytes = await readFile(absolutePath);
    liveBytes = sourceBytes;
    partialSourceHash = hashBytes(sourceBytes);
    sourceText = textDecoder.decode(sourceBytes);
    existing = JSON.parse(sourceText) as JsonRecord;
    if (!isJsonRecord(existing)) throw new Error("root must be an object");
  } catch (error) {
    if (!isNotFound(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`skillset: ${outputPath} is not valid JSON: ${message}`);
    }
    if (island !== undefined) {
      sourceText = textDecoder.decode(island.file.content);
      existing = JSON.parse(sourceText) as JsonRecord;
      if (!isJsonRecord(existing)) throw new Error(`skillset: ${outputPath} is not a JSON object`);
    }
  }

  const previousOwnership = await previousSettingsOwnership(graph.rootPath, outputPath);
  const previous = previousOwnership?.settings;
  const previousIsland = previousOwnership?.island;
  const islandText = island === undefined ? undefined : textDecoder.decode(island.file.content);
  const existingStat = await stat(absolutePath).catch((error: unknown) => {
    if (isNotFound(error)) return undefined;
    throw error;
  });
  if (!removeOnly && island !== undefined && partialSourceHash !== "absent" && previous === undefined && previousOwnership?.island === undefined) {
    throw new Error(`skillset: ${outputPath} authored settings island conflicts with an unmanaged live file; reconcile before build`);
  }
  if (previousIsland !== undefined && island !== undefined && liveBytes !== undefined && existingStat !== undefined) {
    if (previousIsland.sourceHash !== island.sourceHash) {
      const liveOutputHash = hashRenderedFiles(WORKSPACE_LOCK_ROOT, [
        { ...island.file, content: liveBytes, mode: existingStat.mode & 0o777 },
      ]);
      const cleanHandback = liveOutputHash === previousIsland.outputHash &&
        (previousIsland.renderInputsHash === undefined ||
          hashForeignSettings(liveBytes, commandHash) === previousIsland.renderInputsHash);
      if (!cleanHandback) {
        throw new Error(`skillset: ${outputPath} authored settings island changed alongside its live output; reconcile before build`);
      }
      sourceText = textDecoder.decode(island.file.content);
      existing = JSON.parse(sourceText) as JsonRecord;
    } else if (!removeOnly && previousIsland.renderInputsHash === undefined && sourceText !== islandText) {
      throw new Error(`skillset: ${outputPath} authored settings island differs from its live output; reconcile before enabling SessionStart`);
    }
  }
  if (island !== undefined && partialSourceHash !== "absent" && previous?.sourceHash !== undefined) {
    const liveForeignHash = hashForeignSettings(textEncoder.encode(sourceText), commandHash);
    if (previous.sourceHash !== sourceHash) {
      if (previous.renderInputsHash === undefined || liveForeignHash !== previous.renderInputsHash) {
        throw new Error(`skillset: ${outputPath} has simultaneous authored island and foreign settings edits; reconcile before build`);
      }
      sourceText = textDecoder.decode(island.file.content);
      existing = JSON.parse(sourceText) as JsonRecord;
    }
  }

  if (existing.hooks !== undefined && !isJsonRecord(existing.hooks)) {
    throw new Error(`skillset: ${outputPath} has an unsupported hooks shape; expected an object`);
  }
  const hooks = existing.hooks ?? {};
  if (hooks.SessionStart !== undefined && !Array.isArray(hooks.SessionStart)) {
    throw new Error(`skillset: ${outputPath} has an unsupported hooks.SessionStart shape; expected an array`);
  }
  const session = hooks.SessionStart === undefined ? [] : [...hooks.SessionStart];
  const expected = projectSessionStartEntry(target);
  const matching = session.filter((entry) => hasCommand(entry, SESSION_START_COMMAND));
  const divergent = matching.filter((entry) => !isDeepStrictEqual(entry, expected));
  if (divergent.length > 0) {
    throw new Error(`skillset: ${outputPath} contains a divergent SessionStart command entry`);
  }
  const continuingHandback = previousIsland?.renderInputsHash !== undefined;
  if (removeOnly && matching.length === 0 && previous === undefined && !continuingHandback) return undefined;
  const hadFile = existingStat !== undefined;
  if (removeOnly && !hadFile) return undefined;
  const content = composeSessionStartText(sourceText, session, expected, SESSION_START_COMMAND, removeOnly);
  let renderInputsHash: string | undefined;
  if (island !== undefined) {
    renderInputsHash = removeOnly
      ? hashForeignSettings(island.file.content, commandHash)
      : previous?.sourceHash === sourceHash && previous.renderInputsHash !== undefined
        ? previous.renderInputsHash
        : hashForeignSettings(textEncoder.encode(content), commandHash);
  }
  return {
    file: {
      content: textEncoder.encode(content),
      mode: existingStat === undefined ? 0o644 : existingStat.mode & 0o777,
      partialOwnership: "settings-entry",
      partialSourceHash,
      path: outputPath,
      sourcePath: relative(graph.rootPath, graph.rootConfigPath),
    },
    managed: !removeOnly,
    ...(renderInputsHash === undefined ? {} : { renderInputsHash }),
    sourceHash,
    ownership: {
      commandHash,
      file: outputPath,
      keyPath: SESSION_START_KEY_PATH,
    },
    target,
  };
}

async function previousSettingsOwnership(rootPath: string, outputPath: string): Promise<{
  readonly settings: ParsedGeneratedLockItem | undefined;
  readonly island: ParsedGeneratedLockItem | undefined;
}> {
  const read = await readCurrentGeneratedLockFromDisk(join(rootPath, "skillset.lock"), {
    logicalPath: "skillset.lock",
    missing: "absent",
  });
  if (read.kind === "absent") return { settings: undefined, island: undefined };
  return {
    settings: read.lock.items.find((item) => item.kind === "settings-entry" && item.outputPath === outputPath),
    island: read.lock.items.find((item) => item.kind === "island" && item.outputPath === outputPath),
  };
}

function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function assertNoLegacyClaudeSessionStart(rootPath: string, projectRoot: string): Promise<void> {
  const legacyPath = join(projectRoot, "settings.local.json");
  let bytes: string;
  try {
    bytes = await readFile(join(rootPath, legacyPath), "utf8");
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(bytes);
  } catch {
    return;
  }
  if (!isJsonRecord(settings) || !isJsonRecord(settings.hooks) || !Array.isArray(settings.hooks.SessionStart)) return;
  if (settings.hooks.SessionStart.some((entry) => hasCommand(entry, SESSION_START_COMMAND))) {
    throw new Error(`skillset: ${legacyPath} still contains the former SessionStart command; remove only that entry before building ${projectSessionStartPath("claude", projectRoot)}`);
  }
}

async function outputRootIsIgnored(graph: BuildGraph, path: string): Promise<boolean> {
  try {
    await execFile("git", ["check-ignore", "-q", "--no-index", "--", `${path.replace(/\/$/, "")}/`], { cwd: graph.rootPath });
    return true;
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
