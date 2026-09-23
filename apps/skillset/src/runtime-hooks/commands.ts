import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { gitSafeEnv } from "../git-env";
import { SUPPRESS_WORKSPACE_REGISTRATION_ENV } from "../verification-sandbox";

export const MISSING_SKILLSET_RUNNER =
  "skillset: could not find a Skillset CLI runner; install skillset or set SKILLSET_HOOK_COMMAND";

export interface ResolvedSkillsetCommand {
  readonly argv: readonly string[];
  readonly kind: "argv" | "shell";
}

export interface RunSkillsetCommandOptions {
  readonly allowFailure: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly rootPath: string;
  readonly suppressWorkspaceRegistration?: true;
}

export interface SkillsetHookSpawnOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly platform?: NodeJS.Platform;
}

export type RunSkillsetCommand = (
  args: readonly string[],
  options: RunSkillsetCommandOptions
) => Promise<number>;

const WINDOWS_CMD_SUFFIXES = [".cmd", ".bat"] as const;
const UNQUOTED_SHELL_METACHARACTERS = new Set([
  "|",
  "&",
  ";",
  "<",
  ">",
  "$",
  "`",
  "\n",
  "(",
  ")",
  "%",
  "^",
]);

export async function resolveSkillsetCommand(
  rootPath = process.cwd(),
  env: Record<string, string | undefined> = process.env
): Promise<ResolvedSkillsetCommand> {
  const override = env.SKILLSET_HOOK_COMMAND?.trim();
  if (override !== undefined && override.length > 0) {
    return parseSkillsetHookCommand(override);
  }

  if (await isLocalSkillsetCheckout(rootPath)) {
    return { argv: ["bun", "./apps/skillset/src/cli.ts"], kind: "argv" };
  }

  if (commandExists("skillset", rootPath, env)) return { argv: ["skillset"], kind: "argv" };
  if (commandExists("bunx", rootPath, env)) return { argv: ["bunx", "skillset"], kind: "argv" };
  if (commandExists("bun", rootPath, env)) return { argv: ["bun", "x", "skillset"], kind: "argv" };
  if (commandExists("npx", rootPath, env)) return { argv: ["npx", "--yes", "skillset"], kind: "argv" };

  throw new Error(MISSING_SKILLSET_RUNNER);
}

export function parseSkillsetHookCommand(override: string): ResolvedSkillsetCommand {
  const tokens = tokenizeHookArgv(override);
  if (tokens === undefined || tokens.length === 0) return { argv: [override], kind: "shell" };
  return { argv: tokens, kind: "argv" };
}

export function skillsetHookSpawnArgv(
  command: ResolvedSkillsetCommand,
  args: readonly string[],
  options: SkillsetHookSpawnOptions
): readonly string[] {
  const platform = options.platform ?? process.platform;
  if (command.kind === "shell") {
    return shellSpawnArgv(command.argv[0] ?? "", args, platform, options.env);
  }
  return argvSpawnArgv([...command.argv, ...args], platform, options);
}

export async function runSkillsetCommand(
  args: readonly string[],
  options: RunSkillsetCommandOptions
): Promise<number> {
  const command = await resolveSkillsetCommand(options.rootPath, options.env);
  const env = gitSafeEnv({
    ...process.env,
    ...options.env,
    ...(options.suppressWorkspaceRegistration
      ? { [SUPPRESS_WORKSPACE_REGISTRATION_ENV]: "1" }
      : {}),
  });
  const proc = Bun.spawn({
    cmd: [...skillsetHookSpawnArgv(command, args, { cwd: options.rootPath, env })],
    cwd: options.rootPath,
    env,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0 && !options.allowFailure) return exitCode;
  return 0;
}

function argvSpawnArgv(
  argv: readonly string[],
  platform: NodeJS.Platform,
  options: SkillsetHookSpawnOptions
): readonly string[] {
  const command = argv[0] ?? "";
  const resolved = resolveOnPath(command, options.cwd, options.env);
  const executable = resolved ?? command;
  if (platform === "win32" && isWindowsCmdShim(command, executable)) {
    return [
      windowsComSpec(options.env),
      "/d",
      "/s",
      "/c",
      windowsCommandLine([executable, ...argv.slice(1)]),
    ];
  }
  return resolved === null ? [...argv] : [resolved, ...argv.slice(1)];
}

function shellSpawnArgv(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform,
  env: Record<string, string>
): readonly string[] {
  if (platform === "win32") {
    return [
      windowsComSpec(env),
      "/d",
      "/s",
      "/c",
      `${command} ${args.map(windowsCmdQuote).join(" ")}`.trim(),
    ];
  }
  return ["/bin/sh", "-lc", `${command} ${args.map(posixShellQuote).join(" ")}`.trim()];
}

function commandExists(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>
): boolean {
  return resolveOnPath(command, cwd, env) !== null;
}

function resolveOnPath(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>
): string | null {
  if (command.length === 0) return null;
  return Bun.which(
    command,
    env.PATH === undefined ? { cwd } : { PATH: env.PATH, cwd }
  );
}

function isWindowsCmdShim(...candidates: readonly string[]): boolean {
  return candidates.some((candidate) => {
    const lower = candidate.toLowerCase();
    return WINDOWS_CMD_SUFFIXES.some((suffix) => lower.endsWith(suffix));
  });
}

function windowsComSpec(env: Record<string, string>): string {
  return env.ComSpec ?? env.COMSPEC ?? "cmd.exe";
}

function windowsCommandLine(argv: readonly string[]): string {
  return argv.map(windowsCmdQuote).join(" ");
}

function windowsCmdQuote(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"&|<>^%()]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function tokenizeHookArgv(value: string): readonly string[] | undefined {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (const character of value) {
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else current += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = undefined;
        continue;
      }
      if (character === "$" || character === "`" || character === "%") return undefined;
      current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    if (UNQUOTED_SHELL_METACHARACTERS.has(character)) return undefined;
    current += character;
  }

  if (quote !== undefined) return undefined;
  if (current.length > 0) tokens.push(current);
  return tokens;
}

async function isLocalSkillsetCheckout(rootPath: string): Promise<boolean> {
  if (!(await exists(join(rootPath, "apps", "skillset", "src", "cli.ts")))) return false;

  try {
    const packageJson = JSON.parse(await readFile(join(rootPath, "package.json"), "utf8")) as { readonly name?: unknown };
    return packageJson.name === "skillset-workspace";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function posixShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
