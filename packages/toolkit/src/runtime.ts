import { TARGET_NAMES } from "@skillset/schema";

type RuntimeTarget = (typeof TARGET_NAMES)[number];

export type RuntimeProvider = RuntimeTarget | "unknown";
export type RuntimeContextField = "hook.event" | "provider" | "session.id";
export type RuntimeContextFormat = "env" | "json";
export type RuntimeContextFieldAvailability = "available" | "unavailable" | "unknown";
export type RuntimeContextFieldConfidence = "skillset" | "provider" | "caller" | "unavailable";

export interface RuntimeContext {
  readonly cwd: string;
  readonly event: string;
  readonly payload?: unknown;
  readonly payloadError?: string;
  readonly provider: RuntimeProvider;
  readonly rawEnv: Readonly<Record<string, string>>;
  readonly repoRoot?: string;
}

export interface RuntimeContextOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly event: string;
  readonly rootPath?: string;
  readonly stdinText?: string;
}

export interface RuntimeContextRenderOptions extends RuntimeContextOptions {
  readonly fields?: readonly RuntimeContextField[];
  readonly format: RuntimeContextFormat;
}

export interface RuntimeContextFieldDefinition {
  readonly availability: Readonly<Record<RuntimeProvider, RuntimeContextFieldAvailability>>;
  readonly confidence: RuntimeContextFieldConfidence;
  readonly description: string;
  readonly envName: string;
  readonly field: RuntimeContextField;
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
const CURSOR_ENV_KEYS = ["CURSOR_SESSION_ID"] as const;
const PROVIDER_ENV = {
  claude: {
    prefix: "CLAUDE_",
    rawKeys: CLAUDE_ENV_KEYS,
    sessionId: "CLAUDE_SESSION_ID",
  },
  codex: {
    prefix: "CODEX_",
    rawKeys: CODEX_ENV_KEYS,
    sessionId: "CODEX_SESSION_ID",
  },
  cursor: {
    prefix: "CURSOR_",
    rawKeys: CURSOR_ENV_KEYS,
    sessionId: "CURSOR_SESSION_ID",
  },
} as const satisfies Record<RuntimeTarget, {
  readonly prefix: string;
  readonly rawKeys: readonly string[];
  readonly sessionId: string;
}>;
const SKILLSET_ENV_KEYS = [
  "SKILLSET_HOOK_COMMAND",
  "SKILLSET_HOOK_EVENT",
  "SKILLSET_PROVIDER",
  "SKILLSET_SESSION_ID",
] as const;
const RUNTIME_TARGETS = new Set<string>(TARGET_NAMES);
const KNOWN_ENV_KEYS = [
  ...TARGET_NAMES.flatMap((target) => PROVIDER_ENV[target].rawKeys),
  ...SKILLSET_ENV_KEYS,
  "PWD",
] as const;

export const RUNTIME_CONTEXT_FIELD_DEFINITIONS = [
  {
    availability: targetAvailability("available", "unknown"),
    confidence: "skillset",
    description: "Normalized provider lens selected from Skillset wrapper env or provider-specific environment.",
    envName: "SKILLSET_PROVIDER",
    field: "provider",
  },
  {
    availability: targetAvailability("available", "available"),
    confidence: "caller",
    description: "Hook event name passed by the generated wrapper or caller.",
    envName: "SKILLSET_HOOK_EVENT",
    field: "hook.event",
  },
  {
    availability: targetAvailability("available", "unknown"),
    confidence: "provider",
    description: "Provider session id when the runtime exposes one; absent when unavailable.",
    envName: "SKILLSET_SESSION_ID",
    field: "session.id",
  },
] as const satisfies readonly RuntimeContextFieldDefinition[];

const RUNTIME_CONTEXT_FIELDS = RUNTIME_CONTEXT_FIELD_DEFINITIONS.map((definition) => definition.field);

export async function readRuntimeContext(options: RuntimeContextOptions): Promise<RuntimeContext> {
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

export function readRuntimeContextField(value: string): RuntimeContextField {
  if ((RUNTIME_CONTEXT_FIELDS as readonly string[]).includes(value)) return value as RuntimeContextField;
  throw new Error("skillset: hooks context field must be provider, hook.event, or session.id");
}

export function readRuntimeContextFormat(value: string): RuntimeContextFormat {
  if (value === "env" || value === "json") return value;
  throw new Error("skillset: hooks context --format must be env or json");
}

export async function renderRuntimeContext(options: RuntimeContextRenderOptions): Promise<string> {
  const context = await readRuntimeContext(options);
  const fields = [...(options.fields ?? RUNTIME_CONTEXT_FIELDS)];
  if (options.format === "env") return renderRuntimeEnv(context, fields);
  return `${JSON.stringify(runtimeContextJson(context, fields), null, 2)}\n`;
}

export function runtimeContextFieldValue(
  context: RuntimeContext,
  field: RuntimeContextField
): string | undefined {
  switch (field) {
    case "provider":
      return context.provider;
    case "hook.event":
      return context.rawEnv.SKILLSET_HOOK_EVENT ?? context.event;
    case "session.id":
      if (context.rawEnv.SKILLSET_SESSION_ID !== undefined) return context.rawEnv.SKILLSET_SESSION_ID;
      if (context.provider !== "unknown") {
        return context.rawEnv[PROVIDER_ENV[context.provider].sessionId];
      }
      for (const target of TARGET_NAMES) {
        const sessionId = context.rawEnv[PROVIDER_ENV[target].sessionId];
        if (sessionId !== undefined) return sessionId;
      }
      return undefined;
  }
}

function detectProvider(env: Record<string, string | undefined>): RuntimeProvider {
  if (isRuntimeTarget(env.SKILLSET_PROVIDER)) return env.SKILLSET_PROVIDER;
  const keys = Object.keys(env);
  for (const target of TARGET_NAMES) {
    const evidence = PROVIDER_ENV[target];
    if (
      keys.some((key) => key.startsWith(evidence.prefix)) ||
      evidence.rawKeys.some((key) => env[key] !== undefined)
    ) {
      return target;
    }
  }
  return "unknown";
}

function isRuntimeTarget(value: string | undefined): value is RuntimeTarget {
  return value !== undefined && RUNTIME_TARGETS.has(value);
}

function targetAvailability(
  target: RuntimeContextFieldAvailability,
  unknown: RuntimeContextFieldAvailability
): Readonly<Record<RuntimeProvider, RuntimeContextFieldAvailability>> {
  return Object.fromEntries([
    ...TARGET_NAMES.map((provider) => [provider, target] as const),
    ["unknown", unknown] as const,
  ]) as Record<RuntimeProvider, RuntimeContextFieldAvailability>;
}

function relevantEnv(env: Record<string, string | undefined>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of KNOWN_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function parsePayload(stdinText: string | undefined): Pick<RuntimeContext, "payload" | "payloadError"> {
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

function renderRuntimeEnv(
  context: RuntimeContext,
  fields: readonly RuntimeContextField[]
): string {
  return fields
    .map((field) => `export ${envNameForField(field)}=${shellQuote(runtimeContextFieldValue(context, field) ?? "")}`)
    .join("\n") + "\n";
}

function runtimeContextJson(
  context: RuntimeContext,
  fields: readonly RuntimeContextField[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    fields: RUNTIME_CONTEXT_FIELD_DEFINITIONS.filter((definition) => fields.includes(definition.field)),
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

function envNameForField(field: RuntimeContextField): string {
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

function gitSafeEnv(sourceEnv: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined) continue;
    if (
      key === "GIT_DIR" ||
      key === "GIT_WORK_TREE" ||
      key === "GIT_INDEX_FILE" ||
      key === "GIT_OBJECT_DIRECTORY" ||
      key === "GIT_COMMON_DIR" ||
      key === "GIT_NAMESPACE" ||
      key.startsWith("GIT_ALTERNATE_OBJECT")
    ) {
      continue;
    }
    env[key] = value;
  }
  return env;
}
