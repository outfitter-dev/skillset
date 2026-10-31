import { expect, test } from "bun:test";
import { mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TARGET_NAMES } from "@skillset/schema";
import { compareCapability, findCapabilities, listCapabilities } from "@skillset/core/internal/capability-crosswalk";
import { buildPublicCapabilityCatalog, generatePublicCapabilityReference, projectCapabilityComparison, PUBLIC_CAPABILITY_REFERENCE } from "../public-capability-reference";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

test("SET-448: public fallback derives every capability and comparison from Core", () => {
  const catalog = buildPublicCapabilityCatalog();
  expect(catalog).toEqual(buildPublicCapabilityCatalog());
  expect(catalog.map(c => c.id)).toEqual(listCapabilities().map(c => c.id));
  for (const definition of listCapabilities()) {
    const entry = catalog.find(c => c.id === definition.id)!;
    expect(entry.aliases).toEqual(definition.aliases);
    expect(entry.rows).toEqual(compareCapability(definition, TARGET_NAMES).map(projectCapabilityComparison));
  }
  expect(catalog.filter(c => c.aliases.includes("AGENTS.md")).map(c => c.id)).toEqual(findCapabilities("AGENTS.md").map(c => c.id));
  const text = JSON.stringify(catalog);
  expect(text).not.toMatch(/packages\/|apps\/|__tests__|skillset-dev|Implementation proof:/);
  expect(catalog.flatMap(c => c.rows).some(r => r.fidelity === "provider-only")).toBe(true);
  expect(catalog.flatMap(c => c.rows).some(r => r.fidelity === "unknown")).toBe(true);
});

test("SET-448: projection preserves unknown and stale evidence without inventing support", () => {
  const row = compareCapability(listCapabilities()[0]!, TARGET_NAMES)[0]!;
  const projected = projectCapabilityComparison({ ...row, fidelity: "unknown", evidenceStatus: "stale", limitations: ["Reviewed evidence changed."] });
  expect(projected.fidelity).toBe("unknown");
  expect(projected.evidenceStatus).toBe("stale");
  expect(projected.limitations).toEqual(["Reviewed evidence changed."]);
});

test("SET-448: generated reference check catches stale content and never rewrites it", async () => {
  const root = await createTestFixtureRoot("skillset-capability-reference-");
  await generatePublicCapabilityReference(root);
  await generatePublicCapabilityReference(root, { check: true });
  const path = join(root, PUBLIC_CAPABILITY_REFERENCE);
  const content = await readFile(path, "utf8");
  await writeFile(path, content + "stale\n");
  await expect(generatePublicCapabilityReference(root, { check: true })).rejects.toThrow("stale");
  expect(await readFile(path, "utf8")).toBe(content + "stale\n");
});

test("SET-448: generation rejects unmanaged contents and symlink write targets", async () => {
  const root = await createTestFixtureRoot("skillset-capability-reference-safety-");
  const path = join(root, PUBLIC_CAPABILITY_REFERENCE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "authored notes\n");
  await expect(generatePublicCapabilityReference(root)).rejects.toThrow("unmanaged");
  const other = await createTestFixtureRoot("skillset-capability-reference-outside-");
  await unlink(path);
  await symlink(join(other, "reference.md"), path);
  await expect(generatePublicCapabilityReference(root)).rejects.toThrow("symbolic link");
});
