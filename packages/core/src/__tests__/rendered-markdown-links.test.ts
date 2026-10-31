import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { TARGET_NAMES } from "@skillset/schema";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, diffSkillsetResult } from "../build";
import { assertRenderedMarkdownLinks } from "../rendered-markdown-links";
import type { LockRoot } from "../render-support";
import { lintSkillset } from "../lint";
import { loadBuildGraph } from "../resolver";
import { renderStandardProjectionBuildGraph } from "../render";

async function fixture(body: string, resources = "", plugin = false): Promise<string> {
  const root = await createTestFixtureRoot("rendered-markdown-links-");
  await Bun.write(join(root, "skillset.yaml"), `skillset:\n  name: links\ncompile:\n  targets: ${JSON.stringify(TARGET_NAMES)}\n`);
  const base = plugin ? ".skillset/plugins/demo/skills/demo" : ".skillset/skills/demo";
  if (plugin) await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n");
  await Bun.write(join(root, base, "SKILL.md"), `---\nname: demo\ndescription: Explain distribution links.\n${resources}---\n\n${body}\n`);
  await Bun.write(join(root, ".skillset/shared/references/guide.md"), "# Guide\n");
  return root;
}

for (const plugin of [false, true]) {
  test(`SET-627: source-side existence cannot satisfy an omitted bundle link (plugin=${plugin})`, async () => {
    const root = await fixture("[guide](references/guide.md)", "", plugin);
    expect((await lintSkillset(root)).issues.filter(issue => issue.severity === "error")).toEqual([]);
    await expect(buildSkillsetResult(root)).rejects.toThrow(/bundle.*references\/guide\.md/);
    expect(await Bun.file(join(root, ".agents/skills/demo/SKILL.md")).exists()).toBe(false);
    expect(await Bun.file(join(root, "plugins/demo/skills/demo/SKILL.md")).exists()).toBe(false);
  });
}

test("SET-627: valid resources, marked resources, external URLs and code examples pass", async () => {
  const root = await fixture([
    "[guide](references/guide.md#section)",
    "[marked](shared:references/guide.md)",
    "@{{shared:references/guide.md}}",
    "[external](https://example.com/missing.md)",
    "[anchor](#missing-anchor)",
    "`[example](missing.md)`", "", "```md", "[example](missing.md)", "```", "",
    "    [indented](missing.md)", "", "<!-- [comment](missing.md) -->",
  ].join("\n"), "resources:\n  references:\n    - shared:references/guide.md\n");
  expect((await buildSkillsetResult(root, { isolated: true })).ok).toBe(true);
});

test("SET-627: reference-style image targets are checked after rendering", async () => {
  const root = await fixture("![image][logo]\n\n[logo]: assets/missing.png \"Logo\"");
  await expect(diffSkillsetResult(root)).rejects.toThrow("assets/missing.png");
});

test("SET-627: portable-only projection also rejects omitted local targets", async () => {
  const root = await fixture("[guide](references/guide.md)");
  const graph = await loadBuildGraph(root);
  await expect(renderStandardProjectionBuildGraph(graph)).rejects.toThrow("references/guide.md");
});

test("SET-627: plugin README checks final package inventory, not adjacent source files", async () => {
  const root = await fixture("Body.", "", true);
  await Bun.write(join(root, ".skillset/plugins/demo/README.md"), "[guide](unbundled.md)\n");
  await Bun.write(join(root, ".skillset/plugins/demo/unbundled.md"), "Unbundled.\n");
  await expect(buildSkillsetResult(root)).rejects.toThrow("unbundled.md");
});

test("SET-627: diagnostic identifies the canonical source and rendered output", async () => {
  const root = await fixture("[missing](absent.md)");
  try {
    await diffSkillsetResult(root);
    throw new Error("expected missing-link failure");
  } catch (error) {
    expect(error).toMatchObject({ code: "bundle-markdown-link-missing", featureId: "resources", path: ".skillset/skills/demo/SKILL.md" });
    expect(String(error)).toContain("SKILL.md");
    expect(String(error)).toContain("absent.md");
  }
});

for (const target of ["../other/SKILL.md", "../demo-extra/SKILL.md", "%2e%2e/other/SKILL.md"]) {
  test(`SET-627: another emitted skill cannot satisfy ${target}`, async () => {
    const root = await fixture(`[other](${target})`);
    for (const name of ["other", "demo-extra"]) await Bun.write(join(root, `.skillset/skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: Other skill.\n---\nBody.\n`);
    await expect(buildSkillsetResult(root)).rejects.toThrow("bundle Markdown link");
  });
}

test("SET-627: directories and URI-encoded file names resolve in the bundle", async () => {
  const root = await fixture('[nested [label]](references/a%20b.md?raw=1#anchor "Title")\n[dir](references/)', "resources:\n  references:\n    - shared:references/a b.md\n");
  await Bun.write(join(root, ".skillset/shared/references/a b.md"), "Body.\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
});

test("SET-627: copied resource Markdown named SKILL.md stays opaque", async () => {
  const root = await fixture("[resource](references/SKILL.md)", "resources:\n  references:\n    - shared:references/SKILL.md\n");
  await Bun.write(join(root, ".skillset/shared/references/SKILL.md"), "[not-primary](missing.md)\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
});

test("SET-627: unknown dynamic paths and non-file destinations are not asserted", async () => {
  const root = await fixture('[dynamic](%24ROOT/file.md)\n[remote](//example.com/no.md)\n[mail](mailto:test@example.com)');
  expect((await buildSkillsetResult(root)).ok).toBe(true);
});

test("SET-627: plugin README can link to its emitted skill", async () => {
  const root = await fixture("Body.", "", true);
  await Bun.write(join(root, ".skillset/plugins/demo/README.md"), "---\nforeign: value\n---\n[skill](skills/demo/SKILL.md)\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
});

test("SET-627: plugin subagent links use the package boundary", async () => {
  const root = await fixture("Body.", "", true);
  const agent = join(root, ".skillset/plugins/demo/subagents/review.md");
  await Bun.write(agent, "---\nname: review\ndescription: Review.\n---\n[missing](missing.md)\n");
  await expect(buildSkillsetResult(root)).rejects.toThrow("missing.md");
  await Bun.write(agent, "---\nname: review\ndescription: Review.\n---\n[skill](../skills/demo/SKILL.md)\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
});

test("SET-627: cold bundle validation needs neither source nor stale disk targets", async () => {
  const root = await fixture("[guide](references/guide.md)", "resources:\n  references:\n    - shared:references/guide.md\n");
  const graph = await loadBuildGraph(root);
  const result = await buildSkillsetResult(root);
  const locks = new Map<string, LockRoot>();
  for (const file of result.data) {
    if (!file.path.endsWith("skillset.lock")) continue;
    const content = typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content);
    const lock = JSON.parse(content) as LockRoot;
    locks.set(file.path.slice(0, -"/skillset.lock".length), lock);
  }
  await rm(join(root, ".skillset"), { recursive: true });
  expect(() => assertRenderedMarkdownLinks(graph, result.data, locks)).not.toThrow();
  expect(await Bun.file(join(root, ".agents/skills/demo/references/guide.md")).exists()).toBe(true);
  const omitted = result.data.filter(file => !file.path.endsWith("/references/guide.md"));
  expect(() => assertRenderedMarkdownLinks(graph, omitted, locks)).toThrow("references/guide.md");
});

test("SET-627: excluded plugin links do not block repo-scoped build or diff", async () => {
  const root = await fixture("[guide](references/guide.md)", "resources:\n  references:\n    - shared:references/guide.md\n");
  await Bun.write(join(root, ".skillset/plugins/other/skillset.yaml"), "skillset:\n  name: other\n");
  await Bun.write(join(root, ".skillset/plugins/other/skills/other/SKILL.md"), "---\nname: other\ndescription: Other.\n---\n[missing](absent.md)\n");
  expect((await buildSkillsetResult(root, { scopes: ["repo"], isolated: true })).ok).toBe(true);
  await expect(diffSkillsetResult(root, { scopes: ["repo"] })).resolves.toBeDefined();
  await expect(buildSkillsetResult(root, { scopes: ["plugins"] })).rejects.toThrow("absent.md");
  await expect(diffSkillsetResult(root, { scopes: ["plugins"] })).rejects.toThrow("absent.md");
});
