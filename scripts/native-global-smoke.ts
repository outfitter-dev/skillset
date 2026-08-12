import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import productManifest from "../apps/skillset/package.json";
import {
  currentLauncherRuntime,
  selectNativeDistribution,
} from "../apps/skillset/src/launcher";
import {
  REQUIRED_NATIVE_DISTRIBUTIONS,
  getNativeDistribution,
  nativePackageDirectory,
} from "../apps/skillset/src/native-distribution";
import { buildNativePackages } from "./native-packages";
import { REQUIRED_NATIVE_TARGETS } from "./native-targets";

interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

async function run(
  command: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string> } = {}
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: options.env ?? process.env,
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
      `${label} failed (${result.exitCode}):\n${result.stdout}${result.stderr}`
    );
  }
}

async function packLauncher(
  root: string,
  nativeTarballs: readonly string[],
  npmExecutable: string
): Promise<string> {
  const stage = join(root, "launcher");
  await mkdir(join(stage, "dist"), { recursive: true });
  for (const path of ["README.md", "LICENSE", "package.json"] as const) {
    await copyFile(join("apps", "skillset", path), join(stage, path));
  }
  await copyFile(
    join("apps", "skillset", "dist", "cli.js"),
    join(stage, "dist", "cli.js")
  );
  await chmod(join(stage, "dist", "cli.js"), 0o755);

  const manifest = JSON.parse(
    await readFile(join(stage, "package.json"), "utf8")
  ) as { optionalDependencies: Record<string, string> };
  manifest.optionalDependencies = Object.fromEntries(
    REQUIRED_NATIVE_DISTRIBUTIONS.map((distribution, index) => {
      const tarball = nativeTarballs[index];
      if (!tarball) {
        throw new Error(
          `Missing packed tarball for ${distribution.npmPackage}`
        );
      }
      return [distribution.npmPackage, npmLocalTarballSpec(resolve(tarball))];
    })
  );
  await writeFile(
    join(stage, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const packDir = join(root, "launcher-tarball");
  await mkdir(packDir, { recursive: true });
  const packed = await run(
    [
      npmExecutable,
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      packDir,
    ],
    { cwd: stage }
  );
  assertSuccess(packed, "packing the skillset launcher");
  const result = JSON.parse(packed.stdout) as Array<{ filename?: string }>;
  const filename = result[0]?.filename;
  if (result.length !== 1 || !filename) {
    throw new Error("npm pack did not return one launcher tarball");
  }
  return join(packDir, filename);
}

async function isolatedNodeTools(root: string): Promise<{
  readonly marker: string;
  readonly path: string;
}> {
  const path = join(root, "tools");
  const marker = join(root, "system-bun-was-invoked");
  await mkdir(path, { recursive: true });
  const node = Bun.which("node");
  if (!node) throw new Error("Target-host npm smoke requires Node");
  if (process.platform === "win32") {
    await copyFile(node, join(path, "node.exe"));
    await writeFile(
      join(path, "bun.cmd"),
      `@echo off\r\n>"${marker}" echo invoked\r\nexit /b 86\r\n`
    );
  } else {
    await symlink(node, join(path, "node"));
    await writeFile(
      join(path, "bun"),
      `#!/bin/sh\nprintf invoked > '${marker}'\nexit 86\n`
    );
    await chmod(join(path, "bun"), 0o755);
  }
  return { marker, path };
}

function globalRoot(prefix: string): string {
  return process.platform === "win32"
    ? join(prefix, "node_modules")
    : join(prefix, "lib", "node_modules");
}

function globalCommand(prefix: string): string {
  return process.platform === "win32"
    ? join(prefix, "skillset.cmd")
    : join(prefix, "bin", "skillset");
}

async function runInstalled(
  prefix: string,
  toolsPath: string,
  args: readonly string[]
): Promise<CommandResult> {
  const executable = globalCommand(prefix);
  const command =
    process.platform === "win32"
      ? [
          process.env.ComSpec ?? "cmd.exe",
          "/d",
          "/s",
          "/c",
          executable,
          ...args,
        ]
      : [executable, ...args];
  return run(command, {
    env: {
      ...process.env,
      PATH: [toolsPath].join(delimiter),
    },
  });
}

async function assertInstalledSet(
  prefix: string,
  expectedPackage: string
): Promise<void> {
  const scope = join(
    globalRoot(prefix),
    "skillset",
    "node_modules",
    "@skillset"
  );
  const expectedDirectory = expectedPackage.replace("@skillset/", "");
  const installed = await readdir(scope)
    .then((entries) => entries.sort())
    .catch(() => [] as string[]);
  if (installed.length !== 1 || installed[0] !== expectedDirectory) {
    throw new Error(
      `Expected only ${expectedPackage}, found ${installed.join(", ") || "no native package"}`
    );
  }
}

async function installLauncher(
  prefix: string,
  cache: string,
  launcherTarball: string,
  npmExecutable: string
): Promise<void> {
  const installed = await run(
    [
      npmExecutable,
      "install",
      "--location=global",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--offline",
      "--prefix",
      prefix,
      "--cache",
      cache,
      launcherTarball,
    ],
    {
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: "1",
        npm_config_update_notifier: "false",
      },
    }
  );
  assertSuccess(installed, "installing the global skillset launcher");
  if (installed.stdout.trim()) console.error(installed.stdout.trim());
  if (installed.stderr.trim()) console.error(installed.stderr.trim());
}

export function resolveNpmExecutable(
  which: (name: string) => string | null = Bun.which
): string {
  const executable = which("npm");
  if (!executable) {
    throw new Error("Target-host npm smoke requires npm");
  }
  return executable;
}

export function npmLocalTarballSpec(
  absolutePath: string,
  platform: string = process.platform
): string {
  if (platform === "win32") {
    return `file:${absolutePath.replaceAll("\\", "/")}`;
  }
  return pathToFileURL(absolutePath).href;
}

export async function smokeGlobalNativeInstall(options: {
  readonly nativeOutputDir: string;
  readonly suffix: string;
}): Promise<void> {
  const expected = getNativeDistribution(options.suffix);
  const current = selectNativeDistribution(currentLauncherRuntime());
  const npmExecutable = resolveNpmExecutable();
  if (expected.suffix !== current.suffix) {
    throw new Error(
      `Target-host smoke expected ${expected.suffix}, current host selects ${current.suffix}`
    );
  }

  const root = await mkdtemp(join(tmpdir(), "skillset-global-smoke-"));
  try {
    const nativePackDir = join(root, "native-tarballs");
    const nativeTarballs = await buildNativePackages({
      nativeOutputDir: options.nativeOutputDir,
      packDir: nativePackDir,
      targets: REQUIRED_NATIVE_TARGETS,
    });
    const launcherTarball = await packLauncher(
      root,
      nativeTarballs,
      npmExecutable
    );
    const prefix = join(root, "prefix");
    const cache = join(root, "npm-cache");
    await installLauncher(prefix, cache, launcherTarball, npmExecutable);
    await assertInstalledSet(prefix, expected.npmPackage);

    const tools = await isolatedNodeTools(root);
    const version = await runInstalled(prefix, tools.path, ["--version"]);
    assertSuccess(version, "running globally installed skillset --version");
    if (
      version.stdout !== `${productManifest.version}\n` ||
      version.stderr !== ""
    ) {
      throw new Error(
        `Global skillset version mismatch: stdout=${JSON.stringify(version.stdout)} stderr=${JSON.stringify(version.stderr)}`
      );
    }
    const help = await runInstalled(prefix, tools.path, ["--help"]);
    assertSuccess(help, "running globally installed skillset --help");
    if (!help.stdout.startsWith("Skillset\n")) {
      throw new Error("Global skillset help did not preserve the CLI surface");
    }
    await access(tools.marker).then(
      () => {
        throw new Error("Global native launcher invoked Bun");
      },
      () => undefined
    );

    const removed = await run([
      npmExecutable,
      "uninstall",
      "--location=global",
      "--prefix",
      prefix,
      "skillset",
    ]);
    assertSuccess(removed, "uninstalling global skillset");
    await access(globalCommand(prefix)).then(
      () => {
        throw new Error("Global skillset command survived uninstall");
      },
      () => undefined
    );

    await installLauncher(prefix, cache, launcherTarball, npmExecutable);
    await assertInstalledSet(prefix, expected.npmPackage);
    const reinstalled = await runInstalled(prefix, tools.path, ["--version"]);
    assertSuccess(reinstalled, "running reinstalled global skillset");
    if (reinstalled.stdout !== `${productManifest.version}\n`) {
      throw new Error("Reinstalled global skillset reported the wrong version");
    }
  } finally {
    if (process.env.SKILLSET_RETAIN_NATIVE_SMOKE === "1") {
      console.error(`skillset: retained global smoke root at ${root}`);
    } else {
      await rm(root, { force: true, recursive: true });
    }
    for (const distribution of REQUIRED_NATIVE_DISTRIBUTIONS) {
      const packageDir = nativePackageDirectory(distribution);
      await Promise.all([
        rm(join(packageDir, "bin"), { force: true, recursive: true }),
        rm(join(packageDir, "README.md"), { force: true }),
        rm(join(packageDir, "LICENSE"), { force: true }),
      ]);
    }
  }
}

function parseArgs(args: readonly string[]): {
  readonly nativeOutputDir: string;
  readonly suffix: string;
} {
  let nativeOutputDir = ".skillset/cache/native";
  let suffix = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    if (arg === "--native-out-dir") nativeOutputDir = value;
    else if (arg === "--target") suffix = value;
    else throw new Error(`Unknown global smoke argument: ${arg}`);
    index += 1;
  }
  if (!suffix) throw new Error("Global smoke requires --target");
  return { nativeOutputDir, suffix };
}

if (import.meta.main) {
  await smokeGlobalNativeInstall(parseArgs(process.argv.slice(2))).then(
    () => console.error("skillset: global native install smoke passed"),
    (error: unknown) => {
      console.error(
        `skillset: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  );
}
