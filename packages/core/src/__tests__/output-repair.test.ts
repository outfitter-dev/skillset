import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillsetResult, ISOLATED_OUT_ROOT } from "../build";
import {
  createOperationalPathContext,
  resolveOperationalPath,
} from "../operational-cache";
import { classifyRepairPath, planOutputRepair } from "../output-repair";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

const OUTPUT_PATH = ".agents/skills/demo/SKILL.md";
const COMPANION_PATH = ".agents/skills/demo/references/note.md";

describe("classifyRepairPath", () => {
  it("restores an absent managed output whatever the lock says", () => {
    expect(
      classifyRepairPath({
        fileMatchesLock: false,
        filePresent: false,
        outputPath: OUTPUT_PATH,
        renderMatchesFile: false,
        renderMatchesLock: false,
      })
    ).toEqual({
      action: "restore",
      outputPath: OUTPUT_PATH,
      verdict: "output-missing",
    });
  });

  it("reports a path that already equals the render as clean", () => {
    // `outputHash` is recorded per lock item, so an edited sibling can drag an
    // untouched file into the item's drift evidence. Matching the render is
    // proof that nothing is at stake for this path.
    expect(
      classifyRepairPath({
        fileMatchesLock: false,
        filePresent: true,
        outputPath: OUTPUT_PATH,
        renderMatchesFile: true,
        renderMatchesLock: true,
      }).verdict
    ).toBe("clean");
  });

  it("regenerates when only the source moved", () => {
    expect(
      classifyRepairPath({
        fileMatchesLock: true,
        filePresent: true,
        outputPath: OUTPUT_PATH,
        renderMatchesFile: false,
        renderMatchesLock: false,
      })
    ).toEqual({
      action: "regenerate",
      outputPath: OUTPUT_PATH,
      verdict: "source-ahead",
    });
  });

  it("preserves a hand-edited output when only the output moved", () => {
    expect(
      classifyRepairPath({
        fileMatchesLock: false,
        filePresent: true,
        outputPath: OUTPUT_PATH,
        renderMatchesFile: false,
        renderMatchesLock: true,
      })
    ).toEqual({
      action: "preserve",
      outputPath: OUTPUT_PATH,
      verdict: "output-edited",
    });
  });

  it("overwrites a hand-edited output only on explicit confirmation", () => {
    expect(
      classifyRepairPath({
        discardEdits: true,
        fileMatchesLock: false,
        filePresent: true,
        outputPath: OUTPUT_PATH,
        renderMatchesFile: false,
        renderMatchesLock: true,
      }).action
    ).toBe("regenerate");
  });

  it("refuses when source and output both moved", () => {
    expect(
      classifyRepairPath({
        discardEdits: true,
        fileMatchesLock: false,
        filePresent: true,
        outputPath: OUTPUT_PATH,
        renderMatchesFile: false,
        renderMatchesLock: false,
      })
    ).toEqual({
      action: "refuse",
      outputPath: OUTPUT_PATH,
      verdict: "diverged",
    });
  });

  it("removes a path the source no longer produces", () => {
    expect(
      classifyRepairPath({
        fileMatchesLock: true,
        filePresent: true,
        outputPath: OUTPUT_PATH,
        rendered: false,
        renderMatchesFile: false,
        renderMatchesLock: false,
      })
    ).toEqual({
      action: "remove",
      outputPath: OUTPUT_PATH,
      verdict: "output-obsolete",
    });
  });

  it("will not delete a hand-edited path the source no longer produces", () => {
    // Deleting loses the edit exactly as surely as overwriting would.
    expect(
      classifyRepairPath({
        fileMatchesLock: false,
        filePresent: true,
        outputPath: OUTPUT_PATH,
        rendered: false,
        renderMatchesFile: false,
        renderMatchesLock: false,
      })
    ).toMatchObject({ action: "preserve", verdict: "output-edited" });
  });

  it("reports removal when explicitly discarding an obsolete edit", () => {
    expect(
      classifyRepairPath({
        discardEdits: true,
        fileMatchesLock: false,
        filePresent: true,
        outputPath: OUTPUT_PATH,
        rendered: false,
        renderMatchesFile: false,
        renderMatchesLock: false,
      })
    ).toEqual({
      action: "remove",
      outputPath: OUTPUT_PATH,
      verdict: "output-edited",
    });
  });

  it("blames the lock, not the output, when the lock yields no verdict", () => {
    // Reporting this as `output-edited` would send a reader to port an edit
    // that does not exist; the fault is in the lock.
    expect(
      classifyRepairPath({
        fileMatchesLock: true,
        filePresent: true,
        lockComparable: false,
        outputPath: OUTPUT_PATH,
        renderMatchesFile: false,
        renderMatchesLock: true,
      })
    ).toEqual({
      action: "preserve",
      outputPath: OUTPUT_PATH,
      verdict: "lock-untrusted",
    });
  });

  it("does not let --discard-edits force through an untrusted lock", () => {
    expect(
      classifyRepairPath({
        discardEdits: true,
        fileMatchesLock: false,
        filePresent: true,
        lockComparable: false,
        outputPath: OUTPUT_PATH,
        renderMatchesFile: false,
        renderMatchesLock: false,
      })
    ).toMatchObject({ action: "preserve", verdict: "lock-untrusted" });
  });
});

describe("planOutputRepair", () => {
  it("is writable only when no path needs a human decision", () => {
    expect(
      planOutputRepair([
        { action: "restore", outputPath: "b", verdict: "output-missing" },
        { action: "none", outputPath: "a", verdict: "clean" },
      ])
    ).toMatchObject({ preserved: [], refused: [], writable: true });

    expect(
      planOutputRepair([
        { action: "preserve", outputPath: "a", verdict: "output-edited" },
        { action: "refuse", outputPath: "b", verdict: "diverged" },
        { action: "preserve", outputPath: "c", verdict: "lock-untrusted" },
      ])
    ).toMatchObject({
      lockUntrusted: ["c"],
      preserved: ["a"],
      refused: ["b"],
      writable: false,
    });
  });
});

describe("build --repair", () => {
  it("restores a deleted managed output byte-identically without touching the lock", async () => {
    const root = await seededFixture();
    const before = await readFile(join(root, OUTPUT_PATH));
    const lockBefore = await readFile(join(root, ".agents/skills/skillset.lock"), "utf8");

    await rm(join(root, OUTPUT_PATH));
    const result = await buildSkillsetResult(root, { repair: {} });

    expect(result.ok).toBe(true);
    expect(result.repair?.verdicts).toContainEqual({
      action: "restore",
      outputPath: OUTPUT_PATH,
      verdict: "output-missing",
    });
    expect(await readFile(join(root, OUTPUT_PATH))).toEqual(before);
    expect(
      await readFile(join(root, ".agents/skills/skillset.lock"), "utf8")
    ).toBe(lockBefore);
  });

  it("refuses to discard a hand-edited output and names it", async () => {
    const root = await seededFixture();
    const edited = `${await readFile(join(root, OUTPUT_PATH), "utf8")}\nHand edit.\n`;
    await writeFile(join(root, OUTPUT_PATH), edited);

    const result = await buildSkillsetResult(root, { repair: {} });

    expect(result.ok).toBe(false);
    expect(result.repair?.preserved).toContain(OUTPUT_PATH);
    expect(result.outputState.blockers).toContainEqual({
      code: "managed-output-edit-preserved",
      path: OUTPUT_PATH,
    });
    expect(await readFile(join(root, OUTPUT_PATH), "utf8")).toBe(edited);
  });

  it("overwrites a hand-edited output when the caller confirms", async () => {
    const root = await seededFixture();
    const generated = await readFile(join(root, OUTPUT_PATH), "utf8");
    await writeFile(join(root, OUTPUT_PATH), `${generated}\nHand edit.\n`);

    const result = await buildSkillsetResult(root, {
      repair: { discardEdits: true },
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(root, OUTPUT_PATH), "utf8")).toBe(generated);
  });

  it("refuses when the output and its source both moved", async () => {
    const root = await seededFixture();
    await writeFile(
      join(root, OUTPUT_PATH),
      `${await readFile(join(root, OUTPUT_PATH), "utf8")}\nOutput edit.\n`
    );
    await writeFile(
      join(root, ".skillset/skills/demo/SKILL.md"),
      `${SOURCE_SKILL}\nSource edit.\n`
    );

    const result = await buildSkillsetResult(root, {
      repair: { discardEdits: true },
    });

    expect(result.ok).toBe(false);
    expect(result.repair?.refused).toContain(OUTPUT_PATH);
    expect(result.outputState.blockers).toContainEqual({
      code: "managed-output-diverged",
      path: OUTPUT_PATH,
    });
  });

  it("names the lock, not the output, when the lock's provenance is broken", async () => {
    const root = await seededFixture();
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      items: { outputHash?: string }[];
    };
    const [firstItem] = lock.items;
    if (firstItem === undefined) throw new Error("seeded lock has no items");
    // Rewrite a recorded hash without refreshing provenanceHash, so the lock
    // parses but can no longer be trusted.
    firstItem.outputHash = `sha256:${"0".repeat(64)}`;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    await writeFile(
      join(root, ".skillset/skills/demo/SKILL.md"),
      `${SOURCE_SKILL}\nSource moved.\n`
    );

    const result = await buildSkillsetResult(root, { repair: {} });

    expect(result.ok).toBe(false);
    expect(result.repair?.lockUntrusted).toContain(OUTPUT_PATH);
    expect(result.repair?.preserved).not.toContain(OUTPUT_PATH);
    expect(result.outputState.blockers).toContainEqual({
      code: "managed-lock-untrusted",
      path: OUTPUT_PATH,
    });
  });

  it("reports an output whose source unit was deleted", async () => {
    const root = await seededFixture();
    await rm(join(root, ".skillset/skills/demo"), { recursive: true });
    await mkdir(join(root, ".skillset/skills/other"), { recursive: true });
    await writeFile(
      join(root, ".skillset/skills/other/SKILL.md"),
      "---\nname: other\ndescription: Another skill.\n---\n\nBody.\n"
    );

    const result = await buildSkillsetResult(root, { repair: {} });

    expect(result.repair?.verdicts).toContainEqual({
      action: "remove",
      outputPath: OUTPUT_PATH,
      verdict: "output-obsolete",
    });
  });

  it("writes only the paths a scoped repair names", async () => {
    const root = await seededFixture();
    const otherOutput = ".agents/skills/other/SKILL.md";
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lockBefore = await readFile(lockPath, "utf8");
    const otherBefore = await readFile(join(root, otherOutput), "utf8");
    await writeFile(
      join(root, ".skillset/skills/demo/SKILL.md"),
      `${SOURCE_SKILL}\nSource moved.\n`
    );
    await writeFile(
      join(root, ".skillset/skills/other/SKILL.md"),
      `${OTHER_SKILL}\nAlso moved.\n`
    );

    const result = await buildSkillsetResult(root, {
      repair: { paths: [OUTPUT_PATH] },
    });

    expect(result.ok).toBe(true);
    expect(result.writes.writtenPaths).toContain(OUTPUT_PATH);
    expect(result.writes.writtenPaths).not.toContain(otherOutput);
    // Out-of-scope output keeps its old bytes, and the lock keeps its entry.
    expect(await readFile(join(root, otherOutput), "utf8")).toBe(otherBefore);
    expect(await readFile(lockPath, "utf8")).not.toBe(lockBefore);
  });

  it("gates every sibling that a scoped repair would write", async () => {
    const root = await seededFixture();
    const companion = join(root, COMPANION_PATH);
    const edited = `${await readFile(companion, "utf8")}Hand edit.\n`;
    await rm(join(root, OUTPUT_PATH));
    await writeFile(companion, edited);

    const result = await buildSkillsetResult(root, {
      repair: { paths: [OUTPUT_PATH] },
    });

    expect(result.ok).toBe(false);
    expect(result.repair?.lockUntrusted).toContain(COMPANION_PATH);
    expect(await readFile(companion, "utf8")).toBe(edited);
    await expect(Bun.file(join(root, OUTPUT_PATH)).exists()).resolves.toBeFalse();
  });

  it("normalizes a repo-relative scoped repair path", async () => {
    const root = await seededFixture();
    await rm(join(root, OUTPUT_PATH));

    const result = await buildSkillsetResult(root, {
      repair: { paths: [`./${OUTPUT_PATH}`] },
    });

    expect(result.ok).toBe(true);
    await expect(Bun.file(join(root, OUTPUT_PATH)).exists()).resolves.toBeTrue();
  });

  it("rejects a scoped repair path that is not managed", async () => {
    const root = await seededFixture();
    const unmanaged = ".agents/skills/missing/SKILL.md";

    const result = await buildSkillsetResult(root, {
      repair: { paths: [unmanaged] },
    });

    expect(result.ok).toBe(false);
    expect(result.outputState.blockers).toContainEqual({
      code: "repair-path-unmanaged",
      path: unmanaged,
    });
  });

  it("maps scoped repair paths into an isolated projection", async () => {
    const root = await seededFixture();
    const context = createOperationalPathContext(root);
    const isolatedPath = `${ISOLATED_OUT_ROOT}/${OUTPUT_PATH}`;
    const absolutePath = resolveOperationalPath(context, isolatedPath);
    await buildSkillsetResult(root, { isolated: true });
    const before = await readFile(absolutePath);
    await rm(absolutePath);

    const result = await buildSkillsetResult(root, {
      isolated: true,
      repair: { paths: [OUTPUT_PATH] },
    });

    expect(result.ok).toBe(true);
    expect(result.writes.writtenPaths).toContain(isolatedPath);
    expect(await readFile(absolutePath)).toEqual(before);
  });

  it("leaves a scoped restore's lock byte-identical", async () => {
    const root = await seededFixture();
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lockBefore = await readFile(lockPath, "utf8");
    await rm(join(root, OUTPUT_PATH));

    const result = await buildSkillsetResult(root, {
      repair: { paths: [OUTPUT_PATH] },
    });

    expect(result.ok).toBe(true);
    expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
  });

  it("leaves the lock's build provenance alone", async () => {
    const root = await seededFixture();
    await rm(join(root, OUTPUT_PATH));

    await buildSkillsetResult(root, { repair: {} });

    const lock = JSON.parse(
      await readFile(join(root, ".agents/skills/skillset.lock"), "utf8")
    ) as { readonly buildMode?: string };
    expect(lock.buildMode).toBe("updated");
  });
});

const SOURCE_SKILL = `---
name: demo
description: Demo skill for repair verdicts.
---

Body.`;

const OTHER_SKILL = `---
name: other
description: A second skill, so scoping has something to leave alone.
---

Body.`;

const FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: core-repair-root
claude: false
codex: true
`,
  ".skillset/skills/demo/SKILL.md": SOURCE_SKILL,
  ".skillset/skills/demo/references/note.md": "Reference note.\n",
  ".skillset/skills/other/SKILL.md": OTHER_SKILL,
};

/** A fixture whose generated output and lock are already current. */
async function seededFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-core-repair-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(FIXTURE)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  const seeded = await buildSkillsetResult(root);
  if (!seeded.ok) throw new Error("repair fixture failed to build");
  return root;
}
