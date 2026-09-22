import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual, promisify } from "node:util";
import { join, relative } from "node:path";

import { readString } from "./config";
import { parseCurrentGeneratedLock, type ParsedGeneratedLockItem } from "./generated-lock";
import { hasValidLockProvenance } from "./lock-provenance";
import { targetNames } from "./targets";
import { hashCommand, hashForeignSettings } from "./settings-entry";
import { composeSessionStartText, hasCommand } from "./settings-json-edit";
import type { BuildGraph, JsonRecord, JsonValue, RenderedFile, SettingsEntryOwnership, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const execFile = promisify(execFileCallback);
export const SESSION_START_COMMAND = "npx skillset hooks run session-start";
export const SESSION_START_KEY_PATH = "hooks.SessionStart[*].hooks[*].command";
const SESSION_START_FILENAME: Readonly<Record<"claude" | "codex", string>> = {
  claude: "settings.json",
  codex: "hooks.json",
};

export function projectSessionStartPath(target: "claude" | "codex", projectRoot = `.${target}`): string {
  return join(projectRoot, SESSION_START_FILENAME[target]);
}

export function projectSessionStartEntry(target: "claude" | "codex"): JsonRecord {
  const handler: Record<string, JsonValue> = { type: "command", command: SESSION_START_COMMAND };
  if (target === "codex") handler.additionalContextLimit = 5000;
  return {
    matcher: target === "claude" ? "startup|resume|clear|compact" : "startup|resume",
    hooks: [handler],
  };
}

export interface RenderedProjectHook {
  readonly file: RenderedFile;
  readonly managed: boolean;
  readonly ownership: SettingsEntryOwnership;
  readonly renderInputsHash?: string;
  readonly sourceHash: string;
  readonly target: Extract<TargetName, "claude" | "codex">;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function renderProjectSessionStartHooks(
  graph: BuildGraph,
  sourceIslands: ReadonlyMap<string, RenderedFile> = new Map()
): Promise<readonly RenderedProjectHook[]> {
  const targets = (["claude", "codex"] as const).filter(
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
  targets: readonly ("claude" | "codex")[],
  sourceIslands: ReadonlyMap<string, RenderedFile>
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
  target: "claude" | "codex",
  removeOnly = false,
  sourceIslands: ReadonlyMap<string, RenderedFile> = new Map()
): Promise<RenderedProjectHook | undefined> {
  const projectRoot = readString(graph.root.targets[target].options, "projectRoot") ?? `.${target}`;
  const outputPath = projectSessionStartPath(target, projectRoot);
  if (target === "claude") await assertNoLegacyClaudeSessionStart(graph.rootPath, projectRoot);
  const absolutePath = join(graph.rootPath, outputPath);
  const island = sourceIslands.get(outputPath);
  const commandHash = hashCommand(SESSION_START_COMMAND);
  const sourceHash = hashBytes(textEncoder.encode(`${relative(graph.rootPath, graph.rootConfigPath)}\0${target}\0${commandHash}${island === undefined ? "" : `\0${hashBytes(island.content)}`}`));
  let existing: JsonRecord = {};
  let sourceText = "{}\n";
  let partialSourceHash = "absent";
  try {
    const sourceBytes = await readFile(absolutePath);
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
      sourceText = textDecoder.decode(island.content);
      existing = JSON.parse(sourceText) as JsonRecord;
      if (!isJsonRecord(existing)) throw new Error(`skillset: ${outputPath} is not a JSON object`);
    }
  }

  const previousOwnership = island === undefined ? undefined : await previousSettingsOwnership(graph.rootPath, outputPath);
  const previous = previousOwnership?.settings;
  if (!removeOnly && island !== undefined && partialSourceHash !== "absent" && previous === undefined && previousOwnership?.island === undefined) {
    throw new Error(`skillset: ${outputPath} authored settings island conflicts with an unmanaged live file; reconcile before build`);
  }
  if (!removeOnly && island !== undefined && previousOwnership?.island !== undefined && sourceText !== textDecoder.decode(island.content)) {
    throw new Error(`skillset: ${outputPath} authored settings island differs from its live output; reconcile before enabling SessionStart`);
  }
  if (island !== undefined && partialSourceHash !== "absent" && previous?.sourceHash !== undefined) {
    const liveForeignHash = hashForeignSettings(textEncoder.encode(sourceText), commandHash);
    if (previous.sourceHash !== sourceHash) {
      if (previous.renderInputsHash === undefined || liveForeignHash !== previous.renderInputsHash) {
        throw new Error(`skillset: ${outputPath} has simultaneous authored island and foreign settings edits; reconcile before build`);
      }
      sourceText = textDecoder.decode(island.content);
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
  if (removeOnly && island !== undefined && partialSourceHash !== "absent") {
    const withoutCommand = matching.length === 0
      ? sourceText
      : composeSessionStartText(sourceText, session, expected, SESSION_START_COMMAND, true);
    if (withoutCommand !== textDecoder.decode(island.content)) {
      throw new Error(`skillset: ${outputPath} cannot return to authored island ownership; reconcile foreign settings before turning off`);
    }
  }
  if (removeOnly && matching.length === 0) return undefined;
  const existingStat = await stat(absolutePath).catch((error: unknown) => {
    if (isNotFound(error)) return undefined;
    throw error;
  });
  const hadFile = existingStat !== undefined;
  if (removeOnly && !hadFile) return undefined;
  const content = composeSessionStartText(sourceText, session, expected, SESSION_START_COMMAND, removeOnly);
  const renderInputsHash = island === undefined || removeOnly
    ? undefined
    : previous?.sourceHash === sourceHash && previous.renderInputsHash !== undefined
      ? previous.renderInputsHash
      : hashForeignSettings(textEncoder.encode(content), commandHash);
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
  let bytes: string;
  try {
    bytes = await readFile(join(rootPath, "skillset.lock"), "utf8");
  } catch (error) {
    if (isNotFound(error)) return { settings: undefined, island: undefined };
    throw error;
  }
  const parsed: unknown = JSON.parse(bytes);
  if (!isJsonRecord(parsed) || parsed.schemaVersion !== 4) return { settings: undefined, island: undefined };
  const lock = parseCurrentGeneratedLock(parsed, "skillset.lock", { provenance: "inspect" });
  if (!hasValidLockProvenance(parsed)) return { settings: undefined, island: undefined };
  return {
    settings: lock.items.find((item) => item.kind === "settings-entry" && item.outputPath === outputPath),
    island: lock.items.find((item) => item.kind === "island" && item.outputPath === outputPath),
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
