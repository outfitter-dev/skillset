import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { collectCliSurfaceViolations } from "../cli-surface-guard";
import { createTestGitFixtureRoot, initializeTestGitRepository, runTestGit } from "../test-helpers/git-remote";
import { scanSkillFamilyCli } from "../skill-family-cli";

const file = ".skillset/plugins/skillset/shared/references/commands.md";
const scan = (text: string) => scanSkillFamilyCli(file, text);

test("SET-458: detects nonexistent command and flag references with source lines", () => {
  expect(scan("# Commands\n`skillset nonexistent`\n`skillset build --not-a-flag`")).toEqual([
    { file, line: 2, text: "unknown CLI command: nonexistent" },
    { file, line: 3, text: "unknown CLI flag: --not-a-flag" },
  ]);
});

test("SET-458: scans shell fences, skips other languages and prose", () => {
  expect(scan("```sh\nskillset missing\n```\n```ts\nskillset missing\n```\nskillset missing")).toHaveLength(1);
  expect(scan("`npm install --global` `git --unknown` `some-skillset missing` `$skillset missing` `skillset`")).toEqual([]);
});

test("SET-458: respects argument values, placeholders and shell boundaries", () => {
  for (const command of [
    "skillset build --yes --root .", "skillset --version", "skillset change add",
    "skillset lookup hooks --events", "skillset new skill\\|plugin",
    "skillset build [--from <provider>]", "skillset <command> --unknown",
    "skillset build --root '--not-a-flag'", "skillset build --root=--not-a-flag",
    "skillset build # --unknown", "skillset build; echo --unknown",
    "skillset test -- --unknown", "skillset test '$dynamic --unknown'",
  ]) expect(scan(`\`${command}\``)).toEqual([]);
});

test("SET-458: contract removal fails without a retired-token blacklist", () => {
  expect(scanSkillFamilyCli(file, "`skillset build --yes`", { commands: [], flags: {} })).toHaveLength(1);
  expect(scanSkillFamilyCli(file, "`skillset build --yes`", { commands: ["build"], flags: {} })).toEqual([
    { file, line: 1, text: "unknown CLI flag: --yes" },
  ]);
});

test("SET-458: covers canonical family only", () => {
  for (const path of [".skillset/skills/skillset-dev/SKILL.md", file]) {
    expect(scanSkillFamilyCli(path, "`skillset nonexistent`")).toHaveLength(1);
  }
  for (const path of ["plugins/skillset/skills/skillset/SKILL.md", ".skillset/skills/unrelated/SKILL.md"]) {
    expect(scanSkillFamilyCli(path, "`skillset nonexistent`")).toEqual([]);
  }
});

test("SET-458: CI collector rejects a staged new shared-reference fixture", async () => {
  const root = await createTestGitFixtureRoot("skillset-family-cli-");
  const repo = join(root, "repo");
  await mkdir(repo);
  await Bun.write(join(repo, "README.md"), "Fixture\n");
  await initializeTestGitRepository(repo, { disposableRoot: root });
  await mkdir(join(repo, ".skillset/plugins/skillset/shared/references"), { recursive: true });
  await Bun.write(join(repo, file), "`skillset build --synthetic-missing`\n");
  expect(await collectCliSurfaceViolations(repo)).toEqual([]);
  await runTestGit(repo, "add", file);
  expect(await collectCliSurfaceViolations(repo)).toEqual([
    { file, line: 1, text: "unknown CLI flag: --synthetic-missing" },
  ]);
});

test("SET-458: continuations and mismatched fence delimiters retain shell context", () => {
  expect(scan("~~~bash\nskillset build \\\n  --missing\n```\n~~~")).toEqual([
    { file, line: 2, text: "unknown CLI flag: --missing" },
  ]);
  expect(scan("`bun ./apps/skillset/src/cli.ts build --missing`")).toHaveLength(1);
});

test("SET-458: root flags also use the shared vocabulary", () => {
  expect(scan("`skillset --missing`")).toEqual([{ file, line: 1, text: "unknown CLI flag: --missing" }]);
  expect(scan("`skillset --help` `skillset --version`")).toEqual([]);
});
