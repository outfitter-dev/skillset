import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSkillsetWorkspaceConfig } from "@skillset/core";
import { parseYamlRecord } from "@skillset/core/internal/yaml";
import { gitReadOnlyEnv } from "../git-env";

export const HOOK_RELEVANT_SOURCE_PATHS = [
  "skillset.yaml",
  ".skillset",
  "skillset",
] as const;

export interface HookSourceGateResult {
  readonly changed: boolean;
  readonly exitCode: number;
  readonly ok: boolean;
  readonly paths: readonly string[];
  readonly stdout: string;
}

export function hookRelevantSourcePaths(): readonly string[] {
  return HOOK_RELEVANT_SOURCE_PATHS;
}

export async function hasHookRelevantSourceChanges(rootPath = process.cwd()): Promise<boolean> {
  return (await readHookSourceGate(rootPath)).changed;
}

export async function readHookSourceGate(rootPath = process.cwd()): Promise<HookSourceGateResult> {
  let paths: readonly string[] = HOOK_RELEVANT_SOURCE_PATHS;
  const configPath = join(rootPath, "skillset.yaml");
  try {
    const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
    // Read the declaration, not the graph: deleted native source must still trigger checks.
    if (readSkillsetWorkspaceConfig(config, configPath).nativeAgents === true) {
      paths = [...paths, "AGENTS.md"];
    }
  } catch (error) {
    // A missing config is covered by Git's source pathspec (including deletion).
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      return { changed: false, exitCode: 1, ok: false, paths, stdout: "" };
    }
  }
  const result = await capture(["git", "status", "--porcelain=v1", "--untracked-files=all", "--", ...paths], {
    cwd: rootPath,
  });
  return {
    changed: result.exitCode === 0 && result.stdout.trim().length > 0,
    exitCode: result.exitCode,
    ok: result.exitCode === 0,
    paths,
    stdout: result.stdout,
  };
}

async function capture(argv: readonly string[], options: { readonly cwd: string }): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: [...argv],
    cwd: options.cwd,
    env: gitReadOnlyEnv(),
    stderr: "ignore",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { exitCode, stdout };
}
