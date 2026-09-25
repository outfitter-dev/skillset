import { describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

import { pinnedBunExecutableName, pinnedBunRoot } from "../pinned-bun";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

const repoRoot = join(import.meta.dir, "..", "..");
const pin = "1.4.0";

interface HostCase {
  readonly unameS: string;
  readonly unameM: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
}

const hosts: readonly HostCase[] = [
  { unameS: "Darwin", unameM: "arm64", platform: "darwin", arch: "arm64" },
  { unameS: "Linux", unameM: "x86_64", platform: "linux", arch: "x64" },
  { unameS: "Linux", unameM: "aarch64", platform: "linux", arch: "arm64" },
  {
    unameS: "MINGW64_NT-10.0-26100",
    unameM: "x86_64",
    platform: "win32",
    arch: "x64",
  },
  { unameS: "MSYS_NT-10.0-26100", unameM: "x86_64", platform: "win32", arch: "x64" },
  { unameS: "CYGWIN_NT-10.0", unameM: "x86_64", platform: "win32", arch: "x64" },
];

/**
 * The cached interpreter the TypeScript resolver would publish for `host`,
 * relocated under the fixture home. `pinnedBunRoot` reads the real home, so
 * only its home-relative layout is compared.
 */
const resolverPath = (home: string, host: HostCase): string =>
  join(
    home,
    relative(homedir(), pinnedBunRoot(pin, host.platform, host.arch)),
    "bin",
    pinnedBunExecutableName(host.platform)
  );

/**
 * Run `bootstrap.sh doctor` as `host` would, with a fake `uname`, a cached
 * interpreter only at the resolver's path, and a PATH holding nothing but the
 * fake `uname`. The fake interpreter echoes the path it was exec'd from.
 */
const runAsHost = async (host: HostCase, { linked = false } = {}) => {
  const root = await createTestFixtureRoot("skillset-bootstrap-layout-");
  const home = join(root, "home");
  const fakeBin = join(root, "fake-bin");
  const cached = resolverPath(home, host);
  // `linked` puts the interpreter elsewhere and links the cached path to it.
  const interpreter = linked ? join(root, "elsewhere", "bun") : cached;
  await Promise.all([
    mkdir(dirname(interpreter), { recursive: true }),
    mkdir(join(root, "scripts"), { recursive: true }),
    mkdir(join(home, ".bun"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
    mkdir(dirname(cached), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(
      join(repoRoot, "scripts", "bootstrap.sh"),
      join(root, "scripts", "bootstrap.sh")
    ),
    writeFile(join(root, ".bun-version"), `${pin}\n`),
    writeFile(
      join(fakeBin, "uname"),
      `#!/bin/sh\ncase "$1" in -s) echo '${host.unameS}' ;; -m) echo '${host.unameM}' ;; esac\n`
    ),
    writeFile(
      interpreter,
      `#!/bin/sh\nif [ "$1" = --version ]; then echo ${pin}; else printf '%s\\n' "$0"; fi\n`
    ),
  ]);
  await Promise.all([
    chmod(join(fakeBin, "uname"), 0o755),
    chmod(interpreter, 0o755),
  ]);
  if (linked) await symlink(interpreter, cached);
  const result = Bun.spawnSync({
    cmd: ["/bin/bash", join(root, "scripts", "bootstrap.sh"), "doctor"],
    cwd: root,
    env: {
      BUN_INSTALL: join(home, ".bun"),
      HOME: home,
      // Deliberately constrained, like an agent shim PATH: no /usr/bin, so
      // `tr`, `dirname`, and friends resolve only if bootstrap restores the
      // standard command directories.
      PATH: fakeBin,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  return { cached, result };
};

// The fake `uname` and interpreter are POSIX shell scripts, so this proof of
// the win32 mapping runs on POSIX hosts only.
describe.skipIf(process.platform === "win32")("bootstrap.sh cache layout", () => {
  for (const host of hosts) {
    test(`${host.unameS} ${host.unameM} uses the resolver's ${host.platform}-${host.arch} cache`, async () => {
      const { cached, result } = await runAsHost(host);
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe(cached);
    });
  }

  test("a symlinked cached interpreter is never exec'd", async () => {
    const [host] = hosts;
    if (host === undefined) throw new Error("no host cases");
    const { cached, result } = await runAsHost(host, { linked: true });
    expect(result.stdout.toString()).not.toContain(cached);
    expect(result.stdout.toString()).not.toContain("elsewhere");
  });
});
