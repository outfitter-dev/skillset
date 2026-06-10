#!/usr/bin/env bun
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type RuntimeHookCommand = 'post-tool-use' | 'stop';

export interface ResolvedSkillsetCommand {
  readonly argv: readonly string[];
  readonly kind: 'argv' | 'shell';
}

const SOURCE_CHANGE_PATHS = [
  '.skillset/config.yaml',
  '.skillset/instructions',
  '.skillset/skills',
  '.skillset/plugins',
  '.skillset/shared',
  '.skillset/src',
  '.skillset/changes/pending',
] as const;

export function skillsetRuntimeSourcePaths(): readonly string[] {
  return SOURCE_CHANGE_PATHS;
}

export async function hasSkillsetRuntimeSourceChanges(
  rootPath = process.cwd()
): Promise<boolean> {
  const result = await capture(
    [
      'git',
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      ...SOURCE_CHANGE_PATHS,
    ],
    {
      cwd: rootPath,
    }
  );
  if (result.exitCode !== 0) {
    return false;
  }
  return result.stdout.trim().length > 0;
}

export async function resolveSkillsetCommand(
  rootPath = process.cwd(),
  env: Record<string, string | undefined> = process.env
): Promise<ResolvedSkillsetCommand> {
  const override = env.SKILLSET_HOOK_COMMAND?.trim();
  if (override !== undefined && override.length > 0) {
    return { argv: [override], kind: 'shell' };
  }

  if (await isLocalSkillsetCheckout(rootPath)) {
    return { argv: ['bun', './src/cli.ts'], kind: 'argv' };
  }

  if (await commandExists('skillset', rootPath)) {
    return { argv: ['skillset'], kind: 'argv' };
  }
  if (await commandExists('bunx', rootPath)) {
    return { argv: ['bunx', 'skillset@beta'], kind: 'argv' };
  }
  if (await commandExists('bun', rootPath)) {
    return { argv: ['bun', 'x', 'skillset@beta'], kind: 'argv' };
  }
  if (await commandExists('npx', rootPath)) {
    return { argv: ['npx', '--yes', 'skillset@beta'], kind: 'argv' };
  }

  throw new Error(
    'skillset: could not find a Skillset CLI runner; install skillset or set SKILLSET_HOOK_COMMAND'
  );
}

export async function runRuntimeHook(
  command: RuntimeHookCommand,
  rootPath = process.cwd()
): Promise<number> {
  if (!(await hasSkillsetRuntimeSourceChanges(rootPath))) {
    return 0;
  }

  if (command === 'post-tool-use') {
    await runSkillset(['change', 'status', '--root', '.'], {
      allowFailure: true,
      rootPath,
    });
    return 0;
  }

  const changeCheck = await runSkillset(['change', 'check', '--root', '.'], {
    allowFailure: false,
    rootPath,
  });
  if (changeCheck !== 0) {
    return changeCheck;
  }
  return runSkillset(['check', '--root', '.'], {
    allowFailure: false,
    rootPath,
  });
}

async function runSkillset(
  args: readonly string[],
  options: { readonly allowFailure: boolean; readonly rootPath: string }
): Promise<number> {
  const command = await resolveSkillsetCommand(options.rootPath);
  const exitCode =
    command.kind === 'shell'
      ? await runShell(command.argv[0] ?? '', args, options.rootPath)
      : await runArgv([...command.argv, ...args], options.rootPath);

  if (exitCode !== 0 && !options.allowFailure) {
    return exitCode;
  }
  return 0;
}

async function runArgv(argv: readonly string[], cwd: string): Promise<number> {
  const proc = Bun.spawn({
    cmd: [...argv],
    cwd,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  return proc.exited;
}

async function runShell(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<number> {
  const proc = Bun.spawn({
    cmd: ['sh', '-lc', `${command} ${args.map(shellQuote).join(' ')}`.trim()],
    cwd,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  return proc.exited;
}

async function commandExists(command: string, cwd: string): Promise<boolean> {
  const result = await capture(
    ['sh', '-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`],
    { cwd }
  );
  return result.exitCode === 0;
}

async function isLocalSkillsetCheckout(rootPath: string): Promise<boolean> {
  if (!(await exists(join(rootPath, 'src', 'cli.ts')))) {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      await readFile(join(rootPath, 'package.json'), 'utf-8')
    ) as { readonly name?: unknown };
    return packageJson.name === 'skillset';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function capture(
  argv: readonly string[],
  options: { readonly cwd: string }
): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: [...argv],
    cwd: options.cwd,
    stderr: 'ignore',
    stdout: 'pipe',
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return { exitCode, stdout };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function parseRuntimeHookCommand(
  value: string | undefined
): RuntimeHookCommand {
  if (value === 'post-tool-use' || value === 'stop') {
    return value;
  }
  throw new Error(
    'usage: bun .skillset/shared/scripts/skillset-runtime-hooks.ts <post-tool-use|stop>'
  );
}

if (import.meta.main) {
  try {
    const exitCode = await runRuntimeHook(parseRuntimeHookCommand(Bun.argv[2]));
    process.exit(exitCode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
