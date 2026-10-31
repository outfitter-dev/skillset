import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  collectRulePathQuotingViolations,
  isRulePathDocumentation,
  scanRulePathQuoting,
} from "../rule-path-quoting-guard";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../test-helpers/git-remote";

const scan = (command: string, language = "sh") =>
  scanRulePathQuoting("example.md", `\`\`\`${language}\n${command}\n\`\`\`\n`);
for (const path of [
  "app/[slug]/AGENTS.md",
  "app/(marketing)/AGENTS.md",
  "rules/[.]/test.md",
  "rules/[...]/test.md",
]) {
  test(`rejects unprotected path ${path}`, () => {
    expect(scan(`cat ${path}`)).toEqual([
      expect.objectContaining({ file: "example.md", line: 2 }),
    ]);
    expect(scan(`echo ok && cat --file=${path}`)).toHaveLength(1);
    expect(scan(`cat '${path}'`)).toEqual([]);
  });
}
test("recognizes shell quoting without mistaking prose or other code for commands", () => {
  expect(scan("cat app/'[slug]'/AGENTS.md")).toEqual([]);
  expect(scan("cat app/\\[slug\\]/AGENTS.md")).toEqual([]);
  expect(scan('cat "app/(marketing)/AGENTS.md"', "fish")).toEqual([]);
  expect(scan('const path = "app/[slug]/AGENTS.md";', "typescript")).toEqual(
    []
  );
  expect(
    scanRulePathQuoting(
      "example.md",
      "Use `app/[slug]/AGENTS.md`, then `cat app/[slug]/AGENTS.md`."
    )
  ).toHaveLength(1);
  expect(scan("cat app/[slug]/AGENTS.md # comment")).toHaveLength(1);
  expect(scan("# cat app/[slug]/AGENTS.md")).toEqual([]);
});
test("reports continued command lines and malformed risky quotes", () => {
  expect(scan("cat \\\n app/[slug]/AGENTS.md")[0]?.line).toBe(3);
  expect(scan("cat 'app/[slug]/AGENTS.md")).toHaveLength(1);
  expect(
    scanRulePathQuoting(
      "example.md",
      "```bash\r\ncat app/[slug]/AGENTS.md\r\n```"
    )[0]?.line
  ).toBe(2);
});
test("PowerShell filesystem reads require literal-path semantics", () => {
  expect(scan("Get-Content 'app/[slug]/AGENTS.md'", "powershell")).toHaveLength(
    1
  );
  expect(scan("Get-Content -Path 'app/[slug]/AGENTS.md'", "pwsh")).toHaveLength(
    1
  );
  expect(
    scan("Get-Content -LiteralPath 'app/[slug]/AGENTS.md'", "pwsh")
  ).toEqual([]);
  expect(
    scan("New-Item -ItemType Directory -Path 'app/[slug]'", "pwsh")
  ).toEqual([]);
});

test("shell syntax is not a literal path operand", () => {
  expect(scan("git merge-base HEAD $(scripts/git-trunk.sh)")).toEqual([]);
  expect(scan("paths=('apps/**/*.ts' ':!**/fixtures/**')")).toEqual([]);
  expect(scan("paths=(app/[slug]/file)")).toHaveLength(1);
  expect(scan("cat $(cat app/[slug]/file)")).toHaveLength(1);
});

test("checks tracked and newly staged authored documentation at its owner", async () => {
  const disposableRoot = await createTestGitFixtureRoot("rule-quoting-docs-");
  const root = join(disposableRoot, "work");
  await mkdir(root);
  await writeFile(join(root, "README.md"), "# Example\n");
  await initializeTestGitRepository(root, { disposableRoot });
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, "docs/new.md"),
    "```sh\ncat app/[slug]/AGENTS.md\n```\n"
  );
  await runTestGit(root, "add", "--all");
  expect(await collectRulePathQuotingViolations(root)).toEqual([
    expect.objectContaining({ file: "docs/new.md", line: 2 }),
  ]);
  for (const path of [
    "README.md",
    "docs/reference/source/rules.md",
    ".skillset/plugins/skillset/skills/example/SKILL.md",
  ])
    expect(isRulePathDocumentation(path)).toBe(true);
  for (const path of [
    "AGENTS.md",
    ".agents/skills/example/SKILL.md",
    "plugins/skillset/skills/example/SKILL.md",
    ".changeset/history.md",
  ])
    expect(isRulePathDocumentation(path)).toBe(false);
});

test("PowerShell literal-path permission does not leak across operands or commands", () => {
  expect(
    scan(
      "Get-Content -LiteralPath 'app/[slug]/one'; Get-Content 'app/[slug]/two'",
      "pwsh"
    )
  ).toHaveLength(1);
  expect(
    scan(
      "Get-Content -Path 'app/[slug]/one' -LiteralPath 'app/[slug]/two'",
      "pwsh"
    )
  ).toHaveLength(1);
});
