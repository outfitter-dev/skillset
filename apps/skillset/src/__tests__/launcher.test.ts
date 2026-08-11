import { afterAll, describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  SkillsetLauncherError,
  detectLinuxLibc,
  executeLauncher,
  type LauncherRuntimeReport,
  resolveNativeExecutable,
  selectNativeDistribution,
} from "../launcher";
import { getNativeDistribution } from "../native-distribution";

const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-launcher-test-"));
  temporaryRoots.push(root);
  return root;
}

describe("SET-420 npm native launcher", () => {
  test("selects only the five initial native distributions", () => {
    expect(
      selectNativeDistribution({
        arch: "arm64",
        libc: "unknown",
        platform: "darwin",
      }).npmPackage
    ).toBe("@skillset/native-darwin-arm64");
    expect(
      selectNativeDistribution({
        arch: "x64",
        libc: "glibc",
        platform: "linux",
      }).npmPackage
    ).toBe("@skillset/native-linux-x64-glibc");
    expect(
      selectNativeDistribution({
        arch: "x64",
        libc: "unknown",
        platform: "win32",
      }).npmPackage
    ).toBe("@skillset/native-win32-x64");
    expect(() =>
      selectNativeDistribution({
        arch: "x64",
        libc: "musl",
        platform: "linux",
      })
    ).toThrow("reserved but not in the initial release");
    expect(() =>
      selectNativeDistribution({
        arch: "arm64",
        libc: "unknown",
        platform: "freebsd",
      })
    ).toThrow("Unsupported platform freebsd-arm64");
    expect(() =>
      selectNativeDistribution({
        arch: "riscv64",
        libc: "musl",
        platform: "linux",
      })
    ).toThrow("Unsupported platform linux-riscv64");
    expect(() =>
      selectNativeDistribution({
        arch: "riscv64",
        libc: "unknown",
        platform: "linux",
      })
    ).toThrow("Unsupported platform linux-riscv64");
  });

  test("detects glibc, musl, and unknown Linux reports without subprocesses", () => {
    expect(
      detectLinuxLibc({
        header: { glibcVersionRuntime: "2.39" },
        sharedObjects: [],
      } as LauncherRuntimeReport)
    ).toBe("glibc");
    expect(
      detectLinuxLibc({
        header: {},
        sharedObjects: ["/lib/ld-musl-x86_64.so.1"],
      } as LauncherRuntimeReport)
    ).toBe("musl");
    expect(detectLinuxLibc(undefined)).toBe("unknown");
  });

  test("rejects omitted, mismatched, and corrupt platform packages", async () => {
    const distribution = getNativeDistribution("darwin-arm64");
    await expect(
      resolveNativeExecutable({
        distribution,
        launcherVersion: "1.2.3",
        resolvePackage: () => {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "MODULE_NOT_FOUND";
          throw error;
        },
      })
    ).rejects.toThrow("optional dependencies enabled");

    const root = await temporaryRoot();
    const manifestPath = join(root, "package.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify({ name: distribution.npmPackage, version: "9.9.9" })}\n`
    );
    await expect(
      resolveNativeExecutable({
        distribution,
        launcherVersion: "1.2.3",
        resolvePackage: () => manifestPath,
      })
    ).rejects.toThrow("Package version mismatch");

    await writeFile(
      manifestPath,
      `${JSON.stringify({ name: distribution.npmPackage, version: "1.2.3" })}\n`
    );
    await expect(
      resolveNativeExecutable({
        distribution,
        launcherVersion: "1.2.3",
        resolvePackage: () => manifestPath,
      })
    ).rejects.toThrow("missing or corrupt");
  });

  test("reports a missing or corrupt launcher manifest as a reinstall error", async () => {
    const root = await temporaryRoot();
    const manifestPath = join(root, "package.json");
    await expect(
      executeLauncher([], { packageJsonPath: manifestPath })
    ).rejects.toThrow("launcher package manifest is invalid");
    await writeFile(manifestPath, "not json\n");
    await expect(
      executeLauncher([], { packageJsonPath: manifestPath })
    ).rejects.toThrow("launcher package manifest is invalid");
  });

  test("forwards argv and preserves the native exit code", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryRoot();
    const productManifest = join(root, "skillset", "package.json");
    const nativeManifest = join(root, "native", "package.json");
    const executable = join(root, "native", "bin", "skillset");
    const argsPath = join(root, "args.txt");
    await mkdir(dirname(productManifest), { recursive: true });
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      productManifest,
      `${JSON.stringify({ name: "skillset", version: "1.2.3" })}\n`
    );
    await writeFile(
      nativeManifest,
      `${JSON.stringify({
        name: "@skillset/native-darwin-arm64",
        version: "1.2.3",
      })}\n`
    );
    await writeFile(
      executable,
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsPath}'\nexit 7\n`
    );
    await chmod(executable, 0o755);

    const result = await executeLauncher(["lookup", "workspace", "--json"], {
      packageJsonPath: productManifest,
      resolvePackage: () => nativeManifest,
      runtime: { arch: "arm64", libc: "unknown", platform: "darwin" },
    });
    expect(result).toEqual({ code: 7, signal: null });
    expect(await readFile(argsPath, "utf8")).toBe(
      "lookup\nworkspace\n--json\n"
    );
  });

  test("inherits stdin, stdout, and stderr without translation", async () => {
    if (process.platform === "win32") return;
    const node = Bun.which("node");
    if (!node) throw new Error("Launcher stdio test requires Node");
    const root = await temporaryRoot();
    const distribution = selectNativeDistribution({
      arch: process.arch,
      libc: process.platform === "linux" ? "glibc" : "unknown",
      platform: process.platform,
    });
    const packageRoot = join(
      root,
      "node_modules",
      ...distribution.npmPackage.split("/")
    );
    const executable = join(packageRoot, "bin", distribution.executable);
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: distribution.npmPackage,
        version: "0.22.1",
      })}\n`
    );
    await writeFile(
      executable,
      "#!/bin/sh\nIFS= read -r line\nprintf 'out:%s\\n' \"$line\"\nprintf 'err:%s\\n' \"$line\" >&2\n"
    );
    await chmod(executable, 0o755);
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({
        name: "skillset",
        type: "module",
        version: "0.22.1",
      })}\n`
    );
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "..", "launcher.ts")],
      naming: { entry: "cli.js" },
      outdir: join(root, "dist"),
      target: "node",
    });
    expect(build.success).toBe(true);
    const launcher = Bun.spawn([node, join(root, "dist", "cli.js")], {
      env: { ...process.env, NODE_PATH: join(root, "node_modules") },
      stdin: "pipe",
      stderr: "pipe",
      stdout: "pipe",
    });
    launcher.stdin.write("hello launcher\n");
    launcher.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(launcher.stdout).text(),
      new Response(launcher.stderr).text(),
      launcher.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("out:hello launcher\n");
    expect(stderr).toBe("err:hello launcher\n");
  });

  test("uses finite launcher errors without exposing implementation stacks", () => {
    expect(new SkillsetLauncherError("problem").name).toBe(
      "SkillsetLauncherError"
    );
  });

  test("forwards termination signals to the native process", async () => {
    if (process.platform === "win32") return;
    const node = Bun.which("node");
    if (!node) throw new Error("Launcher signal test requires Node");
    const root = await temporaryRoot();
    const distribution = selectNativeDistribution({
      arch: process.arch,
      libc: process.platform === "linux" ? "glibc" : "unknown",
      platform: process.platform,
    });
    const packageRoot = join(
      root,
      "node_modules",
      ...distribution.npmPackage.split("/")
    );
    const executable = join(packageRoot, "bin", distribution.executable);
    const ready = join(root, "ready");
    const interrupted = join(root, "interrupted");
    const terminated = join(root, "terminated");
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: distribution.npmPackage,
        version: "0.22.1",
      })}\n`
    );
    await writeFile(
      executable,
      `#!/bin/sh\ntrap 'printf interrupted > "${interrupted}"' INT\ntrap 'printf terminated > "${terminated}"; exit 42' TERM\nprintf ready > "${ready}"\nwhile :; do sleep 1; done\n`
    );
    await chmod(executable, 0o755);
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({
        name: "skillset",
        type: "module",
        version: "0.22.1",
      })}\n`
    );
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "..", "launcher.ts")],
      naming: { entry: "cli.js" },
      outdir: join(root, "dist"),
      target: "node",
    });
    expect(build.success).toBe(true);
    const launcher = Bun.spawn([node, join(root, "dist", "cli.js")], {
      env: { ...process.env, NODE_PATH: join(root, "node_modules") },
      stderr: "pipe",
      stdout: "pipe",
    });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (
        await access(ready).then(
          () => true,
          () => false
        )
      )
        break;
      await Bun.sleep(25);
    }
    expect(
      await access(ready).then(
        () => true,
        () => false
      )
    ).toBe(true);
    process.kill(launcher.pid, "SIGINT");
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (
        await access(interrupted).then(
          () => true,
          () => false
        )
      )
        break;
      await Bun.sleep(25);
    }
    expect(
      await access(interrupted).then(
        () => true,
        () => false
      )
    ).toBe(true);
    process.kill(launcher.pid, "SIGTERM");
    expect(await launcher.exited).toBe(42);
    expect(await readFile(terminated, "utf8")).toBe("terminated");
  }, 10_000);
});
