import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareTrees, parseExternalManifest, renderExternalManifest, renderRunReportMarkdown, runExternalRepo } from '../external';
import type { ExternalRepoEntry } from '../external';
import { gitSafeEnv } from '../../../src/git-env';

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

test("runExternalRepo adopts a marketplace-shaped repo offline and reports round-trips", async () => {
  const clone = await fixture({
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
  });

  const report = await runExternalRepo("demo-marketplace", clone, ["claude"]);

  expect(report.stages.map((stage) => [stage.stage, stage.ok])).toEqual([
    ["init", true],
    ["import", true],
    ["lint", true],
    ["build", true],
  ]);
  expect(report.ok).toBe(true);
  expect(report.roundTrips).toHaveLength(1);
  const roundTrip = report.roundTrips[0];
  expect(roundTrip?.kind).toBe("plugin");
  expect(roundTrip?.name).toBe("demo");
  expect(roundTrip?.originalRoot).toBe("plugins/demo");
  expect(roundTrip?.generatedRoot).toBe("plugins-claude/plugins/demo");
  expect(roundTrip?.comparison.identical).toContain("commands/hello.md");
  // Generated skill frontmatter gains metadata.version/generated, so the
  // round-trip reports it as different rather than identical.
  expect(roundTrip?.comparison.different).toContain(
    "skills/demo-skill/SKILL.md"
  );

  const markdown = renderRunReportMarkdown(report, {
    ref: SHA,
    repo: "https://github.com/example/demo",
  } satisfies Pick<ExternalRepoEntry, "ref" | "repo">);
  expect(markdown).toContain("# External fixture run: demo-marketplace");
  expect(markdown).toContain("- result: pass");
  expect(markdown).toContain("### plugin demo");
});

test("runExternalRepo fails the run when no import candidates are detected", async () => {
  const clone = await fixture({ "README.md": "# Not adoptable\n" });

  const report = await runExternalRepo("plain-repo", clone, ["claude"]);

  expect(report.ok).toBe(false);
  expect(report.stages[0]).toMatchObject({ ok: false, stage: "init" });
  expect(report.roundTrips).toEqual([]);
  const markdown = renderRunReportMarkdown(report, { ref: SHA, repo: "r" });
  expect(markdown).toContain("- result: fail");
  expect(markdown).toContain("No imported units to compare.");
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-external-test-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), content);
  }
  return root;
}
