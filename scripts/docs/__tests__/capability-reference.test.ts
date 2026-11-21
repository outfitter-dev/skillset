import { expect, test } from "bun:test";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { TARGET_NAMES } from "@skillset/schema";

import {
  compareCapability,
  listCapabilities,
} from "../../../packages/core/src/capability-crosswalk";
import { scanGeneratedPublicTree } from "../../public-closure-guard";
import { createTestFixtureRoot } from "../../test-helpers/fixture-root";
import { renderCapabilityReference } from "../capability-reference";

const REPO = path.join(import.meta.dir, "../../..");
const PUBLIC_SKILL = "plugins/skillset/skills/skillset-provider-capabilities";

test("the snapshot preserves each concept, exact alias, and scoped target verdict", () => {
  const snapshot = renderCapabilityReference();
  expect(snapshot).toBe(renderCapabilityReference());
  for (const definition of listCapabilities()) {
    const section = snapshot
      .split(`\n## ${definition.id}\n`)[1]
      ?.split("\n## ")[0];
    expect(section).toBeDefined();
    for (const alias of definition.aliases) {
      expect(section).toContain(`\`${alias}\``);
    }
    for (const row of compareCapability(definition, TARGET_NAMES)) {
      const targetSection = section
        ?.split(`\n### ${row.target}: ${row.featureId}\n`)[1]
        ?.split("\n### ")[0];
      expect(targetSection).toContain(`Fidelity: **${row.fidelity}**`);
      expect(targetSection).toContain(row.authorityHash);
      for (const limitation of row.limitations) {
        expect(targetSection).toContain(limitation);
      }
    }
  }
});

test("an isolated copy of the shipped skill contains a self-contained fallback", async () => {
  const consumer = await createTestFixtureRoot("public-skill-fallback-");
  const bundled = path.join(consumer, PUBLIC_SKILL);
  await cp(path.join(REPO, PUBLIC_SKILL), bundled, { recursive: true });
  const contents = await readFile(path.join(bundled, "SKILL.md"), "utf-8");
  const relativeReference = "references/provider-capabilities.md";
  expect(contents).toContain(`(${relativeReference})`);
  const snapshot = await readFile(
    path.join(bundled, relativeReference),
    "utf-8"
  );
  expect(snapshot).toBe(renderCapabilityReference());
  expect(snapshot).toContain("Fidelity: **provider-only**");
  expect(snapshot).toContain("Fidelity: **unavailable**");
  expect(snapshot).toContain("Fidelity: **unknown**");
  expect(snapshot).not.toMatch(/(?:apps|packages)\/|__tests__|skillset-dev/u);
  await writeFile(path.join(consumer, "package.json"), "{}\n");
  const result = await scanGeneratedPublicTree(consumer);
  expect(result.scannedFiles).toBeGreaterThan(0);
  expect(result.violations).toEqual([]);
});
