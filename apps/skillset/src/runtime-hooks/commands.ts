import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { gitSafeEnv } from "../git-env";

export interface ResolvedSkillsetCommand {
  readonly argv: readonly string[];
  readonly kind: "argv" | "shell";
}

export interface RunSkillsetCommandOptions {
  readonly allowFailure: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly rootPath: string;
}

export type RunSkillsetCommand = (
  args: readonly string[],
  options: RunSkillsetCommandOptions
) => Promise<number>;

export async function resolveSkillsetCommand(
  rootPath = process.cwd(),
  env: Record<string, string | undefined> = process.env
): Promise<ResolvedSkillsetCommand> {
  const override = env.SKILLSET_HOOK_COMMAND?.trim();
  if (override !== undefined && override.length > 0) return { argv: [override], kind: "shell" };

  if (await isLocalSkillsetCheckout(rootPath)) {
    return { argv: ["bun", "./apps/skillset/src/cli.ts"], kind: "argv" };
  }

  if (await commandExists("skillset", rootPath, env)) return { argv: ["skillset"], kind: "argv" };
  if (await commandExists("bunx", rootPath, env)) return { argv: ["bunx", "skillset"], kind: "argv" };
  if (await commandExists("bun", rootPath, env)) return { argv: ["bun", "x", "skillset"], kind: "argv" };
  if (await commandExists("npx", rootPath, env)) return { argv: ["npx", "--yes", "skillset"], kind: "argv" };

  throw new Error(
    "skillset: could not find a Skillset CLI runner; install skillset or set SKILLSET_HOOK_COMMAND"
  );
}

export async function runSkillsetCommand(
  args: readonly string[],
  options: RunSkillsetCommandOptions
): Promise<number> {
  const command = await resolveSkillsetCommand(options.rootPath, options.env);
  const env = gitSafeEnv({ ...process.env, ...options.env });
  const exitCode = command.kind === "shell"
    ? await runShell(command.argv[0] ?? "", args, { cwd: options.rootPath, env })
    : await runArgv([...command.argv, ...args], { cwd: options.rootPath, env });

  if (exitCode !== 0 && !options.allowFailure) return exitCode;
  return 0;
}

async function runArgv(argv: readonly string[], options: {
  readonly cwd: string;
  readonly env: Record<string, string>;
}): Promise<number> {
  const proc = Bun.spawn({
    cmd: [...argv],
    cwd: options.cwd,
    env: options.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  return proc.exited;
}

async function runShell(command: string, args: readonly string[], options: {
  readonly cwd: string;
  readonly env: Record<string, string>;
}): Promise<number> {
  const proc = Bun.spawn({
    cmd: ["sh", "-lc", `${command} ${args.map(shellQuote).join(" ")}`.trim()],
    cwd: options.cwd,
    env: options.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  return proc.exited;
}

async function commandExists(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>
): Promise<boolean> {
  const result = await capture(["/bin/sh", "-lc", `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
    cwd,
    env,
  });
  return result.exitCode === 0;
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

async function capture(argv: readonly string[], options: {
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
}): Promise<{
  readonly exitCode: number;
}> {
  const proc = Bun.spawn({
    cmd: [...argv],
    cwd: options.cwd,
    env: gitSafeEnv(options.env),
    stderr: "ignore",
    stdout: "ignore",
  });
  const exitCode = await proc.exited;
  return { exitCode };
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
