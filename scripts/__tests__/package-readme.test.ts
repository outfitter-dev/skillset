import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { packageReadme } from "../native-packages";
import { getNativeTarget } from "../native-targets";
import { projectionDiagnostics, readmeMetadataDiagnostics } from "../package-metadata";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

const nativeDescription = "Source-first compiler for provider-native agent loadouts.";
const bunDescription = "Bun distribution of the Skillset source-first compiler.";
const nativeReadme = `# Skillset\n\nSkillset is a ${nativeDescription[0]!.toLowerCase()}${nativeDescription.slice(1)}\n\nnpm install --global skillset\nskillset init\n`;
const bunReadme = `# @skillset/cli\n\n${bunDescription}\nRequires Bun >=1.4.0 at runtime.\nbun add --global @skillset/cli\nbunx @skillset/cli init\n`;

async function fixture() {
  const root = await createTestFixtureRoot("skillset-package-readme-");
  for (const dir of ["apps/cli", "apps/skillset"]) await mkdir(join(root, dir), { recursive: true });
  for (const [path, text] of Object.entries({
    "README.md": nativeReadme,
    "LICENSE": "license\n",
    "apps/skillset/README.md": nativeReadme,
    "apps/skillset/LICENSE": "license\n",
    "apps/cli/README.md": bunReadme,
    "apps/cli/LICENSE": "license\n",
    "apps/skillset/package.json": JSON.stringify({ description: nativeDescription }),
    "apps/cli/package.json": JSON.stringify({ description: bunDescription, engines: { bun: ">=1.4.0" } }),
  })) await Bun.write(join(root, path), text);
  return root;
}

test("SET-713: separate Bun README is authored while native README and licenses are projected", async () => {
  const root = await fixture();
  expect(await projectionDiagnostics(root)).toEqual([]);
  expect(await readmeMetadataDiagnostics(root)).toEqual([]);
});

test("SET-713: copying the native README over Bun guidance fails", async () => {
  const root = await fixture();
  await Bun.write(join(root, "apps/cli/README.md"), nativeReadme);
  const diagnostics = await readmeMetadataDiagnostics(root);
  expect(diagnostics).toContain("apps/cli/README.md must state the Bun package description in its first 60 lines");
  expect(diagnostics).toContain("apps/cli/README.md must include bun add --global @skillset/cli in its first 60 lines");
  expect(diagnostics).toContain("apps/cli/README.md must include bunx @skillset/cli init in its first 60 lines");
  expect(diagnostics).toContain("apps/cli/README.md must state Bun >=1.4.0 in its first 60 lines");
});

test("SET-713: runtime guidance follows the package engine instead of a duplicated version", async () => {
  const root = await fixture();
  await Bun.write(join(root, "apps/cli/package.json"), JSON.stringify({ description: bunDescription, engines: { bun: ">=9.0.0" } }));
  expect(await readmeMetadataDiagnostics(root)).toContain("apps/cli/README.md must state Bun >=9.0.0 in its first 60 lines");
});

test("SET-713: native npm README uses registry npm platform fields", () => {
  const readme = packageReadme(getNativeTarget("windows-x64"));
  expect(readme).toContain("# @skillset/native-win32-x64");
  expect(readme).toContain("win32-x64 native executable");
  expect(readme).not.toContain("windows-x64");
});
