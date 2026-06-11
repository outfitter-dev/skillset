import { expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkClonePurity, compareTrees, parseExternalManifest, renderExternalManifest, renderRunReportMarkdown, runExternalRepo } from '../external';
import type { ExternalRepoEntry } from '../external';
import { gitSafeEnv } from '../../../apps/skillset/src/git-env';

const SHA = "4719dc509fdc45656a830e3ed6060f674e206076";

test("manifest parses, defaults targets to claude, and round-trips through render", () => {
  const entries = parseExternalManifest(
    [
      "repos:",
      "  - name: demo",
      "    repo: https://github.com/example/demo",
      `    ref: ${SHA}`,
      '    notes: "A demo repo."',
      "  - name: both-targets",
      "    repo: https://github.com/example/both",
      `    ref: ${SHA}`,
      "    targets: [claude, codex]",
      "",
    ].join("\n"),
    "test manifest"
  );

  expect(entries).toEqual([
    {
      name: "demo",
      notes: "A demo repo.",
      ref: SHA,
      repo: "https://github.com/example/demo",
      targets: ["claude"],
    },
    {
      name: "both-targets",
      ref: SHA,
      repo: "https://github.com/example/both",
      targets: ["claude", "codex"],
    },
  ]);

  const rendered = renderExternalManifest(entries);
  expect(parseExternalManifest(rendered, "re-rendered manifest")).toEqual(
    entries
  );
});

test("manifest rejects short refs, duplicate names, and unknown targets", () => {
  const entry = (overrides: string): string =>
    [
      "repos:",
      "  - name: demo",
      "    repo: https://github.com/example/demo",
      overrides,
      "",
    ].join("\n");

  expect(() => parseExternalManifest(entry("    ref: abc123"), "m")).toThrow(
    "full 40-character commit SHA"
  );
  expect(() =>
    parseExternalManifest(
      `repos:\n  - name: demo\n    repo: r\n    ref: ${SHA}\n  - name: demo\n    repo: r\n    ref: ${SHA}\n`,
      "m"
    )
  ).toThrow("duplicate entry name");
  expect(() =>
    parseExternalManifest(entry(`    ref: ${SHA}\n    targets: [cursor]`), "m")
  ).toThrow("targets must be claude or codex");
  expect(() => parseExternalManifest("repos: {}\n", "m")).toThrow("repos list");
});

test("compareTrees buckets identical, different, and one-sided files", async () => {
  const original = await fixture({
    ".git/HEAD": "ignored\n",
    "changed.md": "left\n",
    "nested/original-only.md": "orig\n",
    "same.md": "same\n",
  });
  const generated = await fixture({
    "changed.md": "right\n",
    "generated-only.lock": "gen\n",
    "same.md": "same\n",
  });

  const comparison = await compareTrees(original, generated);

  expect(comparison.identical).toEqual(["same.md"]);
  expect(comparison.different).toEqual(["changed.md"]);
  expect(comparison.originalOnly).toEqual(["nested/original-only.md"]);
  expect(comparison.generatedOnly).toEqual(["generated-only.lock"]);
});

test("runExternalRepo adopts a marketplace-shaped repo in place and reports round-trips", async () => {
  const clone = await gitFixture(marketplaceFiles());

  const report = await runExternalRepo("demo-marketplace", clone, ["claude"]);

  expect(report.stages.map((stage) => [stage.stage, stage.ok])).toEqual([
    ["init", true],
    ["import", true],
    ["lint", true],
    ["build", true],
    ["purity", true],
  ]);
  expect(report.ok).toBe(true);
  expect(report.roundTrips).toHaveLength(1);
  const roundTrip = report.roundTrips[0];
  expect(roundTrip?.kind).toBe("plugin");
  expect(roundTrip?.name).toBe("demo");
  expect(roundTrip?.originalRoot).toBe("plugins/demo");
  expect(roundTrip?.generatedRoot).toBe(
    ".skillset/build/out/plugins-claude/plugins/demo"
  );
  expect(roundTrip?.comparison.identical).toContain("commands/hello.md");
  // Generated skill frontmatter gains metadata.version/generated, so the
  // round-trip reports it as different rather than identical.
  expect(roundTrip?.comparison.different).toContain(
    "skills/demo-skill/SKILL.md"
  );

  // In-place isolated adoption only ever creates .skillset/; the live tree
  // must not grow a projection root.
  const rootEntries = await readdir(clone);
  expect(rootEntries).not.toContain("plugins-claude");
  expect(rootEntries).toContain(".skillset");

  const markdown = renderRunReportMarkdown(report, {
    ref: SHA,
    repo: "https://github.com/example/demo",
  } satisfies Pick<ExternalRepoEntry, "ref" | "repo">);
  expect(markdown).toContain("# External fixture run: demo-marketplace");
  expect(markdown).toContain("- result: pass");
  expect(markdown).toContain("### plugin demo");
});

test("runExternalRepo passes when re-run on the same clone", async () => {
  const clone = await gitFixture(marketplaceFiles());

  const first = await runExternalRepo("demo-marketplace", clone, ["claude"]);
  expect(first.ok).toBe(true);

  // The run-start guarded clean drops the previous run's untracked .skillset/
  // adoption, so import does not trip over its own prior output.
  const second = await runExternalRepo("demo-marketplace", clone, ["claude"]);
  expect(second.ok).toBe(true);
  expect(
    second.stages.map((stage) => [stage.stage, stage.ok])
  ).toEqual([
    ["init", true],
    ["import", true],
    ["lint", true],
    ["build", true],
    ["purity", true],
  ]);
});

test("runExternalRepo refuses to clean a clone that tracks .skillset files", async () => {
  const clone = await gitFixture({
    ...marketplaceFiles(),
    ".skillset/config.yaml": "skillset:\n  name: tracked\n",
  });

  await expect(
    runExternalRepo("demo-marketplace", clone, ["claude"])
  ).rejects.toThrow("tracked .skillset files; refusing to clean");
});

test("runExternalRepo fails the run when no import candidates are detected", async () => {
  const clone = await gitFixture({ "README.md": "# Not adoptable\n" });

  const report = await runExternalRepo("plain-repo", clone, ["claude"]);

  expect(report.ok).toBe(false);
  expect(report.stages[0]).toMatchObject({ ok: false, stage: "init" });
  expect(report.roundTrips).toEqual([]);
  const markdown = renderRunReportMarkdown(report, { ref: SHA, repo: "r" });
  expect(markdown).toContain("- result: fail");
  expect(markdown).toContain("No imported units to compare.");
});

test("checkClonePurity accepts .skillset/ additions and flags anything else", async () => {
  const clone = await gitFixture({ "README.md": "# Repo\n" });

  expect(await checkClonePurity(clone)).toEqual({ dirtyPaths: [], ok: true });

  await Bun.write(join(clone, ".skillset/config.yaml"), "skillset:\n");
  await Bun.write(join(clone, ".skillset/build/out/AGENTS.md"), "generated\n");
  expect(await checkClonePurity(clone)).toEqual({ dirtyPaths: [], ok: true });

  await Bun.write(join(clone, "stray.lock"), "dirty\n");
  expect(await checkClonePurity(clone)).toEqual({
    dirtyPaths: ["stray.lock"],
    ok: false,
  });
});

function marketplaceFiles(): Record<string, string> {
  return {
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "demo-marketplace",
      plugins: [{ name: "demo", source: "./plugins/demo" }],
    }),
    "README.md": "# Demo repo\n",
    "plugins/demo/.claude-plugin/plugin.json": JSON.stringify({
      name: "demo",
      version: "1.0.0",
    }),
    "plugins/demo/commands/hello.md":
      "---\ndescription: Say hello.\n---\n\nSay hello.\n",
    "plugins/demo/skills/demo-skill/SKILL.md":
      "---\nname: demo-skill\ndescription: Demo skill.\n---\n\nBody.\n",
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-external-test-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), content);
  }
  return root;
}

/** A fixture that is also a git repo with everything committed, so the
 * harness's git-backed clean and purity stages can run against it. */
async function gitFixture(files: Record<string, string>): Promise<string> {
  const root = await fixture(files);
  await testGit(root, "init", "-q");
  await testGit(root, "add", "-A");
  await testGit(
    root,
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Skillset Test",
    "commit",
    "-q",
    "-m",
    "fixture"
  );
  return root;
}

async function testGit(cwd: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}\n${stderr}`.trim());
  }
}
