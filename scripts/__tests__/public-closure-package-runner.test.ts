import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  findRepoInternalScriptAliases,
  scanGeneratedPublicContent,
} from "../public-closure-guard";

const repoRoot = join(import.meta.dir, "..", "..");
const PUBLIC_ROOT = join(repoRoot, "plugins", "skillset");
const PACKAGE_RUNNER = /(?<![A-Za-z0-9_-])(?:bun|npm|pnpm|yarn)(?![A-Za-z0-9_-])/u;

// SET-499: the package-runner detection in public-closure-guard.ts is frozen.
// It stays because it is the only check that sees a script name routing into
// repository internals through package.json, but the generated public corpus
// currently gives it nothing to read. Any new package-runner text in public
// output must be added here deliberately, after confirming the guard covers it.
const FROZEN_PACKAGE_RUNNER_LINES: readonly string[] = [
  "plugins/skillset/README.md: The skill drives the `skillset` command line tool. Install it from npm:",
  "plugins/skillset/README.md: npm install --global skillset",
];

async function publicFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

describe("SET-499 frozen package-runner detection", () => {
  test("generated public output contains only the known package-runner lines", async () => {
    const lines: string[] = [];
    for (const file of await publicFiles(PUBLIC_ROOT)) {
      if (file.endsWith(".lock")) continue;
      const content = await readFile(file, "utf8");
      for (const line of content.split(/\r?\n/u)) {
        if (PACKAGE_RUNNER.test(line)) lines.push(`${relative(repoRoot, file)}: ${line.trim()}`);
      }
    }
    expect(lines).toEqual([...FROZEN_PACKAGE_RUNNER_LINES]);
  });

  test("a package script that routes into internals is still caught only through its alias", async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const names = new Set(Object.keys(packageJson.scripts));
    const aliases = findRepoInternalScriptAliases(packageJson.scripts, [], "/repo");
    const rules = (command: string, scriptAliases: ReadonlySet<string>) =>
      scanGeneratedPublicContent(
        "plugins/skillset/skills/use-skillset/SKILL.md",
        `\`\`\`sh\n${command}\n\`\`\``,
        [],
        scriptAliases,
        names,
        "/repo"
      ).map(({ rule }) => rule);

    expect(rules("bun run schema:generate", aliases)).toEqual(["internal-script"]);
    // Without the alias inventory the generic operand policy has no path to see.
    expect(rules("bun run schema:generate", new Set())).toEqual([]);
    // A path operand is caught generically either way.
    expect(rules("bun run ./packages/core/x", new Set())).toEqual(["internal-package"]);
  });
});
