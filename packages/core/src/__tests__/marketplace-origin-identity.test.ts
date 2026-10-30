import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTestGitFixtureRoot, createTestGitRemote, runTestGit } from "../../../../scripts/test-helpers/git-remote";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult } from "../build";
import { writeKnownSkillsetsIndex } from "../known-skillsets";
import { checkMarketplaces } from "../marketplace-check";

async function writeFixture(root: string, files: Record<string, string>) {
  await mkdir(root);
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) await Bun.write(join(root, path), content);
}

test("known checkout with a canonical-equal but distinct fetch origin falls through to the requested remote", async () => {
  const root = await createTestGitFixtureRoot("skillset-known-origin-");
  const requested = "https://git.example/acme/plugin";
  const remotes = [];
  for (const [index, repository] of [`${requested}.git`, requested].entries()) {
    const work = join(root, `work-${index}`);
    await writeFixture(work, {
      "skillset.yaml": "skillset:\n  name: external\n",
      ".skillset/plugins/tools/skillset.yaml": `skillset:\n  name: tools\n  version: ${index + 1}.0.0\n`,
    });
    await buildSkillsetResult(work);
    const remote = await createTestGitRemote(work, { disposableRoot: root, repository });
    await runTestGit(work, "remote", "add", "origin", repository);
    remotes.push(remote);
  }
  const [a, b] = remotes;
  if (a === undefined || b === undefined) throw new Error("Missing fixture remotes");
  const xdg = {
    env: { ...a.env, GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_1: `url.file://${b.remotePath}/.insteadOf`, GIT_CONFIG_VALUE_1: requested },
    homeDir: a.xdg.homeDir,
  };
  await writeKnownSkillsetsIndex({ schemaVersion: 1, skillsets: [{ cacheKey: "external", identities: [requested], path: a.workPath, repository: a.repository }] }, xdg);
  const marketplace = join(root, "marketplace");
  await writeFixture(marketplace, { "skillset.yaml": `skillset:\n  name: market\nmarketplaces:\n  demo:\n    targets: [claude]\n    plugins:\n      - plugin: tools\n        repo: ${requested}\n        sha: ${a.sha}\n` });
  const report = await checkMarketplaces(marketplace, { xdg });
  expect(report.entries[0]?.source.kind).toBe("remote-cache");
  expect(report.entries[0]?.readiness).toBe("not-ready");
  expect(report.ok).toBe(false);
});
