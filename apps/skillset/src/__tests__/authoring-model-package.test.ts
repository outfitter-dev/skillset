import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillsetResult } from "@skillset/core";
import { explainPath } from "@skillset/core/internal/authoring";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("SET-558: grouped source projects into one provider-adjacent package", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-authoring-package-"));
  roots.push(root);
  await cp(join(process.cwd(), "fixtures/authoring-model"), root, { recursive: true });

  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  const paths = result.data.map((file) => file.path);
  expect(paths).toEqual(expect.arrayContaining([
    "plugins/mg-skills/plugin.json",
    "plugins/mg-skills/.claude-plugin/plugin.json",
    "plugins/mg-skills/.cursor-plugin/plugin.json",
    "plugins/mg-skills/skills/tdd/SKILL.md",
    "plugins/mg-skills/skills/proofread/SKILL.md",
    "plugins/mg-skills/skills/package-proof/SKILL.md",
    "plugins/mg-skills/assets/logo.png",
  ]));
  expect(paths.some((path) => /plugins\/mg-skills\/(?:chatgpt|claude|cursor)\//u.test(path))).toBe(false);
  expect(paths.some((path) => path.includes("/(engineering)/") || path.includes("/_drafts/"))).toBe(false);

  const manifest = JSON.parse(await readFile(join(root, "plugins/mg-skills/.claude-plugin/plugin.json"), "utf8")) as { skills?: string };
  expect(manifest.skills).toBe("./skills/");
  const explanation = await explainPath(root, "plugins/mg-skills/skills/tdd/SKILL.md");
  expect(explanation).toMatchObject({
    entries: [expect.objectContaining({ outputPath: "plugins/mg-skills/skills/tdd/SKILL.md" })],
    kind: "generated",
  });
});
