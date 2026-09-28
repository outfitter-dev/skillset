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

export interface SkillsetHookSpawn {
  readonly cmd: readonly string[];
  /** Pass the command line to cmd.exe as written; see `windowsComSpecSpawn`. */
  readonly windowsVerbatimArguments: boolean;
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
// POSIX sh also expands or reinterprets these outside quotes (tilde, globs,
// brace lists, comments, escapes). Overrides using them keep running through
// the shell, as every override did before argv overrides existed.
const POSIX_ONLY_SHELL_CHARACTERS = new Set(["~", "*", "?", "[", "]", "{", "}", "#", "\\"]);
const LEADING_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
// A leading word that only sh understands: the POSIX reserved words that can
// open a command, plus built-ins that act on the shell itself and have no
// useful standalone executable (`builtin` and `source` are common extensions).
// Spawned as argv, `exec skillset` would look for an executable named `exec`.
// The list is deliberately small; anything else stays argv.
const POSIX_SHELL_LEADING_WORDS = new Set([
  "!",
  "{",
  "case",
  "for",
  "if",
  "until",
  "while",
  ".",
  "builtin",
  "cd",
  "command",
  "eval",
  "exec",
  "export",
  "readonly",
  "set",
  "source",
  "ulimit",
  "umask",
  "unset",
]);
// The code sh reports for a command it cannot find.
const COMMAND_NOT_FOUND_EXIT_CODE = 127;

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

export function parseSkillsetHookCommand(
  override: string,
  platform: NodeJS.Platform = process.platform
): ResolvedSkillsetCommand {
  const tokens = tokenizeHookArgv(override, platform);
  if (tokens === undefined || tokens.length === 0) return { argv: [override], kind: "shell" };
  if (platform !== "win32" && POSIX_SHELL_LEADING_WORDS.has(tokens[0] ?? "")) {
    return { argv: [override], kind: "shell" };
  }
  return { argv: tokens, kind: "argv" };
}

export function skillsetHookSpawn(
  command: ResolvedSkillsetCommand,
  args: readonly string[],
  options: SkillsetHookSpawnOptions
): SkillsetHookSpawn {
  const platform = options.platform ?? process.platform;
  if (command.kind === "shell") {
    return shellSpawn(command.argv[0] ?? "", args, platform, options.env);
  }
  return argvSpawn([...command.argv, ...args], platform, options);
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
  const spawn = skillsetHookSpawn(command, args, { cwd: options.rootPath, env });
  const exitCode = await spawnHookCommand(spawn, options.rootPath, env);

  if (exitCode !== 0 && !options.allowFailure) return exitCode;
  return 0;
}

async function spawnHookCommand(
  spawn: SkillsetHookSpawn,
  cwd: string,
  env: Record<string, string>
): Promise<number> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn({
      cmd: [...spawn.cmd],
      cwd,
      env,
      stderr: "inherit",
      stdout: "inherit",
      windowsVerbatimArguments: spawn.windowsVerbatimArguments,
    });
  } catch (error) {
    // Bun.spawn throws when the executable is missing; report it the way a
    // shell would, so an advisory hook stays advisory instead of rejecting.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      process.stderr.write(`skillset: hook command not found: ${error.message}\n`);
      return COMMAND_NOT_FOUND_EXIT_CODE;
    }
    throw error;
  }
  return proc.exited;
}

function argvSpawn(
  argv: readonly string[],
  platform: NodeJS.Platform,
  options: SkillsetHookSpawnOptions
): SkillsetHookSpawn {
  const command = argv[0] ?? "";
  const resolved = resolveOnPath(command, options.cwd, options.env);
  const executable = resolved ?? command;
  if (platform === "win32" && isWindowsCmdShim(command, executable)) {
    return windowsComSpecSpawn(options.env, windowsCommandLine([executable, ...argv.slice(1)]));
  }
  return {
    cmd: resolved === null ? [...argv] : [resolved, ...argv.slice(1)],
    windowsVerbatimArguments: false,
  };
}

function shellSpawn(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform,
  env: Record<string, string>
): SkillsetHookSpawn {
  if (platform === "win32") {
    return windowsComSpecSpawn(env, `${command} ${args.map(windowsCmdQuote).join(" ")}`.trim());
  }
  return {
    cmd: ["/bin/sh", "-lc", `${command} ${args.map(posixShellQuote).join(" ")}`.trim()],
    windowsVerbatimArguments: false,
  };
}

/**
 * `cmd /d /s /c "<line>"`, passed verbatim. With `/s`, cmd.exe strips exactly
 * the outer quotes and runs the rest, so quoted paths inside `line` survive.
 * Without verbatim arguments the runtime would re-quote the line and escape
 * its inner quotes as `\"`, which cmd.exe does not understand.
 */
function windowsComSpecSpawn(env: Record<string, string>, line: string): SkillsetHookSpawn {
  return {
    cmd: [windowsCmdQuote(windowsComSpec(env)), "/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
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
  // A Windows environment copied from process.env spells the key `Path`.
  const path = env.PATH ?? (process.platform === "win32" ? env.Path : undefined);
  return Bun.which(command, path === undefined ? { cwd } : { PATH: path, cwd });
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

function tokenizeHookArgv(
  value: string,
  platform: NodeJS.Platform
): readonly string[] | undefined {
  // A leading `NAME=value` is an environment assignment only a shell applies.
  if (LEADING_ASSIGNMENT.test(value)) return undefined;
  const posix = platform !== "win32";
  const tokens: string[] = [];
  let current = "";
  // Whether a token has started, so an explicitly empty `""` is still emitted.
  let opened = false;
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
      if (posix && character === "\\") return undefined;
      current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      opened = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (opened) {
        tokens.push(current);
        current = "";
        opened = false;
      }
      continue;
    }
    if (UNQUOTED_SHELL_METACHARACTERS.has(character)) return undefined;
    if (posix && POSIX_ONLY_SHELL_CHARACTERS.has(character)) return undefined;
    current += character;
    opened = true;
  }

  if (quote !== undefined) return undefined;
  if (opened) tokens.push(current);
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
