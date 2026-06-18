import { gitSafeEnv } from "../git-env";

export const HOOK_RELEVANT_SOURCE_PATHS = [
  ".skillset/config.yaml",
  ".skillset/src/rules",
  ".skillset/src/skills",
  ".skillset/src/plugins",
  ".skillset/src/shared",
  ".skillset/src",
  ".skillset/changes/pending",
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
  const result = await capture(["git", "status", "--porcelain=v1", "--untracked-files=all", "--", ...HOOK_RELEVANT_SOURCE_PATHS], {
    cwd: rootPath,
  });
  return {
    changed: result.exitCode === 0 && result.stdout.trim().length > 0,
    exitCode: result.exitCode,
    ok: result.exitCode === 0,
    paths: HOOK_RELEVANT_SOURCE_PATHS,
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
    env: gitSafeEnv(),
    stderr: "ignore",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { exitCode, stdout };
}
