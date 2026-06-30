import { gitSafeEnv } from "../git-env";

export type HookRuntimeProvider = "claude" | "codex" | "unknown";
export type HookRuntimeContextField = "hook.event" | "provider" | "session.id";
export type HookRuntimeContextFormat = "env" | "json";

export interface HookRuntimeContext {
  readonly cwd: string;
  readonly event: string;
  readonly payload?: unknown;
  readonly payloadError?: string;
  readonly provider: HookRuntimeProvider;
  readonly rawEnv: Readonly<Record<string, string>>;
  readonly repoRoot?: string;
}

export interface HookRuntimeContextOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly event: string;
  readonly rootPath?: string;
  readonly stdinText?: string;
}

export interface HookRuntimeContextRenderOptions extends HookRuntimeContextOptions {
  readonly fields?: readonly HookRuntimeContextField[];
  readonly format: HookRuntimeContextFormat;
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
const SKILLSET_ENV_KEYS = [
  "SKILLSET_HOOK_COMMAND",
  "SKILLSET_HOOK_EVENT",
  "SKILLSET_PROVIDER",
  "SKILLSET_SESSION_ID",
] as const;
const KNOWN_ENV_KEYS = [...CLAUDE_ENV_KEYS, ...CODEX_ENV_KEYS, ...SKILLSET_ENV_KEYS, "PWD"] as const;
const HOOK_RUNTIME_CONTEXT_FIELDS = ["provider", "hook.event", "session.id"] as const satisfies readonly HookRuntimeContextField[];

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
  if (env.SKILLSET_PROVIDER === "claude" || env.SKILLSET_PROVIDER === "codex") return env.SKILLSET_PROVIDER;
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

export function readHookRuntimeContextField(value: string): HookRuntimeContextField {
  if ((HOOK_RUNTIME_CONTEXT_FIELDS as readonly string[]).includes(value)) return value as HookRuntimeContextField;
  throw new Error("skillset: hooks context field must be provider, hook.event, or session.id");
}

export function readHookRuntimeContextFormat(value: string): HookRuntimeContextFormat {
  if (value === "env" || value === "json") return value;
  throw new Error("skillset: hooks context --format must be env or json");
}

export async function renderHookRuntimeContext(options: HookRuntimeContextRenderOptions): Promise<string> {
  const context = await readHookRuntimeContext(options);
  const fields = [...(options.fields ?? HOOK_RUNTIME_CONTEXT_FIELDS)];
  if (options.format === "env") return renderHookRuntimeEnv(context, fields);
  return `${JSON.stringify(hookRuntimeContextJson(context, fields), null, 2)}\n`;
}

function renderHookRuntimeEnv(
  context: HookRuntimeContext,
  fields: readonly HookRuntimeContextField[]
): string {
  return fields
    .map((field) => `export ${envNameForField(field)}=${shellQuote(runtimeContextFieldValue(context, field) ?? "")}`)
    .join("\n") + "\n";
}

function hookRuntimeContextJson(
  context: HookRuntimeContext,
  fields: readonly HookRuntimeContextField[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    raw: { env: context.rawEnv },
    schemaVersion: 1,
  };
  if (fields.includes("provider")) result.provider = runtimeContextFieldValue(context, "provider");
  if (fields.includes("hook.event")) result.hook = { event: runtimeContextFieldValue(context, "hook.event") };
  if (fields.includes("session.id")) {
    const sessionId = runtimeContextFieldValue(context, "session.id");
    result.session = sessionId === undefined ? {} : { id: sessionId };
  }
  return result;
}

function runtimeContextFieldValue(
  context: HookRuntimeContext,
  field: HookRuntimeContextField
): string | undefined {
  switch (field) {
    case "provider":
      return context.provider;
    case "hook.event":
      return context.rawEnv.SKILLSET_HOOK_EVENT ?? context.event;
    case "session.id":
      return context.rawEnv.SKILLSET_SESSION_ID ?? context.rawEnv.CLAUDE_SESSION_ID ?? context.rawEnv.CODEX_SESSION_ID;
  }
}

function envNameForField(field: HookRuntimeContextField): string {
  switch (field) {
    case "provider":
      return "SKILLSET_PROVIDER";
    case "hook.event":
      return "SKILLSET_HOOK_EVENT";
    case "session.id":
      return "SKILLSET_SESSION_ID";
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]*$/.test(value)) return value.length === 0 ? "''" : value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
