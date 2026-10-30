import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2]!);
const destination = resolve(process.argv[3]!);
const { parseExternalManifest, runSelectedExternalFixtures } = await import(join(root, "scripts/fixtures/external.ts"));
const { createOperationalPathContext, resolveOperationalPath } = await import(join(root, "packages/core/src/operational-cache.ts"));
const { loadBuildGraph } = await import(join(root, "packages/core/src/resolver.ts"));
const { gitSafeEnv } = await import(join(root, "apps/skillset/src/git-env.ts"));
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, env: gitSafeEnv() });
if (revision.exitCode !== 0) throw new Error("Cannot identify inspected code");
const manifest = await readFile(join(root, "fixtures/external/repos.yaml"), "utf8");
const entries = parseExternalManifest(manifest, "pinned external cohort");
const manifestSha256 = createHash("sha256").update(manifest).digest("hex");
await mkdir(destination, { recursive: true });
const results = await runSelectedExternalFixtures({ rootPath: root, entries, manifestEntryCount: entries.length, manifestSha256 });
for (const { entry, report } of results) {
  const dir = join(destination, entry.name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "raw-report.json"), JSON.stringify({ entry, report }, null, 2) + "\n");
  const fixtureRoot = join(root, "fixtures/external/repos", entry.name);
  const original = Bun.spawnSync(["git", "archive", entry.ref], { cwd: fixtureRoot, env: gitSafeEnv() });
  if (original.exitCode !== 0) throw new Error(`Cannot preserve pinned original ${entry.name}`);
  await writeFile(join(dir, "original.tar"), original.stdout);
  const status = Bun.spawnSync(["git", "status", "--porcelain=v1", "--untracked-files=all"], { cwd: fixtureRoot, env: gitSafeEnv() });
  if (status.exitCode !== 0) throw new Error(`Cannot inventory source ${entry.name}`);
  await writeFile(join(dir, "source-status.txt"), status.stdout);
  for (const path of [".skillset", "skillset.yaml"]) {
    try { await cp(join(fixtureRoot, path), join(dir, "adopted", path), { recursive: true }); }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  }
  for (const [index, projection] of report.roundTrips.entries()) {
    const cloneRoot = join(root, "fixtures/external/repos", entry.name);
    const graph = await loadBuildGraph(cloneRoot);
    const context = createOperationalPathContext(cloneRoot, { workspaceCacheKey: graph.root.workspace.cacheKey });
    await cp(resolveOperationalPath(context, projection.generatedRoot), join(dir, `projection-${index}`), { recursive: true });
  }
}
await writeFile(join(destination, "provenance.json"), JSON.stringify({ codeSHA: revision.stdout.toString().trim(), manifestSha256, entries, bun: Bun.version }, null, 2) + "\n");
console.log(`Captured ${results.length} pinned fixture reports and available generated projections at ${destination}`);
