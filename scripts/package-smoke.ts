import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const cliPackageDir = join(rootDir, "apps", "cli");
const productManifest = await Bun.file(
  join(rootDir, "apps", "skillset", "package.json")
).json();
const cliManifest = await Bun.file(join(cliPackageDir, "package.json")).json();

if (productManifest.version !== cliManifest.version) {
  throw new Error(
    `Public package version drift: skillset@${productManifest.version} != @skillset/cli@${cliManifest.version}`
  );
}

const smokeDir = await mkdtemp(join(tmpdir(), "skillset-cli-pack-"));
try {
  await run(
    [
      "bun",
      "pm",
      "pack",
      "--destination",
      smokeDir,
      "--quiet",
      "--ignore-scripts",
    ],
    cliPackageDir
  );
  const tarballs = (await readdir(smokeDir)).filter((path) =>
    path.endsWith(".tgz")
  );
  if (tarballs.length !== 1 || !tarballs[0]) {
    throw new Error(
      `Expected one @skillset/cli tarball, found ${tarballs.length}`
    );
  }
  const tarball = join(smokeDir, tarballs[0]);
  const help = await run(
    ["bunx", "--package", tarball, "skillset", "--help"],
    smokeDir
  );
  if (!help.stdout.startsWith("Skillset\n")) {
    throw new Error("Packed @skillset/cli --help did not render root help");
  }
  const version = await run(
    ["bunx", "--package", tarball, "skillset", "--version"],
    smokeDir
  );
  if (version.stdout.trim() !== productManifest.version) {
    throw new Error(
      `Packed @skillset/cli reported ${version.stdout.trim()}, expected ${productManifest.version}`
    );
  }
  const bunInstall = join(smokeDir, "bun-global");
  await mkdir(bunInstall, { recursive: true });
  const bunGlobalEnv = { ...process.env, BUN_INSTALL: bunInstall };
  await run(["bun", "add", "--global", tarball], smokeDir, bunGlobalEnv);
  const globalVersion = await run(
    [
      join(
        bunInstall,
        "bin",
        process.platform === "win32" ? "skillset.exe" : "skillset"
      ),
      "--version",
    ],
    smokeDir,
    bunGlobalEnv
  );
  if (globalVersion.stdout.trim() !== productManifest.version) {
    throw new Error(
      `Bun-global @skillset/cli reported ${globalVersion.stdout.trim()}, expected ${productManifest.version}`
    );
  }
  console.error(
    `skillset: packed @skillset/cli resolves bunx and isolated Bun-global skillset bins; --help and --version ${productManifest.version} pass`
  );
} finally {
  await rm(smokeDir, { force: true, recursive: true });
}

async function run(
  command: readonly string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env
) {
  const process = Bun.spawn(command, {
    cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${exitCode}):\n${stderr || stdout}`
    );
  }
  return { stderr, stdout };
}
