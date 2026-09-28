import { describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
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

/** The Windows-form profile a native win32 process reports as USERPROFILE. */
const windowsProfile = String.raw`C:\Users\skillset`;

interface HostEnvironment {
  /** Where the cached interpreter lives: `$HOME`, or the native profile. */
  readonly cacheUnder?: "home" | "profile";
  /** Export USERPROFILE, as Windows does for every process. */
  readonly userProfile?: boolean;
  /** Provide `cygpath`, which maps USERPROFILE to the profile directory. */
  readonly cygpath?: boolean;
}

/**
 * Run `bootstrap.sh doctor` as `host` would, with a fake `uname`, a cached
 * interpreter only at the resolver's path, and a PATH holding nothing but the
 * fake `uname` (and `cygpath` when asked). The fake interpreter echoes the
 * path it was exec'd from. Under Cygwin, `$HOME` is `/home/<user>` while the
 * native resolver publishes under the Windows profile, so the profile is a
 * directory distinct from the fixture `$HOME`.
 */
const runAsHost = async (
  host: HostCase,
  {
    cacheUnder = "home",
    userProfile = false,
    cygpath = false,
  }: HostEnvironment = {}
) => {
  const root = await createTestFixtureRoot("skillset-bootstrap-layout-");
  const home = join(root, "home");
  const profile = join(root, "profile");
  const fakeBin = join(root, "fake-bin");
  const cached = resolverPath(cacheUnder === "home" ? home : profile, host);
  await Promise.all([
    mkdir(join(root, "scripts"), { recursive: true }),
    mkdir(join(home, ".bun"), { recursive: true }),
    mkdir(profile, { recursive: true }),
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
      cached,
      `#!/bin/sh\nif [ "$1" = --version ]; then echo ${pin}; else printf '%s\\n' "$0"; fi\n`
    ),
    ...(cygpath
      ? [
          writeFile(
            join(fakeBin, "cygpath"),
            `#!/bin/sh\n[ "$1" = -u ] && [ "$2" = '${windowsProfile}' ] && printf '%s\\n' '${profile}'\n`
          ),
        ]
      : []),
  ]);
  await Promise.all([
    chmod(join(fakeBin, "uname"), 0o755),
    chmod(cached, 0o755),
    ...(cygpath ? [chmod(join(fakeBin, "cygpath"), 0o755)] : []),
  ]);
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
      ...(userProfile ? { USERPROFILE: windowsProfile } : {}),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  return { cached, result };
};

const expectExecd = (
  { cached, result }: Awaited<ReturnType<typeof runAsHost>>
): void => {
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe(cached);
};

// The fake `uname` and interpreter are POSIX shell scripts, so this proof of
// the win32 mapping runs on POSIX hosts only.
describe.skipIf(process.platform === "win32")("bootstrap.sh cache layout", () => {
  for (const host of hosts) {
    test(`${host.unameS} ${host.unameM} uses the resolver's ${host.platform}-${host.arch} cache`, async () => {
      expectExecd(await runAsHost(host));
    });
  }

  // os.homedir() on win32 reads USERPROFILE before anything else, so a native
  // Bun publishes under the Windows profile even when the shell's $HOME is
  // elsewhere (Cygwin's /home/<user>).
  for (const host of hosts.filter(({ platform }) => platform === "win32")) {
    test(`${host.unameS} finds the cache under USERPROFILE when $HOME differs`, async () => {
      expectExecd(
        await runAsHost(host, {
          cacheUnder: "profile",
          cygpath: true,
          userProfile: true,
        })
      );
    });
  }

  test("a Windows shell without cygpath falls back to $HOME", async () => {
    const cygwin = hosts.find(({ unameS }) => unameS.startsWith("CYGWIN"));
    if (cygwin === undefined) throw new Error("no Cygwin host case");
    expectExecd(await runAsHost(cygwin, { userProfile: true }));
  });

  test("POSIX hosts ignore USERPROFILE and cygpath", async () => {
    const [linux] = hosts.filter(({ platform }) => platform === "linux");
    if (linux === undefined) throw new Error("no Linux host case");
    expectExecd(await runAsHost(linux, { cygpath: true, userProfile: true }));
  });
});
