import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  FINITE_JSON_ROUTES,
  JSONL_ROUTES,
} from "../apps/skillset/src/cli-contract";
import { renderCliHelp } from "../apps/skillset/src/cli-help";
import { CLI_PRESENTATION_CATALOG } from "../apps/skillset/src/cli-presentation";

type DistributionRuntime = "bun" | "native" | "node-launcher";

interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface SmokeOptions {
  readonly bunxPackage?: string;
  readonly executable?: string;
  readonly exhaustive?: boolean;
  readonly expectedVersion: string;
  readonly runtime: DistributionRuntime;
}

export function distributionCommandBase(
  options: Pick<SmokeOptions, "bunxPackage" | "executable" | "runtime">,
  platform = process.platform,
  bunExecutable = process.execPath
): readonly string[] {
  if (
    (options.executable === undefined) ===
    (options.bunxPackage === undefined)
  ) {
    throw new Error("Specify exactly one executable or Bun package runner");
  }
  if (options.bunxPackage) {
    return [bunExecutable, "x", "--package", options.bunxPackage, "skillset"];
  }
  const executable = resolve(options.executable ?? "");
  return options.runtime === "bun" &&
    !(platform === "win32" && executable.toLowerCase().endsWith(".exe"))
    ? [bunExecutable, executable]
    : [executable];
}

async function run(
  command: readonly string[],
  env: Record<string, string>
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

function assertSuccess(result: CommandResult, label: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} exited ${result.exitCode}:\n${result.stdout}${result.stderr}`
    );
  }
}

async function writeSentinel(
  directory: string,
  name: "bun" | "node",
  marker: string
): Promise<void> {
  if (process.platform === "win32") {
    await writeFile(
      join(directory, `${name}.cmd`),
      `@echo off\r\n>"${marker}" echo invoked\r\nexit /b 86\r\n`
    );
    return;
  }
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\nprintf invoked > '${marker}'\nexit 86\n`);
  await chmod(path, 0o755);
}

async function exposeRuntime(
  directory: string,
  runtime: DistributionRuntime,
  markerRoot: string
): Promise<{
  readonly markers: readonly string[];
}> {
  const bunMarker = join(markerRoot, "bun-was-invoked");
  const nodeMarker = join(markerRoot, "node-was-invoked");
  if (runtime === "native") {
    await Promise.all([
      writeSentinel(directory, "bun", bunMarker),
      writeSentinel(directory, "node", nodeMarker),
    ]);
    return { markers: [bunMarker, nodeMarker] };
  }
  if (runtime === "bun") {
    await writeSentinel(directory, "node", nodeMarker);
    return { markers: [nodeMarker] };
  }

  const node = Bun.which("node");
  if (!node) throw new Error("npm launcher conformance requires Node");
  if (process.platform === "win32") {
    await copyFile(node, join(directory, "node.exe"));
  } else {
    await symlink(node, join(directory, "node"));
  }
  await writeSentinel(directory, "bun", bunMarker);
  return { markers: [bunMarker] };
}

function commandFor(
  base: readonly string[],
  args: readonly string[]
): readonly string[] {
  const executable = base[0] ?? "";
  if (
    process.platform === "win32" &&
    base.length === 1 &&
    executable.toLowerCase().endsWith(".cmd")
  ) {
    return [
      process.env.ComSpec ?? "cmd.exe",
      "/d",
      "/s",
      "/c",
      executable,
      ...args,
    ];
  }
  return [...base, ...args];
}

export async function smokeDistribution(options: SmokeOptions): Promise<void> {
  const base = distributionCommandBase(options);
  const root = await mkdtemp(join(tmpdir(), "skillset-distribution-smoke-"));
  const tools = join(root, "tools");
  await mkdir(tools, { recursive: true });
  const runtime = await exposeRuntime(tools, options.runtime, root);
  const env = { ...process.env, PATH: tools } as Record<string, string>;
  const invoke = (args: readonly string[]) => run(commandFor(base, args), env);

  try {
    const version = await invoke(["--version"]);
    assertSuccess(version, `${options.runtime} version`);
    if (
      version.stdout !== `${options.expectedVersion}\n` ||
      version.stderr !== ""
    ) {
      throw new Error(
        `${options.runtime} version mismatch: stdout=${JSON.stringify(version.stdout)} stderr=${JSON.stringify(version.stderr)}`
      );
    }

    const help = await invoke(["--help"]);
    assertSuccess(help, `${options.runtime} help`);
    if (
      !help.stdout.includes("Usage\n  skillset <command>") ||
      help.stderr !== ""
    ) {
      throw new Error(
        `${options.runtime} help does not match the CLI contract`
      );
    }

    const lookup = await invoke(["lookup", "workspace", "--json"]);
    assertSuccess(lookup, `${options.runtime} lookup`);
    const result = JSON.parse(lookup.stdout) as {
      readonly command?: string;
      readonly exitCode?: number;
      readonly ok?: boolean;
    };
    if (
      result.command !== "lookup" ||
      result.exitCode !== 0 ||
      result.ok !== true ||
      lookup.stderr !== ""
    ) {
      throw new Error(
        `${options.runtime} lookup does not match the CLI contract`
      );
    }

    const invalid = await invoke(["__distribution-invalid__"]);
    if (
      invalid.exitCode !== 1 ||
      !invalid.stderr.includes("skillset: expected command") ||
      !invalid.stderr.includes("usage: skillset")
    ) {
      throw new Error(
        `${options.runtime} invalid-command behavior does not match the CLI contract`
      );
    }

    if (options.exhaustive) {
      for (const route of CLI_PRESENTATION_CATALOG) {
        const routeArgs = route.route.split(" ");
        const help = await invoke([...routeArgs, "--help"]);
        assertSuccess(help, `${options.runtime} ${route.route} help`);
        const expectedHelp = `${renderCliHelp([...routeArgs, "--help"], {
          color: false,
          width: 80,
        })}\n`;
        if (help.stdout !== expectedHelp || help.stderr !== "") {
          throw new Error(
            `${options.runtime} ${route.route} help does not match the CLI contract`
          );
        }
        const structured = FINITE_JSON_ROUTES.includes(route.route as never)
          ? "--json"
          : JSONL_ROUTES.includes(route.route as never)
            ? "--jsonl"
            : undefined;
        if (structured && !help.stdout.includes(structured)) {
          throw new Error(
            `${options.runtime} ${route.route} omits ${structured} from help`
          );
        }
        const failure = await invoke([
          ...routeArgs,
          "--__distribution-invalid__",
        ]);
        if (
          failure.exitCode !== 1 ||
          failure.stdout !== "" ||
          !failure.stderr.startsWith("skillset:")
        ) {
          throw new Error(
            `${options.runtime} ${route.route} exit behavior does not match the CLI contract`
          );
        }
      }
    }

    for (const marker of runtime.markers) {
      await access(marker).then(
        () => {
          throw new Error(
            `${options.runtime} distribution invoked forbidden runtime ${marker.split("/").at(-1)}`
          );
        },
        () => undefined
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function readValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

function parseRuntime(value: string): DistributionRuntime {
  if (value === "bun" || value === "native" || value === "node-launcher") {
    return value;
  }
  throw new Error(`Unsupported distribution runtime: ${value}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await smokeDistribution({
    ...(args.includes("--bunx-package")
      ? { bunxPackage: readValue(args, "--bunx-package") }
      : { executable: readValue(args, "--executable") }),
    exhaustive: args.includes("--exhaustive"),
    expectedVersion: readValue(args, "--version"),
    runtime: parseRuntime(readValue(args, "--runtime")),
  }).then(
    () => console.error("skillset: distribution conformance passed"),
    (error: unknown) => {
      console.error(
        `skillset: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  );
}
