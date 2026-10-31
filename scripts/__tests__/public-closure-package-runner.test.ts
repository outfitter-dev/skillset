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
  "plugins/skillset/skills/skillset/references/preflight-and-recovery.md: - Persistent install: `npm install --global skillset`. This changes the user's environment; obtain authorization when not already granted, then rerun preflight. The latest release may be outside this guidance's qualified range.",
  "plugins/skillset/skills/skillset/references/preflight-and-recovery.md: - Ephemeral exact package: `npm exec --yes --package=skillset@0.30.0 -- skillset --version`, followed by `npm exec --yes --package=skillset@0.30.0 -- skillset init --root .` for a new-workspace preview. These exact commands were executed against the published package. They can download code and write a package cache; run only when that is permitted and chosen. The package runner's `--yes` accepts its download prompt; it is not Skillset's applying `--yes`. Do not add the latter to a preview.",
  "plugins/skillset/skills/skillset/references/preflight-and-recovery.md: The npm launcher requires Node 18 or later and an available platform binary; Bun is not required. If the required runtime, platform binary, network or registry access is unavailable, report that specific limitation and continue inspection or native work within scope. Never install silently or weaken workspace confirmation, provider trust, or shell execution policy to recover.",
  "plugins/skillset/skills/skillset/scripts/preflight.ps1: foreach ($runtime in @('node', 'npm', 'bun')) {",
  "plugins/skillset/skills/skillset/scripts/preflight.sh: for runtime in node npm bun; do"
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
    const sharedLines = FROZEN_PACKAGE_RUNNER_LINES.filter((line) => line.startsWith("plugins/skillset/skills/skillset/"));
    const expected = [...FROZEN_PACKAGE_RUNNER_LINES, ...["skillset-init", "skillset-maintain"].flatMap((name) => sharedLines.map((line) => line.replace("skills/skillset/", `skills/${name}/`)))];
    // The capability specialist bundles the reference, but no preflight script.
    expected.push(...sharedLines
      .filter((line) => line.startsWith("plugins/skillset/skills/skillset/references/preflight-and-recovery.md:"))
      .map((line) => line.replace("skills/skillset/", "skills/skillset-provider-capabilities/")));
    expect(lines.sort()).toEqual(expected.sort());
  });

  test("a package script that routes into internals is still caught only through its alias", async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const names = new Set(Object.keys(packageJson.scripts));
    const aliases = findRepoInternalScriptAliases(packageJson.scripts, [], "/repo");
    const rules = (command: string, scriptAliases: ReadonlySet<string>) =>
      scanGeneratedPublicContent(
        "plugins/skillset/skills/skillset/SKILL.md",
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
