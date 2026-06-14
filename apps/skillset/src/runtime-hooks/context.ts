import { gitSafeEnv } from "../git-env";
import type { HookRunEvent } from "./events";

export type HookRuntimeProvider = "claude" | "codex" | "unknown";

export interface HookRuntimeContext {
  readonly cwd: string;
  readonly event: HookRunEvent;
  readonly payload?: unknown;
  readonly payloadError?: string;
  readonly provider: HookRuntimeProvider;
  readonly rawEnv: Readonly<Record<string, string>>;
  readonly repoRoot?: string;
}

export interface HookRuntimeContextOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly event: HookRunEvent;
  readonly rootPath?: string;
  readonly stdinText?: string;
}

const CLAUDE_ENV_KEYS = [
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_SESSION_ID",
  "CLAUDE_TOOL_NAME",
  "CLAUDE_WORKING_DIRECTORY",
] as const;
const CODEX_ENV_KEYS = [
  "CODEX_CWD",
  "CODEX_REPO_ROOT",
  "CODEX_SESSION_ID",
  "OPENAI_WORKSPACE_ROOT",
] as const;
const KNOWN_ENV_KEYS = [...CLAUDE_ENV_KEYS, ...CODEX_ENV_KEYS, "PWD", "SKILLSET_HOOK_COMMAND"] as const;

export async function readHookRuntimeContext(
  options: HookRuntimeContextOptions
): Promise<HookRuntimeContext> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const parsedPayload = parsePayload(options.stdinText);
  const repoRoot = options.rootPath ?? env.CODEX_REPO_ROOT ?? env.OPENAI_WORKSPACE_ROOT ?? env.CLAUDE_PROJECT_DIR ?? await gitRoot(cwd);
  return {
    cwd,
    event: options.event,
    ...parsedPayload,
    provider: detectProvider(env),
    rawEnv: relevantEnv(env),
    ...(repoRoot === undefined ? {} : { repoRoot }),
  };
}

export async function readHookStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const text = await new Response(Bun.stdin.stream()).text();
  return text.trim().length === 0 ? undefined : text;
}

function detectProvider(env: Record<string, string | undefined>): HookRuntimeProvider {
  if (Object.keys(env).some((key) => key.startsWith("CLAUDE_"))) return "claude";
  if (Object.keys(env).some((key) => key.startsWith("CODEX_"))) return "codex";
  if (env.OPENAI_WORKSPACE_ROOT !== undefined) return "codex";
  return "unknown";
}

function relevantEnv(env: Record<string, string | undefined>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of KNOWN_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function parsePayload(stdinText: string | undefined): Pick<HookRuntimeContext, "payload" | "payloadError"> {
  if (stdinText === undefined || stdinText.trim().length === 0) return {};
  try {
    return { payload: JSON.parse(stdinText) as unknown };
  } catch (error) {
    return { payloadError: error instanceof Error ? error.message : String(error) };
  }
}

async function gitRoot(cwd: string): Promise<string | undefined> {
  const proc = Bun.spawn({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd,
    env: gitSafeEnv(),
    stderr: "ignore",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return undefined;
  const root = stdout.trim();
  return root.length === 0 ? undefined : root;
}
