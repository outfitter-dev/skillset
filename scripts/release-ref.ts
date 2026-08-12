import { join } from "node:path";

import { RELEASE_PACKAGE_SPECS } from "./release-packages";

export const RELEASE_MANIFEST_PATHS = RELEASE_PACKAGE_SPECS.map((spec) =>
  join(spec.directory, "package.json")
);

async function captureResult(
  command: readonly string[],
  cwd: string
): Promise<{ readonly exitCode: number; readonly output: string }> {
  const subprocess = Bun.spawn([...command], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}${stderr}`.trim() };
}

async function capture(
  command: readonly string[],
  cwd: string
): Promise<string> {
  const result = await captureResult(command, cwd);
  if (result.exitCode !== 0)
    throw new Error(`${command.join(" ")} failed:\n${result.output}`);
  return result.output;
}

export function assertReleaseManifestVersions(
  manifests: Readonly<Record<string, unknown>>,
  version: string
): void {
  const actualPaths = Object.keys(manifests).sort();
  const expectedPaths = [...RELEASE_MANIFEST_PATHS].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      `Release version commit must contain exactly ${expectedPaths.join(", ")}`
    );
  }
  for (const path of RELEASE_MANIFEST_PATHS) {
    const manifest = manifests[path];
    if (
      !manifest ||
      typeof manifest !== "object" ||
      (manifest as { version?: unknown }).version !== version
    ) {
      throw new Error(
        `${path} is not version ${version} at the release commit`
      );
    }
  }
}

export async function resolveReleaseVersionCommit(
  rootPath: string,
  version: string
): Promise<string> {
  const launcherManifest = RELEASE_MANIFEST_PATHS.at(-1)!;
  const history = await capture(
    ["git", "log", "--reverse", "--format=%H", "--", launcherManifest],
    rootPath
  );
  for (const commit of history.split("\n").filter(Boolean)) {
    if (!/^[0-9a-f]{40}$/.test(commit)) continue;
    const manifests: Record<string, unknown> = {};
    let complete = true;
    for (const path of RELEASE_MANIFEST_PATHS) {
      const result = await captureResult(
        ["git", "show", `${commit}:${path}`],
        rootPath
      );
      if (result.exitCode !== 0) {
        complete = false;
        break;
      }
      manifests[path] = JSON.parse(result.output) as unknown;
    }
    if (!complete) continue;
    try {
      assertReleaseManifestVersions(manifests, version);
      return commit;
    } catch {
      // Continue until all seven manifests first share the requested version.
    }
  }
  throw new Error(
    `Could not resolve a commit where all seven release manifests are version ${version}`
  );
}
