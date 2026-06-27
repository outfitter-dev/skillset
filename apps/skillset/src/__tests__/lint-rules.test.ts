import { afterAll, expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getSkillsetFeature } from "@skillset/core";
import { lintRules, registerLintRule } from "@skillset/lint";

import { buildSkillset } from "../build";
import { ciSkillset, renderCiReportMarkdown } from "../ci";
import { gitSafeEnv } from "../git-env";
import { inspectSkillset, lintSkillset } from "../lint";
import { loadBuildGraph } from "../resolver";

const WARN_RULE_NAME = "test-warn-marker";

registerLintRule({
  check: (subject) =>
    subject.body.includes("WARN-MARKER")
      ? [
          {
            message: "body contains WARN-MARKER",
            path: subject.path,
            rule: WARN_RULE_NAME,
            severity: "warn",
          },
        ]
      : [],
  description: "Test-only warn rule keyed off a body marker.",
  name: WARN_RULE_NAME,
  severity: "warn",
});

afterAll(() => {
  lintRules.delete(WARN_RULE_NAME);
});

test("lintSkillset throws on an error-severity rule violation", async () => {
  const root = await fixture({
    "skillset.yaml":
      "skillset:\n  name: lint-root\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md":
      "---\nname: other\ndescription: Demo.\n---\n\nBody.\n",
  });

  await expect(lintSkillset(root)).rejects.toThrow(
    "skill-name-directory-mismatch"
  );
  await expect(lintSkillset(root)).rejects.toThrow(
    "frontmatter name other does not match skill directory demo"
  );
});

test("lintSkillset throws on a shell-safety pre-resolution violation", async () => {
  const root = await fixture({
    "skillset.yaml":
      "skillset:\n  name: lint-root\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md":
      '---\nname: demo\ndescription: Demo.\n---\n\n!`[ -n "$x" ] && echo yes || echo no`\n',
  });

  await expect(lintSkillset(root)).rejects.toThrow(
    "skill-preresolve-mixed-and-or"
  );
  await expect(lintSkillset(root)).rejects.toThrow(
    "mixes `&&` and `||` at the same depth"
  );
});

test("lint diagnostics carry feature ids for standalone and plugin skills", async () => {
  const root = await fixture({
    "skillset.yaml":
      "skillset:\n  name: lint-root\nclaude: true\ncodex: false\n",
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ".skillset/plugins/demo/skills/plugin-skill/SKILL.md":
      "---\nname: other-plugin\ndescription: Demo.\n---\n\nBody.\n",
    ".skillset/skills/solo/SKILL.md":
      "---\nname: other-solo\ndescription: Demo.\n---\n\nBody.\n",
  });

  const result = await inspectSkillset(await loadBuildGraph(root));

  expect(result.issues).toContainEqual(expect.objectContaining({
    code: "skill-name-directory-mismatch",
    featureId: "plugin-skills",
    path: ".skillset/plugins/demo/skills/plugin-skill/SKILL.md",
  }));
  expect(result.issues).toContainEqual(expect.objectContaining({
    code: "skill-name-directory-mismatch",
    featureId: "standalone-skills",
    path: ".skillset/skills/solo/SKILL.md",
  }));
  for (const issue of result.issues) {
    if (issue.featureId !== undefined) {
      expect(getSkillsetFeature(issue.featureId)?.id).toBe(issue.featureId);
    }
  }
});

test("ci reports env-var fallback warnings without failing", async () => {
  const root = await fixture({
    "skillset.yaml":
      "skillset:\n  name: lint-root\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md":
      "---\nname: demo\ndescription: Demo.\n---\n\nRun python3 ${CLAUDE_PLUGIN_ROOT}/scripts/setup.py first.\n",
  });
  await commitFixture(root);
  await buildSkillset(root);

  const report = await ciSkillset(root, { since: "HEAD" });

  expect(report.ok).toBe(true);
  expect(
    report.lintIssues.some(
      (issue) =>
        issue.code === "skill-env-var-no-fallback" &&
        issue.featureId === "standalone-skills" &&
        issue.severity === "warn"
    )
  ).toBe(true);
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Lint warnings");
  expect(markdown).toContain("${CLAUDE_PLUGIN_ROOT}");
});

test("lintSkillset returns warn-only issues without throwing", async () => {
  const root = await fixture({
    "skillset.yaml":
      "skillset:\n  name: lint-root\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md":
      "---\nname: demo\ndescription: Demo.\n---\n\nBody with WARN-MARKER.\n",
  });

  const result = await lintSkillset(root);

  expect(result.checkedSkills).toBe(1);
  expect(result.issues).toEqual([
    {
      code: WARN_RULE_NAME,
      featureId: "standalone-skills",
      message: "body contains WARN-MARKER",
      path: ".skillset/skills/demo/SKILL.md",
      severity: "warn",
    },
  ]);
});

test("ci reports lint warnings without failing", async () => {
  const root = await fixture({
    "skillset.yaml":
      "skillset:\n  name: lint-root\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md":
      "---\nname: demo\ndescription: Demo.\n---\n\nBody with WARN-MARKER.\n",
  });
  await commitFixture(root);
  await buildSkillset(root);

  const report = await ciSkillset(root, { since: "HEAD" });

  expect(report.ok).toBe(true);
  expect(report.lintIssues).toEqual([
    {
      code: WARN_RULE_NAME,
      featureId: "standalone-skills",
      message: "body contains WARN-MARKER",
      path: ".skillset/skills/demo/SKILL.md",
      severity: "warn",
    },
  ]);
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Lint warnings");
  expect(markdown).not.toContain("### Lint issues");
  expect(markdown).toContain("do not fail CI");
});

test("ci fails on error-severity lint issues", async () => {
  const root = await fixture({
    "skillset.yaml":
      "skillset:\n  name: lint-root\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": `---\nname: demo\ndescription: ${"x".repeat(1030)}\n---\n\nBody.\n`,
  });
  await commitFixture(root);
  await buildSkillset(root);

  const report = await ciSkillset(root, { since: "HEAD" });

  expect(report.ok).toBe(false);
  expect(
    report.lintIssues.some(
      (issue) =>
        issue.code === "skill-description-length" && issue.severity === "error"
    )
  ).toBe(true);
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Lint issues");
  expect(markdown).toContain("1030");
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-lint-rules-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), content);
  }
  return root;
}

async function commitFixture(root: string): Promise<void> {
  await runGit(root, "init", "-q");
  await runGit(root, "config", "user.email", "skillset@example.com");
  await runGit(root, "config", "user.name", "Skillset Test");
  await runGit(root, "add", ".");
  await runGit(root, "commit", "-qm", "baseline");
}

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", root, ...args],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${stdout}${stderr}`);
  }
}
