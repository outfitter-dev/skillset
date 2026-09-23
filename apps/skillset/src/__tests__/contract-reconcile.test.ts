import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test } from "bun:test";
import { buildSkillset } from "@skillset/core";
import { suggestSource } from "@skillset/core/internal/authoring";

import {
  contractFixture,
  runSkillsetCli,
  writeHistory,
} from "./contract-test-helpers";

test("SET-282: reconcile previews and applies output-wins skill edits", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: source-suggestion-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Original source body.
`,
  });
  await buildSkillset(root);

  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  await writeFile(
    generatedAbsolute,
    (await readFile(generatedAbsolute, "utf8")).replace(
      "Original source body.",
      "Edited generated body."
    ),
    "utf8"
  );

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: available");
  expect(preview.stdout).toContain("source wins: available");
  expect(preview.stdout).toContain("source: .skillset/skills/demo/SKILL.md");
  expect(preview.stdout).toContain("rerun with --use output --yes to apply");
  expect(preview.stdout).not.toContain("--use undefined");
  await expect(readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).resolves.toContain("Original source body.");

  const written = await runSkillsetCli("reconcile", generatedPath, "--use", "output", "--yes", "--root", root);
  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("reconciled using output");
  expect(written.stdout).not.toContain("recovery: skillset restore");
  const source = await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8");
  expect(source).toContain("Edited generated body.");
  expect(source).not.toContain("metadata:");

  const removed = await runSkillsetCli("suggest-source", generatedPath, "--root", root);
  expect(removed.exitCode).toBe(1);
  expect(removed.stderr).toContain("expected command");
});

test("SET-322: reconcile preserves provider-rendered frontmatter for body-only edits", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-provider-frontmatter
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
implicit_invocation: false
---

Original source body.
`,
  });
  await buildSkillset(root);

  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const sourceAbsolute = join(root, ".skillset/skills/demo/SKILL.md");
  const sourceBefore = await readFile(sourceAbsolute, "utf8");
  const frontmatterBefore = sourceBefore.slice(0, sourceBefore.indexOf("Original source body."));
  const expected = await readFile(generatedAbsolute, "utf8");
  expect(expected).toContain("disable-model-invocation: true");
  await writeFile(
    generatedAbsolute,
    expected
      .replace("Original source body.", "Edited generated body.")
      .replaceAll("\n", "\r\n"),
    "utf8"
  );

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: available");

  const written = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(written.exitCode).toBe(0);
  const sourceAfter = await readFile(sourceAbsolute, "utf8");
  expect(sourceAfter).toContain("Edited generated body.");
  expect(sourceAfter.slice(0, sourceAfter.indexOf("Edited generated body."))).toBe(
    frontmatterBefore
  );
});

test("SET-322: reconcile refuses generated frontmatter divergence before writes", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-frontmatter-divergence
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Original source body.
`,
  });
  await buildSkillset(root);

  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const originalSource = await readFile(sourcePath, "utf8");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const editedGenerated = (await readFile(generatedAbsolute, "utf8"))
    .replace("---\n", "---\n# generated-only frontmatter comment\n")
    .replace("Original source body.", "Edited generated body.");
  await writeFile(generatedAbsolute, editedGenerated, "utf8");

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain(
    "Generated frontmatter differs from the expected rendered frontmatter"
  );
  expect(preview.stdout).toContain(
    `skillset reconcile ${generatedPath} --use source --yes`
  );

  const structured = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--json",
    "--root",
    root
  );
  expect(structured.exitCode).toBe(0);
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "reconcile",
    data: {
      report: {
        outputResolution: {
          nextSteps: expect.arrayContaining([
            `Run \`skillset reconcile ${generatedPath} --use source --yes\` to restore the generated output.`,
          ]),
          status: "refused",
          wouldWrite: false,
          wrote: false,
        },
      },
      state: "planned",
      writes: [],
    },
    kind: "data",
    ok: true,
  });

  const refused = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain(
    "Generated frontmatter differs from the expected rendered frontmatter"
  );
  expect(await readFile(sourcePath, "utf8")).toBe(originalSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(editedGenerated);
});

test("SET-322: reconcile refuses output absent from the current render", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-removed-target
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Source body.
`,
  });
  await buildSkillset(root);

  const sourceAbsolute = join(root, ".skillset/skills/demo/SKILL.md");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const originalGenerated = await readFile(generatedAbsolute, "utf8");
  await writeFile(
    sourceAbsolute,
    "---\nname: demo\ndescription: Demo.\nclaude: false\n---\n\nSource body.\n",
    "utf8"
  );
  const originalSource = await readFile(sourceAbsolute, "utf8");

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain("managed path is absent from the current rendered output");

  const structured = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--json",
    "--root",
    root
  );
  expect(structured.exitCode).toBe(0);
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "reconcile",
    data: {
      report: {
        outputResolution: {
          nextSteps: ["Update the adaptive source manually, then run `skillset build --yes`."],
          status: "refused",
          wouldWrite: false,
          wrote: false,
        },
      },
      state: "planned",
      writes: [],
    },
    kind: "data",
    ok: true,
  });

  const refused = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("managed path is absent from the current rendered output");
  expect(await readFile(sourceAbsolute, "utf8")).toBe(originalSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(originalGenerated);
});

test("SET-322: output resolution refuses stale ownership after a path remap", async () => {
  const staleSourcePath = ".stale/skills/demo/SKILL.md";
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-ownership-remap
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Current source.
---

Current source body.
`,
    [staleSourcePath]: `
---
name: demo
description: Stale source.
---

Stale source body.
`,
  });
  await buildSkillset(root);

  const currentSourceAbsolute = join(root, ".skillset/skills/demo/SKILL.md");
  const staleSourceAbsolute = join(root, staleSourcePath);
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const originalCurrentSource = await readFile(currentSourceAbsolute, "utf8");
  const originalStaleSource = await readFile(staleSourceAbsolute, "utf8");
  const originalGenerated = await readFile(generatedAbsolute, "utf8");
  const ownershipEntries = [{
    files: [generatedPath],
    kind: "standalone-skill",
    outputPath: generatedPath,
    outputRoot: ".claude/skills",
    sourcePath: staleSourcePath,
    target: "claude",
  }] as const;

  const preview = await suggestSource(root, generatedPath, { ownershipEntries });
  expect(preview).toMatchObject({
    message: "Current rendered ownership differs from the selected lock ownership; output resolution was refused.",
    sourcePath: staleSourcePath,
    status: "refused",
    wouldWrite: false,
    wrote: false,
  });

  const refusedWrite = await suggestSource(root, generatedPath, {
    ownershipEntries,
    write: true,
  });
  expect(refusedWrite).toMatchObject({
    status: "refused",
    wouldWrite: false,
    wrote: false,
  });
  expect(await readFile(currentSourceAbsolute, "utf8")).toBe(originalCurrentSource);
  expect(await readFile(staleSourceAbsolute, "utf8")).toBe(originalStaleSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(originalGenerated);
});

test("SET-295: output resolution preserves the canonical ambiguous-ownership refusal", async () => {
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const ownershipEntries = [
    {
      files: [generatedPath],
      kind: "standalone-skill",
      outputPath: generatedPath,
      outputRoot: ".claude/skills",
      sourcePath: ".skillset/skills/alpha/SKILL.md",
      target: "claude",
    },
    {
      files: [generatedPath],
      kind: "standalone-skill",
      outputPath: generatedPath,
      outputRoot: ".claude/skills",
      sourcePath: ".skillset/skills/beta/SKILL.md",
      target: "claude",
    },
  ] as const;

  const preview = await suggestSource("/workspace", generatedPath, {
    ownershipEntries,
  });

  expect(preview).toMatchObject({
    message: "Generated path has multiple source owners.",
    status: "refused",
    wouldWrite: false,
    wrote: false,
  });
});

test("SET-322: reconcile structurally refuses unclosed generated frontmatter", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-unclosed-frontmatter
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Source body.
`,
  });
  await buildSkillset(root);

  const sourceAbsolute = join(root, ".skillset/skills/demo/SKILL.md");
  const originalSource = await readFile(sourceAbsolute, "utf8");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const malformedGenerated = "---\nname: demo\ndescription: Unclosed generated frontmatter.\n";
  await writeFile(generatedAbsolute, malformedGenerated, "utf8");

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain(
    "Generated frontmatter differs from the expected rendered frontmatter"
  );

  const structured = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--json",
    "--root",
    root
  );
  expect(structured.exitCode).toBe(0);
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "reconcile",
    data: {
      report: {
        outputResolution: {
          status: "refused",
          wouldWrite: false,
          wrote: false,
        },
      },
      state: "planned",
      writes: [],
    },
    kind: "data",
    ok: true,
  });

  const refused = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain(
    "Generated frontmatter differs from the expected rendered frontmatter"
  );
  expect(await readFile(sourceAbsolute, "utf8")).toBe(originalSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(malformedGenerated);
});

test("SET-322: reconcile keeps provider-native skill islands out of output resolution", async () => {
  const sourcePath = ".skillset/_claude/skills/native/SKILL.md";
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-provider-native
claude: true
codex: false
`,
    [sourcePath]: `
---
name: native
description: Provider-native skill.
---

Provider-native source body.
`,
  });
  await buildSkillset(root);

  const sourceAbsolute = join(root, sourcePath);
  const originalSource = await readFile(sourceAbsolute, "utf8");
  const generatedPath = ".claude/skills/native/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const editedGenerated = (await readFile(generatedAbsolute, "utf8")).replace(
    "Provider-native source body.",
    "Edited generated body."
  );
  await writeFile(generatedAbsolute, editedGenerated, "utf8");

  const refused = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("Only generated skill Markdown body edits are suggestible in v1");
  expect(await readFile(sourceAbsolute, "utf8")).toBe(originalSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(editedGenerated);
});

test("SET-282: reconcile rejects adaptive source paths before writing", async () => {
  const sourcePath = ".skillset/skills/demo/SKILL.md";
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-source-path\nclaude: true\ncodex: false\n",
    [sourcePath]: "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
  });
  await buildSkillset(root);

  const result = await runSkillsetCli(
    "reconcile",
    sourcePath,
    "--use",
    "source",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("reconcile requires a managed generated path");
  expect(result.stderr).toContain(`${sourcePath} is source`);
});

test("SET-282: reconcile applies source-wins with output backup safety", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-source\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
  });
  await buildSkillset(root);
  const generatedPath = ".claude/skills/demo/SKILL.md";
  await writeFile(join(root, generatedPath), "---\nname: demo\ndescription: Demo.\n---\n\nOutput edit.\n", "utf8");

  const result = await runSkillsetCli("reconcile", `./${generatedPath}`, "--use", "source", "--yes", "--root", root);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("reconciled using source");
  expect(result.stdout).not.toContain("output next:");
  expect(result.stdout).toContain("recovery: skillset restore ");
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("Source body.");
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).not.toContain("Output edit.");

  await rm(join(root, generatedPath));
  const rebuilt = await runSkillsetCli("reconcile", generatedPath, "--use", "source", "--yes", "--root", root);
  expect(rebuilt.exitCode).toBe(0);
  expect(rebuilt.stdout).toContain("reconciled using source");
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("Source body.");

  await writeFile(
    join(root, generatedPath),
    "---\nname: demo\ndescription: Broken output without a closing fence.\n",
    "utf8"
  );
  const recovered = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "source",
    "--yes",
    "--root",
    root
  );
  expect(recovered.exitCode).toBe(0);
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("Source body.");

  const structured = await runSkillsetCli("reconcile", generatedPath, "--root", root, "--json");
  expect(structured.exitCode).toBe(0);
  expect(structured.stderr).toBe("");
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "reconcile",
    data: {
      report: { generatedPath, sourceResolutionAvailable: true },
      state: "planned",
      writes: [],
    },
    kind: "data",
    ok: true,
  });
});

test("SET-282: failed output-wins reconciliation restores source", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-invalid-output\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nOriginal source body.\n",
  });
  await buildSkillset(root);
  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const originalSource = await readFile(sourcePath, "utf8");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedSource = await readFile(join(root, generatedPath), "utf8");
  await writeFile(
    join(root, generatedPath),
    generatedSource.replace("Original source body.", "See [missing](shared:references/missing.md)."),
    "utf8"
  );

  const result = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("links to undeclared shared resource");
  expect(await readFile(sourcePath, "utf8")).toBe(originalSource);
});

test("SET-282: source-wins removes edited output after its source is deleted", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-removed-source\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
    ".skillset/skills/keep/SKILL.md": "---\nname: keep\ndescription: Keep.\n---\n\nKeep body.\n",
  });
  await buildSkillset(root);
  const generatedPath = ".claude/skills/demo/SKILL.md";
  await writeFile(join(root, generatedPath), "Edited managed output.\n", "utf8");
  await rm(join(root, ".skillset/skills/demo"), { recursive: true });

  const result = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "source",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("reconciled using source");
  expect(result.stdout).not.toContain("output next:");
  expect(await Bun.file(join(root, generatedPath)).exists()).toBe(false);
});

test("SET-282: reconcile refuses to overwrite unrelated generated drift", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-scope\nclaude: true\ncodex: false\n",
    ".skillset/skills/alpha/SKILL.md":
      "---\nname: alpha\ndescription: Alpha.\n---\n\nAlpha source.\n",
    ".skillset/skills/beta/SKILL.md":
      "---\nname: beta\ndescription: Beta.\n---\n\nBeta source.\n",
  });
  await buildSkillset(root);
  const alphaPath = ".claude/skills/alpha/SKILL.md";
  const betaPath = ".claude/skills/beta/SKILL.md";
  await writeFile(join(root, alphaPath), "---\nname: alpha\n---\n\nAlpha output edit.\n", "utf8");
  await writeFile(join(root, betaPath), "---\nname: beta\n---\n\nBeta output edit.\n", "utf8");

  const preview = await runSkillsetCli("reconcile", alphaPath, "--root", root);
  expect(preview.exitCode).toBe(1);
  expect(preview.stderr).toContain(betaPath);

  const result = await runSkillsetCli(
    "reconcile",
    alphaPath,
    "--use",
    "source",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unrelated generated drift exists");
  expect(result.stderr).toContain(betaPath);
  expect(await readFile(join(root, alphaPath), "utf8")).toContain("Alpha output edit.");
  expect(await readFile(join(root, betaPath), "utf8")).toContain("Beta output edit.");
});

test("SET-282: reconcile refuses sibling target drift from the same source", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-siblings\nclaude: true\ncodex: true\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
  });
  await buildSkillset(root);
  const claudePath = ".claude/skills/demo/SKILL.md";
  const codexPath = ".agents/skills/demo/SKILL.md";
  await writeFile(join(root, claudePath), "---\nname: demo\n---\n\nClaude edit.\n", "utf8");
  await writeFile(join(root, codexPath), "---\nname: demo\n---\n\nCodex edit.\n", "utf8");

  const preview = await runSkillsetCli("reconcile", claudePath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("source wins: available");
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain(codexPath);
  expect(preview.stdout).not.toContain("rerun with --use output --yes");

  const result = await runSkillsetCli(
    "reconcile", claudePath, "--use", "output", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(codexPath);
  expect(await readFile(join(root, claudePath), "utf8")).toContain("Claude edit.");
  expect(await readFile(join(root, codexPath), "utf8")).toContain("Codex edit.");
});

test("SET-282: output-wins normalizes equivalent selected paths", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-normalized\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
  });
  await buildSkillset(root);
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedSource = await readFile(join(root, generatedPath), "utf8");
  await writeFile(
    join(root, generatedPath),
    generatedSource.replace("Source body.", "Output edit."),
    "utf8"
  );

  const result = await runSkillsetCli(
    "reconcile",
    resolve(root, generatedPath),
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("reconciled using output");
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Output edit.");
});

test("SET-282: source-wins rebuilds sibling target drift", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-source-siblings\nclaude: true\ncodex: true\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nInitial source.\n",
  });
  await buildSkillset(root);
  const claudePath = ".claude/skills/demo/SKILL.md";
  const codexPath = ".agents/skills/demo/SKILL.md";
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nUpdated source.\n", "utf8");
  await writeFile(join(root, claudePath), "---\nname: demo\n---\n\nClaude edit.\n", "utf8");

  const preview = await runSkillsetCli("reconcile", claudePath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("source wins: available");

  const result = await runSkillsetCli(
    "reconcile", claudePath, "--use", "source", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(0);
  expect(await readFile(join(root, claudePath), "utf8")).toContain("Updated source.");
  expect(await readFile(join(root, codexPath), "utf8")).toContain("Updated source.");
});

test("SET-282: source-wins deletes stale sibling outputs", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-stale-sibling\nclaude: true\ncodex: false\n",
    ".skillset/shared/references/guide.md": "# Guide\n",
    ".skillset/skills/demo/SKILL.md": `---
name: demo
description: Demo.
resources:
  references:
    - shared:references/guide.md
---

Source body.
`,
  });
  await buildSkillset(root);
  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const skillPath = ".claude/skills/demo/SKILL.md";
  const staleSiblingPath = ".claude/skills/demo/references/guide.md";
  await writeFile(
    sourcePath,
    "---\nname: demo\ndescription: Demo.\n---\n\nSource body without the reference.\n",
    "utf8"
  );

  const result = await runSkillsetCli(
    "reconcile", skillPath, "--use", "source", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(0);
  expect(await Bun.file(join(root, staleSiblingPath)).exists()).toBe(false);
  expect(await readFile(join(root, skillPath), "utf8")).toContain("without the reference");
});

test("SET-282: reconcile refuses sibling resource drift from the same output", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-resources\nclaude: true\ncodex: false\n",
    ".skillset/shared/references/guide.md": "# Source guide\n",
    ".skillset/skills/demo/SKILL.md": `---
name: demo
description: Demo.
resources:
  references:
    - shared:references/guide.md
---

Source body.
`,
  });
  await buildSkillset(root);
  const skillPath = ".claude/skills/demo/SKILL.md";
  const guidePath = ".claude/skills/demo/references/guide.md";
  await writeFile(join(root, skillPath), "---\nname: demo\n---\n\nOutput edit.\n", "utf8");
  await writeFile(join(root, guidePath), "# Output guide edit\n", "utf8");

  const preview = await runSkillsetCli(
    "reconcile", skillPath, "--use", "output", "--root", root
  );
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain(guidePath);

  const result = await runSkillsetCli(
    "reconcile", skillPath, "--use", "output", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unrelated generated drift exists");
  expect(result.stderr).toContain(guidePath);
  expect(await readFile(join(root, skillPath), "utf8")).toContain("Output edit.");
  expect(await readFile(join(root, guidePath), "utf8")).toBe("# Output guide edit\n");
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Source body.");
});

test("SET-282: reconcile accepts a selected secondary lock file", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-secondary\nclaude: true\ncodex: false\n",
    ".skillset/shared/references/guide.md": "# Source guide\n",
    ".skillset/skills/demo/SKILL.md": `---
name: demo
description: Demo.
resources:
  references:
    - shared:references/guide.md
---

Read the guide.
`,
  });
  await buildSkillset(root);
  const secondaryPath = ".claude/skills/demo/references/guide.md";
  await writeFile(join(root, secondaryPath), "# Edited guide\n", "utf8");

  const result = await runSkillsetCli(
    "reconcile", secondaryPath, "--use", "source", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(0);
  expect(await readFile(join(root, secondaryPath), "utf8")).toBe("# Source guide\n");

  await writeFile(join(root, secondaryPath), "# Edited guide again\n", "utf8");
  const refused = await runSkillsetCli(
    "reconcile", secondaryPath, "--use", "output", "--yes", "--root", root
  );

  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("Auxiliary skill outputs cannot replace the owning SKILL.md source body");
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Read the guide.");
  expect(await readFile(join(root, ".skillset/shared/references/guide.md"), "utf8")).toBe("# Source guide\n");
});

test("SET-282: --write is rejected outside check", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: write-route\nclaude: true\ncodex: false\n",
  });
  for (const args of [
    ["build", "--write", "--root", root],
    ["reconcile", "missing", "--write", "--root", root],
  ]) {
    const result = await runSkillsetCli(...args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--write is only supported with check");
  }
});

test("SET-282: reconcile rejects retired source and output root options", async () => {
  for (const flag of ["--source", "--dist"]) {
    const result = await runSkillsetCli("reconcile", "missing", flag, "alternate");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`unknown option ${flag}`);
  }
});

test("SET-282: reconcile refuses output-wins generated changelog edits", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: changelog-source-suggestion-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await writeHistory(root, [
    {
      id: "111111aaaaaa",
      bump: "patch",
      scope: "skill:demo",
      reason: "Generated changelog content comes from applied history.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:one" }],
    },
  ]);
  await buildSkillset(root);

  const preview = await runSkillsetCli("reconcile", ".skillset/skills/demo/CHANGELOG.md", "--use", "output", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain("rerun with --use source --yes to apply");
  expect(preview.stdout).not.toContain("choose --use source or --use output");
  expect(preview.stdout).not.toContain("rerun with --use output --yes");

  const refused = await runSkillsetCli("reconcile", ".skillset/skills/demo/CHANGELOG.md", "--use", "output", "--yes", "--root", root);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("Generated changelogs are managed projections");
});
