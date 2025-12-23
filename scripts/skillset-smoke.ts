#!/usr/bin/env bun
/**
 * Skillset smoke test:
 * - Creates a temporary workspace with skills, aliases, and sets
 * - Runs the skillset hook directly
 * - Optionally runs Claude Code and Codex in headless modes
 * - Writes a structured JSON report
 */

import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

type ToolName = "skillset" | "hook" | "claude" | "codex";
type HookMode = "ci" | "cli";
type CoreModule = typeof import("../packages/core/src/index.ts");

interface SkillCacheEntry {
  skillRef: string;
  path: string;
  name: string;
  description?: string;
  structure?: string;
  lineCount: number;
  cachedAt: string;
}

interface RunResult {
  tool: ToolName;
  status: "ok" | "failed" | "skipped";
  duration_ms: number;
  exitCode: number | null;
  stdoutPath?: string;
  stderrPath?: string;
  details?: Record<string, unknown>;
  error?: string;
}

interface SmokeReport {
  runId: string;
  createdAt: string;
  root: string;
  workspace: string;
  artifactsDir: string;
  selectedTools: ToolName[];
  env: Record<string, string>;
  skills: Array<{ id: string; sentinel: string }>;
  aliases: Record<string, string>;
  sets: Record<
    string,
    { name: string; description?: string; skillRefs: string[] }
  >;
  steps: RunResult[];
}

const DEFAULT_TOOLS: ToolName[] = ["hook", "claude", "codex"];

const args = process.argv.slice(2);
const options = {
  clean: parseClean(args),
  cleanAll: args.includes("--clean-all"),
  strict: args.includes("--strict"),
  tools: parseTools(args) ?? DEFAULT_TOOLS,
  hookModes: parseHookModes(args) ?? ["ci", "cli"],
};

const root = process.cwd();
const smokeRoot = join(root, ".skillset-smoke");
const legacyHarnessRoot = join(root, ".skillset-harness");
const binRoot = join(smokeRoot, "bin");
const workspaceRoot = join(smokeRoot, "workspace");
const reportsRoot = join(smokeRoot, "reports");
const xdgRoot = join(smokeRoot, "xdg");
const xdgConfig = join(xdgRoot, "config");
const xdgCache = join(xdgRoot, "cache");
const xdgData = join(xdgRoot, "data");
const smokeHome = join(smokeRoot, "home");
const codexHome = join(smokeRoot, "codex-home");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = join(reportsRoot, runId);

const envBase: Record<string, string> = toEnvRecord(process.env);
envBase.HOME = smokeHome;
envBase.XDG_CONFIG_HOME = xdgConfig;
envBase.XDG_CACHE_HOME = xdgCache;
envBase.XDG_DATA_HOME = xdgData;
envBase.CODEX_HOME = codexHome;
envBase.NO_COLOR = "1";
envBase.SKILLSET_OUTPUT = "json";
envBase.SKILLSET_PROJECT_ROOT = workspaceRoot;

for (const [key, value] of Object.entries(envBase)) {
  process.env[key] = value;
}

const skills = [
  {
    id: "alpha-skill",
    title: "Alpha Skill",
    description: "Return the alpha sentinel when asked.",
    sentinel: "SENTINEL_ALPHA_123",
  },
  {
    id: "beta-skill",
    title: "Beta Skill",
    description: "Return the beta sentinel when asked.",
    sentinel: "SENTINEL_BETA_456",
  },
];

const aliases: Record<string, string> = {
  AlphaSkill: "project:alpha-skill",
};

const sets: Record<
  string,
  { name: string; description?: string; skillRefs: string[] }
> = {
  "starter-set": {
    name: "Starter Set",
    description: "Alpha + Beta for smoke test validation",
    skillRefs: ["project:alpha-skill", "project:beta-skill"],
  },
};

const hookPrompt =
  "Use $AlphaSkill and $set:StarterSet. Respond with JSON that lists any " +
  "SENTINEL_* values you see in the provided skill context.";

const codexPrompt =
  "Use $alpha-skill and $beta-skill. Respond with JSON including an array " +
  "`evidence` containing any SENTINEL_* values you see in the loaded skills.";

const jsonSchema = {
  type: "object",
  properties: {
    used_skills: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["used_skills", "evidence"],
};

const LINE_SPLIT_REGEX = /\r?\n/;

if (options.cleanAll) {
  rmSync(smokeRoot, { recursive: true, force: true });
  rmSync(legacyHarnessRoot, { recursive: true, force: true });
}

if (options.clean) {
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(xdgRoot, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
  rmSync(smokeHome, { recursive: true, force: true });
}

mkdirSync(workspaceRoot, { recursive: true });
mkdirSync(reportsRoot, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });

prepareWorkspace();
ensureSmokeBin();
const core: CoreModule = await loadCore();

const results: RunResult[] = [];

results.push(await runIndex());
results.push(await runSetLoad());

if (options.tools.includes("hook")) {
  for (const mode of options.hookModes) {
    results.push(await runHook(mode));
  }
}

if (options.tools.includes("claude")) {
  results.push(await runClaude());
}

if (options.tools.includes("codex")) {
  results.push(await runCodex());
}

const report: SmokeReport = {
  runId,
  createdAt: new Date().toISOString(),
  root,
  workspace: workspaceRoot,
  artifactsDir,
  selectedTools: options.tools,
  env: {
    HOME: envBase.HOME,
    XDG_CONFIG_HOME: envBase.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: envBase.XDG_CACHE_HOME,
    XDG_DATA_HOME: envBase.XDG_DATA_HOME,
    CODEX_HOME: envBase.CODEX_HOME,
  },
  skills: skills.map((skill) => ({ id: skill.id, sentinel: skill.sentinel })),
  aliases,
  sets,
  steps: results,
};

const reportPath = join(artifactsDir, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (options.strict && results.some((r) => r.status !== "ok")) {
  process.exit(1);
}

function prepareWorkspace() {
  const claudeSkills = join(workspaceRoot, ".claude", "skills");
  const codexSkills = join(workspaceRoot, ".codex", "skills");
  mkdirSync(claudeSkills, { recursive: true });
  mkdirSync(codexSkills, { recursive: true });

  for (const skill of skills) {
    const content = [
      `# ${skill.title}`,
      "",
      skill.description,
      "",
      `Sentinel: ${skill.sentinel}`,
      "",
    ].join("\n");
    writeSkill(claudeSkills, skill.id, content);
    writeSkill(codexSkills, skill.id, content);
  }

  const configDir = join(workspaceRoot, ".skillset");
  mkdirSync(configDir, { recursive: true });
  const mappingConfig = Object.fromEntries(
    Object.entries(aliases).map(([name, ref]) => [name, { skillRef: ref }])
  );
  const config = {
    version: 1,
    mode: "warn",
    showStructure: false,
    maxLines: 500,
    mappings: mappingConfig,
    namespaceAliases: {},
    sets,
  };
  writeFileSync(
    join(configDir, "config.json"),
    `${JSON.stringify(config, null, 2)}\n`
  );
}

function ensureSmokeBin() {
  mkdirSync(binRoot, { recursive: true });
  const shimPath = join(binRoot, "skillset");
  const cliEntry = join(root, "apps", "cli", "src", "index.ts");
  const workspace = workspaceRoot;
  const script = [
    "#!/usr/bin/env sh",
    `export SKILLSET_PROJECT_ROOT="${workspace}"`,
    `cd "${root}"`,
    `exec bun run "${cliEntry}" -- "$@"`,
    "",
  ].join("\n");
  writeFileSync(shimPath, script);
  chmodSync(shimPath, 0o755);
}

async function runHookViaPlugin(
  payload: string,
  mode: HookMode
): Promise<string> {
  const pluginScript = join(
    root,
    "plugins",
    "skillset",
    "scripts",
    "skillset-hook.ts"
  );
  const basePath = envBase.PATH ?? "";
  const env = {
    ...envBase,
    SKILLSET_HOOK_MODE: mode === "cli" ? "cli" : "module",
    PATH: mode === "cli" ? `${binRoot}:${basePath}` : basePath,
  };

  const result = await runCommand(
    ["bun", pluginScript],
    {
      cwd: workspaceRoot,
      env,
      stdinText: payload,
      timeoutMs: 30_000,
    }
  );

  if (result.exitCode !== 0) {
    const stderr = result.stderr?.trim();
    const errorDetails = stderr ? `: ${stderr}` : "";
    throw new Error(`hook-${mode} failed with ${result.exitCode}${errorDetails}`);
  }

  return result.stdout;
}

function writeSkill(rootDir: string, id: string, content: string) {
  const dir = join(rootDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
}

async function runIndex(): Promise<RunResult> {
  const start = Date.now();
  try {
    const cache = indexWorkspaceSkills();
    return {
      tool: "skillset",
      status: "ok",
      duration_ms: Date.now() - start,
      exitCode: 0,
      details: {
        step: "index",
        skillCount: Object.keys(cache.skills).length,
      },
    };
  } catch (error) {
    return {
      tool: "skillset",
      status: "failed",
      duration_ms: Date.now() - start,
      exitCode: null,
      error: toErrorMessage(error),
      details: { step: "index" },
    };
  }
}

async function runSetLoad(): Promise<RunResult> {
  const start = Date.now();
  try {
    const result = await withWorkspaceCwd(() =>
      loadSetArtifacts("starter-set")
    );
    const content = JSON.stringify(result ?? {});
    const evidence = skills.map((skill) => ({
      id: skill.id,
      seen: content.includes(skill.sentinel),
    }));
    const outputPath = join(artifactsDir, "skillset-set-load.json");
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    return {
      tool: "skillset",
      status: result ? "ok" : "failed",
      duration_ms: Date.now() - start,
      exitCode: result ? 0 : 1,
      details: {
        step: "set-load",
        evidence,
        outputPath,
      },
    };
  } catch (error) {
    return {
      tool: "skillset",
      status: "failed",
      duration_ms: Date.now() - start,
      exitCode: null,
      error: toErrorMessage(error),
      details: { step: "set-load" },
    };
  }
}

async function runHook(mode: HookMode): Promise<RunResult> {
  const start = Date.now();
  try {
    const payload = JSON.stringify({ prompt: hookPrompt });
    const output = await runHookViaPlugin(payload, mode);
    const parsed = safeJson(output);
    const context = parsed?.hookSpecificOutput?.additionalContext ?? "";
    const evidence = skills.map((skill) => ({
      id: skill.id,
      seen: String(context).includes(skill.sentinel),
    }));
    const outputPath = join(artifactsDir, `skillset-hook-${mode}.json`);
    writeFileSync(outputPath, `${output.trim()}\n`);
    return {
      tool: "hook",
      status: "ok",
      duration_ms: Date.now() - start,
      exitCode: 0,
      details: {
        step: `hook-${mode}`,
        mode,
        evidence,
        outputPath,
      },
    };
  } catch (error) {
    return {
      tool: "hook",
      status: "failed",
      duration_ms: Date.now() - start,
      exitCode: null,
      error: toErrorMessage(error),
      details: { step: `hook-${mode}`, mode },
    };
  }
}

async function runClaude(): Promise<RunResult> {
  const start = Date.now();
  const stdoutPath = join(artifactsDir, "claude.stdout");
  const stderrPath = join(artifactsDir, "claude.stderr");
  const usagePath = join(xdgData, "skillset", "logs", "usage.jsonl");
  try {
    const claudeCmd =
      process.env.SKILLSET_SMOKE_CLAUDE_CMD ??
      process.env.SKILLSET_HARNESS_CLAUDE_CMD ??
      "claude";
    const extraArgs = parseExtraArgs(
      process.env.SKILLSET_SMOKE_CLAUDE_ARGS ??
        process.env.SKILLSET_HARNESS_CLAUDE_ARGS
    );
    const schemaArg = JSON.stringify(jsonSchema);
    const args = [
      claudeCmd,
      "--print",
      "--output-format",
      "json",
      "--json-schema",
      schemaArg,
      "--no-session-persistence",
      "--plugin-dir",
      join(root, "plugins", "skillset"),
      ...extraArgs,
      hookPrompt,
    ];

    const result = await runCommand(args, {
      cwd: workspaceRoot,
      env: envBase,
      timeoutMs: 120_000,
    });

    writeFileSync(stdoutPath, result.stdout);
    writeFileSync(stderrPath, result.stderr);

    const usage = readUsageLog(usagePath);
    const injected = usage
      .filter((entry) => entry.action === "inject")
      .map((entry) => entry.skill);

    return {
      tool: "claude",
      status: result.exitCode === 0 ? "ok" : "failed",
      duration_ms: Date.now() - start,
      exitCode: result.exitCode,
      stdoutPath,
      stderrPath,
      details: {
        usagePath,
        injected,
      },
    };
  } catch (error) {
    const err = toErrorMessage(error);
    if (err.toLowerCase().includes("not found")) {
      return {
        tool: "claude",
        status: "skipped",
        duration_ms: Date.now() - start,
        exitCode: null,
        error: err,
      };
    }
    return {
      tool: "claude",
      status: "failed",
      duration_ms: Date.now() - start,
      exitCode: null,
      error: err,
    };
  }
}

async function runCodex(): Promise<RunResult> {
  const start = Date.now();
  const stdoutPath = join(artifactsDir, "codex.stdout");
  const stderrPath = join(artifactsDir, "codex.stderr");
  const schemaPath = join(artifactsDir, "codex-schema.json");
  const responsePath = join(artifactsDir, "codex-response.json");
  try {
    const codexCmd =
      process.env.SKILLSET_SMOKE_CODEX_CMD ??
      process.env.SKILLSET_HARNESS_CODEX_CMD ??
      "codex";
    const extraArgs = parseExtraArgs(
      process.env.SKILLSET_SMOKE_CODEX_ARGS ??
        process.env.SKILLSET_HARNESS_CODEX_ARGS
    );
    writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, 2));

    const args = [
      codexCmd,
      "exec",
      "--json",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      responsePath,
      "--skip-git-repo-check",
      "--cd",
      workspaceRoot,
      ...extraArgs,
      codexPrompt,
    ];

    const result = await runCommand(args, {
      cwd: workspaceRoot,
      env: envBase,
      timeoutMs: 120_000,
    });

    writeFileSync(stdoutPath, result.stdout);
    writeFileSync(stderrPath, result.stderr);

    const responseText = safeReadFile(responsePath);
    const evidence = skills.map((skill) => ({
      id: skill.id,
      seen:
        responseText?.includes(skill.sentinel) ||
        result.stdout.includes(skill.sentinel),
    }));

    return {
      tool: "codex",
      status: result.exitCode === 0 ? "ok" : "failed",
      duration_ms: Date.now() - start,
      exitCode: result.exitCode,
      stdoutPath,
      stderrPath,
      details: {
        responsePath,
        evidence,
      },
    };
  } catch (error) {
    const err = toErrorMessage(error);
    if (err.toLowerCase().includes("not found")) {
      return {
        tool: "codex",
        status: "skipped",
        duration_ms: Date.now() - start,
        exitCode: null,
        error: err,
      };
    }
    return {
      tool: "codex",
      status: "failed",
      duration_ms: Date.now() - start,
      exitCode: null,
      error: err,
    };
  }
}

async function loadCore(): Promise<CoreModule> {
  const prev = process.cwd();
  process.chdir(workspaceRoot);
  try {
    const mod = await import(
      `../packages/core/src/index.ts?workspace=${runId}`
    );
    return mod as CoreModule;
  } finally {
    process.chdir(prev);
  }
}

async function withWorkspaceCwd<T>(fn: () => Promise<T> | T): Promise<T> {
  const prev = process.cwd();
  process.chdir(workspaceRoot);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

function loadSetArtifacts(setKey: string) {
  const config = core.loadConfig();
  const cache = core.loadCaches();
  const setDef = config.sets?.[setKey];
  if (!setDef) {
    return null;
  }
  const resolved = setDef.skillRefs.map((ref) => {
    const skill = cache.skills[ref];
    if (!skill) {
      return { ref, found: false };
    }
    let content = "";
    try {
      content = readFileSync(skill.path, "utf8");
    } catch {
      content = "";
    }
    return {
      ref,
      found: true,
      name: skill.name,
      path: skill.path,
      content,
    };
  });
  return {
    key: setKey,
    name: setDef.name,
    description: setDef.description,
    skills: resolved,
  };
}

function indexWorkspaceSkills() {
  const skillsRoot = join(workspaceRoot, ".claude", "skills");
  const files = walkForSkillFiles(skillsRoot);
  const skills: Record<string, SkillCacheEntry> = {};

  for (const file of files) {
    const meta = readSkillMetadata(file, skillsRoot);
    skills[meta.skillRef] = meta;
  }

  const cache = {
    version: 1,
    structureTTL: 3600,
    skills,
  };

  const cacheDir = join(workspaceRoot, ".skillset");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "cache.json"),
    `${JSON.stringify(cache, null, 2)}\n`
  );

  return cache;
}

function walkForSkillFiles(rootDir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkForSkillFiles(fullPath));
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }
  } catch {
    return results;
  }
  return results;
}

function readSkillMetadata(path: string, skillsRoot: string) {
  const content = readFileSync(path, "utf8");
  const lines = content.split(LINE_SPLIT_REGEX);
  const firstHeading = lines.find((line) => line.startsWith("#"));
  const fallbackName = path.split(sep).slice(-2, -1)[0] ?? "unknown";
  const name = firstHeading
    ? firstHeading.replace(/^#+\s*/, "").trim()
    : fallbackName;
  const description = lines
    .find((line) => line.trim().length > 0 && !line.startsWith("#"))
    ?.trim();
  const rel = relative(skillsRoot, path);
  const skillDir = rel.split(sep)[0] ?? fallbackName;
  return {
    skillRef: `project:${skillDir}`,
    path,
    name,
    description,
    structure: undefined,
    lineCount: lines.length,
    cachedAt: new Date().toISOString(),
  };
}

function parseTools(argv: string[]): ToolName[] | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tools" && argv[i + 1]) {
      return argv[i + 1]
        .split(",")
        .map((tool) => tool.trim())
        .filter(Boolean) as ToolName[];
    }
    if (arg.startsWith("--tools=")) {
      return arg
        .slice("--tools=".length)
        .split(",")
        .map((tool) => tool.trim())
        .filter(Boolean) as ToolName[];
    }
  }
  return null;
}

function parseHookModes(argv: string[]): HookMode[] | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--hook-mode" && argv[i + 1]) {
      const modes = argv[i + 1]
        .split(",")
        .map((mode) => mode.trim().toLowerCase())
        .filter((mode) => mode === "ci" || mode === "cli") as HookMode[];
      return modes.length > 0 ? modes : null;
    }
    if (arg.startsWith("--hook-mode=")) {
      const modes = arg
        .slice("--hook-mode=".length)
        .split(",")
        .map((mode) => mode.trim().toLowerCase())
        .filter((mode) => mode === "ci" || mode === "cli") as HookMode[];
      return modes.length > 0 ? modes : null;
    }
  }
  return null;
}

function parseClean(argv: string[]): boolean {
  if (argv.includes("--no-clean")) {
    return false;
  }
  if (argv.includes("--clean")) {
    return true;
  }
  return true;
}

function parseExtraArgs(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(" ")
    .map((arg) => arg.trim())
    .filter(Boolean);
}

async function runCommand(
  command: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    stdinText?: string;
    timeoutMs?: number;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { cwd, env, stdinText, timeoutMs } = options;
  const proc = Bun.spawn(command, {
    cwd,
    env,
    stdin: stdinText ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (stdinText) {
    const encoded = new TextEncoder().encode(stdinText);
    const stdin = proc.stdin as unknown;
    const streamWriter = stdin as {
      getWriter?: () => {
        write: (chunk: Uint8Array) => void;
        close: () => void;
      };
    };
    if (streamWriter?.getWriter) {
      const writer = streamWriter.getWriter();
      writer.write(encoded);
      writer.close();
      return;
    }
    const nodeStream = stdin as {
      write?: (chunk: Uint8Array) => void;
      end?: () => void;
    };
    if (nodeStream?.write) {
      nodeStream.write(encoded);
      nodeStream.end?.();
    }
  }

  let timeoutId: NodeJS.Timeout | undefined;
  if (timeoutMs) {
    timeoutId = setTimeout(() => {
      proc.kill();
    }, timeoutMs);
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  return { stdout, stderr, exitCode };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readUsageLog(path: string): Array<{ action: string; skill: string }> {
  const data = safeReadFile(path);
  if (!data) {
    return [];
  }
  const lines = data.split(LINE_SPLIT_REGEX).filter(Boolean);
  const entries: Array<{ action: string; skill: string }> = [];
  for (const line of lines) {
    const parsed = safeJson(line);
    if (!parsed) {
      continue;
    }
    const action = parsed.action;
    const skill = parsed.skill;
    if (typeof action === "string" && typeof skill === "string") {
      entries.push({ action, skill });
    }
  }
  return entries;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
