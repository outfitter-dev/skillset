import { describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import {
  adoptPinnedBun,
  isTransientSpawnFailure,
  pinnedBunExecutableName,
  pinnedBunxExecutableName,
  pinnedBunRoot,
  pinnedBunRootState,
  resolvePinnedBun,
} from "../pinned-bun";

/**
 * `~/.bun/bin/bun` is a contested path. Every repository whose agent bootstrap
 * installs a pinned Bun writes that same file, and `scripts/test-sandbox.ts`
 * puts the resolved interpreter's directory on `PATH` for a whole run. While
 * resolution returned that directory, a bootstrap starting in another
 * repository could change which interpreter this run's subprocesses got,
 * halfway through a gate. That is observed behaviour, not a hypothesis: a
 * SET-607 timing sample was discarded when the path changed version mid-run.
 *
 * These tests pin the property that prevents it. Adoption takes an explicit
 * source and target because inside the test sandbox the running interpreter is
 * already the cached one, which would make the property vacuously true.
 */
async function temporaryDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `skillset-pinned-bun-${label}-`));
}

/**
 * A stand-in interpreter that reports the version asked of it.
 *
 * POSIX only: on Windows `pinnedBunExecutableName()` names this `bun.exe`, and
 * a shell script under that name cannot be executed directly, so the suites
 * that use it are skipped there rather than asserting something untrue.
 */
async function fakeInterpreter(version: string): Promise<string> {
  const dir = await temporaryDir("ambient");
  const path = join(dir, pinnedBunExecutableName());
  await writeFile(path, `#!/bin/sh\necho "${version}"\n`);
  await chmod(path, 0o755);
  return path;
}

// Skipped on a cold cache: resolving would adopt, writing about 61 MB into the
// contributor's real home, outside the sandbox's XDG containment. Decided at
// module scope so a skip is reported as a skip; returning early from the test
// would record a pass on the machine where the guard never ran.
const cacheIsWarm =
  (await pinnedBunRootState(pinnedBunRoot(Bun.version), Bun.version, "bun")) ===
  "valid";

const posix = process.platform !== "win32";

describe.skipIf(!posix)("adoptPinnedBun", () => {
  test("publishes a copy that is independent of the source path", async () => {
    const version = "9.9.9";
    const source = await fakeInterpreter(version);
    const targetRoot = join(await temporaryDir("cache"), version);

    await adoptPinnedBun(version, targetRoot, source);

    const published = join(targetRoot, "bin", pinnedBunExecutableName());
    const [copy, original] = await Promise.all([
      stat(published),
      stat(await realpath(source)),
    ]);
    // A distinct inode is what makes the cached interpreter immune to later
    // writes at the source name, however the installer performs them.
    expect(copy.ino).not.toBe(original.ino);
    expect(copy.size).toBe(original.size);
    expect(copy.mode & 0o111).not.toBe(0);
  });

  test("the published interpreter reports the adopted version", async () => {
    const version = "9.9.9";
    const source = await fakeInterpreter(version);
    const targetRoot = join(await temporaryDir("cache"), version);

    await adoptPinnedBun(version, targetRoot, source);

    const child = Bun.spawn({
      cmd: [join(targetRoot, "bin", pinnedBunExecutableName()), "--version"],
      stdout: "pipe",
    });
    expect((await new Response(child.stdout).text()).trim()).toBe(version);
    expect(await child.exited).toBe(0);
  });

  test("publishes a bunx beside the interpreter", async () => {
    // `scripts/package-smoke.ts` runs the packed CLI through `bunx`, inside
    // `bun run check`. A cache root holding only `bun` leaves `bunx` to resolve
    // from the rest of PATH, where it is a symlink to the contested
    // ~/.bun/bin/bun this whole change exists to stop depending on.
    const version = "9.9.9";
    const targetRoot = join(await temporaryDir("cache"), version);

    await adoptPinnedBun(version, targetRoot, await fakeInterpreter(version));

    const bunxPath = join(targetRoot, "bin", pinnedBunxExecutableName());
    expect(await Bun.file(bunxPath).exists()).toBe(true);
    const child = Bun.spawn({ cmd: [bunxPath, "--version"], stdout: "pipe" });
    expect((await new Response(child.stdout).text()).trim()).toBe(version);
    expect(await child.exited).toBe(0);
  });

  test("an ambient replacement cannot redirect a running gate's next bun lookup", async () => {
    const version = "9.9.9";
    const source = await fakeInterpreter(version);
    const targetRoot = join(await temporaryDir("cache"), version);
    await adoptPinnedBun(version, targetRoot, source);

    const runRoot = await temporaryDir("run");
    const started = join(runRoot, "started");
    const proceed = join(runRoot, "proceed");
    const child = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        ': > "$STARTED"; while [ ! -e "$PROCEED" ]; do sleep 0.01; done; bun --version',
      ],
      env: {
        ...process.env,
        PATH: [join(targetRoot, "bin"), dirname(source), process.env.PATH]
          .filter(Boolean)
          .join(delimiter),
        PROCEED: proceed,
        STARTED: started,
      },
      stdout: "pipe",
    });
    try {
      const deadline = Date.now() + 5_000;
      while (!(await Bun.file(started).exists()) && Date.now() < deadline) {
        await Bun.sleep(10);
      }
      expect(await Bun.file(started).exists()).toBe(true);
      await writeFile(source, '#!/bin/sh\necho "1.2.3"\n');
    } finally {
      await writeFile(proceed, "");
    }

    expect((await new Response(child.stdout).text()).trim()).toBe(version);
    expect(await child.exited).toBe(0);
  });

  test("republishing an already valid cache root is a no-op", async () => {
    const version = "9.9.9";
    const source = await fakeInterpreter(version);
    const targetRoot = join(await temporaryDir("cache"), version);
    const published = join(targetRoot, "bin", pinnedBunExecutableName());

    await adoptPinnedBun(version, targetRoot, source);
    const first = await stat(published);
    await adoptPinnedBun(version, targetRoot, source);
    const second = await stat(published);

    expect(second.ino).toBe(first.ino);
  });

  test("refuses a source that does not report the requested version", async () => {
    const source = await fakeInterpreter("1.2.3");
    const targetRoot = join(await temporaryDir("cache"), "9.9.9");

    await expect(
      adoptPinnedBun("9.9.9", targetRoot, source)
    ).rejects.toThrow(/does not report bun-v9\.9\.9/u);
  });
});

describe.skipIf(!posix)("pinnedBunRootState", () => {
  test("reports a root holding the requested interpreter as valid", async () => {
    const version = "9.9.9";
    const targetRoot = join(await temporaryDir("cache"), version);
    await adoptPinnedBun(version, targetRoot, await fakeInterpreter(version));

    expect(await pinnedBunRootState(targetRoot, version, "bun")).toBe("valid");
  });

  test("reports a root holding a different interpreter as invalid", async () => {
    const targetRoot = join(await temporaryDir("cache"), "9.9.9");
    await adoptPinnedBun("1.2.3", targetRoot, await fakeInterpreter("1.2.3"));

    expect(await pinnedBunRootState(targetRoot, "9.9.9", "bun")).toBe("invalid");
  });

  test("reports a corrupt interpreter as invalid, so it is replaced", async () => {
    // An interrupted install leaves a file that cannot be executed. That is a
    // real answer about the file and SET-604 requires publication to replace
    // it; only the host running out of capacity is treated as "ask again".
    const targetRoot = join(await temporaryDir("cache"), "9.9.9");
    const binDir = join(targetRoot, "bin");
    await mkdir(binDir, { recursive: true });
    const binPath = join(binDir, "bun");
    await writeFile(binPath, "not an executable\n");
    await chmod(binPath, 0o755);

    expect(await pinnedBunRootState(targetRoot, "9.9.9", "bun")).toBe("invalid");
  });
});

describe("resolvePinnedBun", () => {
  test.skipIf(!cacheIsWarm)(
    "resolves inside the version-scoped cache, never an ambient directory",
    async () => {
    const cacheRoot = pinnedBunRoot(Bun.version);
    const repoRoot = await temporaryDir("repo");
    await writeFile(join(repoRoot, ".bun-version"), `${Bun.version}\n`);

    const resolved = await resolvePinnedBun(repoRoot);

    // Structural guard against reintroducing a branch that hands back
    // whichever directory the ambient interpreter happened to occupy.
    expect(resolved.version).toBe(Bun.version);
    expect(resolved.binDir).toBe(join(cacheRoot, "bin"));
    expect(dirname(resolved.binPath)).toBe(resolved.binDir);
    }
  );
});

describe("isTransientSpawnFailure", () => {
  test("treats momentary host conditions as retryable", () => {
    // ETXTBSY is the reason this classification exists: it is what exec
    // returns while another process is still writing the file, which is this
    // cache's own publication window.
    for (const code of ["EAGAIN", "EBUSY", "EMFILE", "ENFILE", "ENOMEM", "ETXTBSY"]) {
      expect(isTransientSpawnFailure(Object.assign(new Error(code), { code }))).toBe(
        true
      );
    }
  });

  test("treats a verdict about the file itself as final", () => {
    for (const code of ["ENOEXEC", "EACCES", "ENOENT", "EPERM"]) {
      expect(isTransientSpawnFailure(Object.assign(new Error(code), { code }))).toBe(
        false
      );
    }
    expect(isTransientSpawnFailure(new Error("no code"))).toBe(false);
    expect(isTransientSpawnFailure(undefined)).toBe(false);
  });
});
