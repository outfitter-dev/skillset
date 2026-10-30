import { expect, test } from "bun:test";
import { join } from "node:path";
import type { ImportNormalization } from "@skillset/schema";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResultWithAuthority } from "../build";
import { captureManifestIdentityCandidates, manifestIdentityComparison, qualifyManifestIdentityRoundTrips } from "../import-manifest-roundtrip";
import type { BuildGraph } from "../types";

const entries: readonly ImportNormalization[] = ["name", "description"].map((field) => ({
  code: field === "name" ? "manifest.name" : "manifest.description", dialect: "claude", occurrences: 1, fidelity: "unknown",
  source: { path: ".claude-plugin/plugin.json", pointer: `/${field}` },
  destination: { path: ".skillset/plugins/demo/skillset.yaml", pointer: `/skillset/${field}` }, evidence: ["test assignment"],
}));
const native = { name: "demo", description: "Exact description." };
const candidates = captureManifestIdentityCandidates(entries, native);

async function projection(extra = "") {
  const root = await createTestFixtureRoot("skillset-roundtrip-proof-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), `skillset:\n  name: demo\n  description: Exact description.\n${extra}`);
  let graph: BuildGraph | undefined;
  const build = await buildSkillsetResultWithAuthority(root, { isolated: true }, {}, [], { afterRender: (value) => { graph = value; } });
  expect(build.ok).toBe(true);
  expect(graph).toBeDefined();
  return { graph: graph!, build };
}

test("missing, stale, unrelated and cross-provider judgments cannot qualify direct metadata", async () => {
  const { graph, build } = await projection();
  const comparison = manifestIdentityComparison()!;
  expect(comparison.fidelity).toBe("exact");
  const proven = qualifyManifestIdentityRoundTrips(entries, candidates, graph, build, comparison);
  expect(proven.every((entry) => entry.roundTrip !== undefined)).toBe(true);
  for (const row of [undefined, { ...comparison, evidenceStatus: "stale" as const }, { ...comparison, fidelity: "unknown" as const }, { ...comparison, capabilityId: "plugin-manifests" }, { ...comparison, target: "cursor" as const }]) {
    expect(qualifyManifestIdentityRoundTrips(proven, candidates, graph, build, row)).toEqual(entries);
  }
});

test("failed or absent actual output cannot qualify even a rendered-looking plan", async () => {
  const { graph, build } = await projection();
  for (const result of [{ ...build, ok: false }, { ...build, data: [] }]) {
    expect(qualifyManifestIdentityRoundTrips(entries, candidates, graph, result, manifestIdentityComparison())).toEqual(entries);
  }
  const different = { ...build, data: build.data.map((file) => file.path.endsWith("/.claude-plugin/plugin.json") ? { ...file, content: new TextEncoder().encode('{"name":"other","description":"Changed."}') } : file) };
  expect(qualifyManifestIdentityRoundTrips(entries, candidates, graph, different, manifestIdentityComparison())).toEqual(entries);
});

for (const [field, extra] of [
  ["name", "claude:\n  manifest:\n    name: demo\n"],
  ["description", "claude:\n  manifest:\n    description: Exact description.\n"],
] as const) {
  test(`same-value native ${field} override is not the direct canonical route`, async () => {
    const { graph, build } = await projection(extra);
    const qualified = qualifyManifestIdentityRoundTrips(entries, candidates, graph, build, manifestIdentityComparison());
    expect(qualified.find((entry) => entry.code === `manifest.${field}`)?.roundTrip).toBeUndefined();
    expect(qualified.filter((entry) => entry.roundTrip !== undefined)).toHaveLength(1);
  });
}

test("listing and portable manifest overrides are excluded even when all strings agree", async () => {
  const { graph, build } = await projection();
  const changedGraph = { ...graph, plugins: graph.plugins.map((plugin) => ({ ...plugin, metadata: { ...plugin.metadata, manifest: { name: "demo" }, listing: { summary: "Exact description." } } })) };
  expect(qualifyManifestIdentityRoundTrips(entries, candidates, changedGraph, build, manifestIdentityComparison())).toEqual(entries);
});

test("canonical graph must match the captured source rather than just the rendered strings", async () => {
  const { graph, build } = await projection();
  const changedGraph = { ...graph, plugins: graph.plugins.map((plugin) => ({ ...plugin, metadata: { ...plugin.metadata, name: "different", description: "different" } })) };
  expect(qualifyManifestIdentityRoundTrips(entries, candidates, changedGraph, build, manifestIdentityComparison())).toEqual(entries);
});

test("candidate capture excludes remaps, fallbacks, other providers and non-string fields", () => {
  for (const patch of [{ code: "manifest.name-remap" as const }, { dialect: "cursor" as const }, { source: { path: ".claude-plugin/plugin.json", pointer: "/fallback" } }]) {
    expect(captureManifestIdentityCandidates([{ ...entries[0]!, ...patch }], native)).toEqual([]);
  }
  expect(captureManifestIdentityCandidates(entries, { name: 12, description: "" })).toEqual([]);
  expect(captureManifestIdentityCandidates(entries, undefined)).toEqual([]);
});
