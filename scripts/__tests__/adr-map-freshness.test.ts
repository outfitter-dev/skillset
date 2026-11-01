import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { gitSafeEnv } from "@skillset/core/internal/git-env";
import { runAdrMap } from "../docs";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import { initializeTestGitRepository } from "../test-helpers/git-remote";

const helper = resolve(import.meta.dir, "../../.skillset/skills/skillset-adrs/scripts/adr.ts");
const roots: string[] = [];
const artifacts = ["docs/adrs/decision-map.json", "docs/adrs/drafts/decision-map.json", "docs/adrs/drafts/README.md"];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const disposableRoot = await createTestFixtureRoot("adr-map-freshness-");
  roots.push(disposableRoot);
  const root = join(disposableRoot, "repo");
  await mkdir(root);
  for (const [path, content] of Object.entries({
    "docs/adrs/0001-base.md": "---\nid: 1\nstatus: accepted\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# ADR-0001: Base\n",
    "docs/adrs/drafts/20260102-next.md": "---\nstatus: draft\ncreated: 2026-01-02\nupdated: 2026-01-02\ndepends_on: [1]\n---\n# ADR: Next\n",
    "docs/guide.md": "# Guide\n",
  })) await Bun.write(join(root, path), content);
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}

async function map(root: string, check = false) {
  const child = Bun.spawn([process.execPath, helper, "map", ...(check ? ["--check"] : [])], {
    cwd: root, env: gitSafeEnv(), stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exitCode, output: stdout + stderr };
}
const snapshot = (root: string) => Promise.all(artifacts.map((path) => readFile(join(root, path), "utf8")));

test("map check accepts regenerated artifacts and detects each missing artifact without writing", async () => {
  const root = await fixture();
  expect((await map(root)).exitCode).toBe(0);
  const expected = await snapshot(root);
  expect((await map(root, true)).exitCode).toBe(0);
  expect(await snapshot(root)).toEqual(expected);
  for (const path of artifacts) {
    await rm(join(root, path));
    const checked = await map(root, true);
    expect(checked.exitCode).toBe(1);
    expect(checked.output).toContain(path);
    expect(await Bun.file(join(root, path)).exists()).toBe(false);
    expect((await map(root)).exitCode).toBe(0);
    expect(await snapshot(root)).toEqual(expected);
  }
});

test("map check detects authored metadata and reference drift without repairing it", async () => {
  const root = await fixture();
  expect((await map(root)).exitCode).toBe(0);
  const before = await snapshot(root);
  await Bun.write(join(root, "docs/guide.md"), "# Guide\nSee adrs/0001-base.md and adrs/drafts/20260102-next.md.\n");
  const adr = join(root, "docs/adrs/0001-base.md");
  await Bun.write(adr, (await readFile(adr, "utf8")).replace("# ADR-0001: Base", "# ADR-0001: Revised Base"));
  const checked = await map(root, true);
  expect(checked.exitCode).toBe(1);
  expect(checked.output).toContain("docs/adrs/decision-map.json");
  expect(checked.output).toContain("docs/adrs/drafts/decision-map.json");
  expect(checked.output).toContain("docs/adrs/drafts/README.md");
  expect(await snapshot(root)).toEqual(before);
  expect((await map(root)).exitCode).toBe(0);
  expect((await map(root, true)).exitCode).toBe(0);
  const after = await snapshot(root);
  expect(after[0]).toContain("Revised Base");
  expect(after[0]).toContain("docs/guide.md");
  expect(after[2]).toContain("Revised Base");
});

test("map check rejects malformed or altered artifacts without rewriting their bytes", async () => {
  const root = await fixture();
  expect((await map(root)).exitCode).toBe(0);
  for (const path of artifacts) {
    await Bun.write(join(root, path), "stale artifact\n");
    const checked = await map(root, true);
    expect(checked.exitCode).toBe(1);
    expect(checked.output).toContain(path);
    expect(await readFile(join(root, path), "utf8")).toBe("stale artifact\n");
    expect((await map(root)).exitCode).toBe(0);
  }
});


test("documentation generation and checks use the same read-only ADR comparison", async () => {
  const root = await fixture();
  await runAdrMap(root);
  await runAdrMap(root, true);
  const path = join(root, artifacts[1]!);
  await Bun.write(path, "stale\n");
  await expect(runAdrMap(root, true)).rejects.toThrow("docs/adrs/drafts/decision-map.json");
  expect(await readFile(path, "utf8")).toBe("stale\n");
  await runAdrMap(root);
  await runAdrMap(root, true);
});

test("map check leaves a missing draft directory absent", async () => {
  const root = await fixture();
  await rm(join(root, "docs/adrs/drafts"), { recursive: true });
  const checked = await map(root, true);
  expect(checked.exitCode).toBe(1);
  expect(checked.output).toContain("docs/adrs/drafts/decision-map.json");
  expect(await Bun.file(join(root, "docs/adrs/drafts/README.md")).exists()).toBe(false);
  await expect(stat(join(root, "docs/adrs/drafts"))).rejects.toMatchObject({ code: "ENOENT" });
});
