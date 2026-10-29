import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildSkillset } from "@skillset/core";

import { ciSkillset, renderCiReportMarkdown } from "../ci";
import {
  commitFixture,
  contractFixture,
  runSkillsetCli,
} from "./contract-test-helpers";

const SKILL = ".claude/skills/demo/SKILL.md";
const ASSET = ".claude/skills/demo/assets/schema.json";

test("check labels formatter-only files without counting edits or provider updates", async () => {
  const root = await formattingFixture();
  await writeFile(
    join(root, ASSET),
    '{\n  "type": "object",\n  "required": ["a"]\n}\n'
  );

  const report = await ciSkillset(root);
  expect(report.ok).toBe(false);
  expect(report.layoutOnlyDriftPaths).toEqual([SKILL, ASSET]);
  expect(report.outputEditedPaths).toEqual(
    expect.arrayContaining([SKILL, ASSET])
  );
  expect(report.providerUpdatePaths).toEqual([]);
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Generated layout differences");
  expect(markdown).not.toContain("### Target-side generated edits");
  expect(markdown).not.toContain("### Provider-format updates");

  const result = await runSkillsetCli("check", "--root", root);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("2 generated file(s) differ only in layout");
  expect(result.stdout).not.toContain("target-side generated edit");
  expect(result.stdout).not.toContain("provider-format update");
  expect(result.stdout).toContain("next: skillset build --yes");
  expect(await readFile(join(root, ASSET), "utf8")).toBe(
    '{\n  "type": "object",\n  "required": ["a"]\n}\n'
  );
});

test("check keeps semantic edits visible beside a formatter-only file", async () => {
  const root = await formattingFixture();
  await writeFile(
    join(root, ASSET),
    '{"type":"object","required":["changed"]}\n'
  );

  const report = await ciSkillset(root);
  expect(report.layoutOnlyDriftPaths).toEqual([SKILL]);
  expect(report.providerUpdatePaths).toContain(ASSET);
  const result = await runSkillsetCli("check", "--root", root);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("1 generated file(s) differ only in layout");
  expect(result.stdout).toContain("1 target-side generated edit(s)");
  expect(result.stdout).toContain("1 provider-format update(s)");
  expect(result.stdout).toContain(`target-side generated edit ${ASSET}`);
  expect(result.stdout).not.toContain(`target-side generated edit ${SKILL}`);
});

async function formattingFixture(): Promise<string> {
  const root = await contractFixture({
    "skillset.yaml":
      "skillset:\n  name: formatting-summary\nclaude: true\ncodex: false\ncursor: false\n",
    ".skillset/skills/demo/SKILL.md":
      "---\nname: demo\ndescription: Demo.\n---\n\nA paragraph that a formatter would rewrap.\n",
    ".skillset/skills/demo/assets/schema.json":
      '{"type":"object","required":["a"]}\n',
  });
  await commitFixture(root);
  await buildSkillset(root);
  const path = join(root, SKILL);
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(
      "formatter would",
      "formatter\nwould"
    )
  );
  return root;
}
