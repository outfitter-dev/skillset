import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual, promisify } from "node:util";
import { join, relative } from "node:path";

import { getProviderRuntimeHookDestination } from "@skillset/registry";

import { readString } from "./config";
import type { BuildGraph, JsonRecord, JsonValue, RenderedFile, SettingsEntryOwnership, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const execFile = promisify(execFileCallback);
export const SESSION_START_COMMAND = "npx skillset hooks run session-start";
export const SESSION_START_KEY_PATH = "hooks.SessionStart[*].hooks[*].command";

export interface RenderedProjectHook {
  readonly file: RenderedFile;
  readonly managed: boolean;
  readonly ownership: SettingsEntryOwnership;
  readonly target: Extract<TargetName, "claude" | "codex">;
}

const textEncoder = new TextEncoder();

export async function renderProjectSessionStartHooks(
  graph: BuildGraph
): Promise<readonly RenderedProjectHook[]> {
  const targets = (["claude", "codex"] as const).filter(
    (target) => graph.root.targets[target].enabled
  );
  if (graph.root.compile.sessionStartHook === "off") return renderExistingOff(graph, targets);
  if (graph.root.compile.sessionStartHook === "auto") {
    const enabled = await Promise.all(
      targets.map(async (target) => [target, await destinationIsIgnored(graph, target)] as const)
    );
    if (enabled.some(([, ignored]) => !ignored)) return renderExistingOff(graph, targets);
  }
  const results = await Promise.all(targets.map((target) => renderProjectHook(graph, target)));
  return results.filter((result): result is RenderedProjectHook => result !== undefined);
}

async function renderExistingOff(
  graph: BuildGraph,
  targets: readonly ("claude" | "codex")[]
): Promise<readonly RenderedProjectHook[]> {
  const rendered: RenderedProjectHook[] = [];
  for (const target of targets) {
    const result = await renderProjectHook(graph, target, true);
    if (result !== undefined) rendered.push(result);
  }
  return rendered;
}

async function renderProjectHook(
  graph: BuildGraph,
  target: "claude" | "codex",
  removeOnly = false
): Promise<RenderedProjectHook | undefined> {
  const destinationFact = getProviderRuntimeHookDestination(target);
  if (destinationFact.status !== "verified") return undefined;
  const destination = destinationFact.path;
  const filename = destination.split("/").at(-1);
  if (filename === undefined) return undefined;
  const projectRoot = readString(graph.root.targets[target].options, "projectRoot") ?? `.${target}`;
  const outputPath = join(projectRoot, filename);
  const absolutePath = join(graph.rootPath, outputPath);
  let existing: JsonRecord = {};
  let partialSourceHash = "absent";
  try {
    const sourceBytes = await readFile(absolutePath);
    partialSourceHash = hashBytes(sourceBytes);
    existing = JSON.parse(new TextDecoder().decode(sourceBytes)) as JsonRecord;
    if (!isJsonRecord(existing)) throw new Error("root must be an object");
  } catch (error) {
    if (!isNotFound(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`skillset: ${outputPath} is not valid JSON: ${message}`);
    }
  }

  if (existing.hooks !== undefined && !isJsonRecord(existing.hooks)) {
    throw new Error(`skillset: ${outputPath} has an unsupported hooks shape; expected an object`);
  }
  const hooks: Record<string, JsonValue> = Object.fromEntries(
    Object.entries(existing.hooks ?? {}).filter(([, value]) => value !== undefined)
  ) as Record<string, JsonValue>;
  if (hooks.SessionStart !== undefined && !Array.isArray(hooks.SessionStart)) {
    throw new Error(`skillset: ${outputPath} has an unsupported hooks.SessionStart shape; expected an array`);
  }
  const session = hooks.SessionStart === undefined ? [] : [...hooks.SessionStart];
  const expected = sessionStartEntry();
  const matching = session.filter((entry) => hasCommand(entry, SESSION_START_COMMAND));
  const divergent = matching.filter((entry) => !isDeepStrictEqual(entry, expected));
  if (divergent.length > 0) {
    throw new Error(`skillset: ${outputPath} contains a divergent SessionStart command entry`);
  }
  const withoutOwned = session.filter((entry) => !hasCommand(entry, SESSION_START_COMMAND));
  if (removeOnly && matching.length === 0) return undefined;
  const nextSession = removeOnly ? withoutOwned : [...withoutOwned, expected];
  if (nextSession.length === 0) {
    delete hooks.SessionStart;
  } else {
    hooks.SessionStart = nextSession;
  }
  const next: Record<string, JsonValue> = { ...existing, ...(Object.keys(hooks).length === 0 ? {} : { hooks }) };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  const hadFile = await fileExists(absolutePath);
  if (removeOnly && !hadFile) return undefined;
  const content = JSON.stringify(next, null, 2) + "\n";
  return {
    file: {
      content: textEncoder.encode(content),
      mode: 0o644,
      partialOwnership: "settings-entry",
      partialSourceHash,
      path: outputPath,
      sourcePath: relative(graph.rootPath, graph.rootConfigPath),
    },
    managed: !removeOnly,
    ownership: {
      commandHash: hashCommand(SESSION_START_COMMAND),
      file: outputPath,
      keyPath: SESSION_START_KEY_PATH,
    },
    target,
  };
}

function sessionStartEntry(): JsonRecord {
  const handler: Record<string, JsonValue> = { type: "command", command: SESSION_START_COMMAND };
  return { hooks: [handler] };
}

function hasCommand(value: JsonValue, command: string): boolean {
  if (!isJsonRecord(value) || !Array.isArray(value.hooks)) return false;
  return value.hooks.some((entry) => isJsonRecord(entry) && entry.command === command);
}

function hashCommand(command: string): string {
  return `sha256:${createHash("sha256").update(command).digest("hex")}`;
}

function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function destinationIsIgnored(graph: BuildGraph, target: "claude" | "codex"): Promise<boolean> {
  const destinationFact = getProviderRuntimeHookDestination(target);
  if (destinationFact.status !== "verified") return false;
  const destination = destinationFact.path;
  const filename = destination.split("/").at(-1) ?? destination;
  const projectRoot = readString(graph.root.targets[target].options, "projectRoot") ?? `.${target}`;
  try {
    await execFile("git", ["check-ignore", "-q", "--no-index", "--", join(projectRoot, filename)], { cwd: graph.rootPath });
    return true;
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
