import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020";

import { getProviderHookEvidence } from "@skillset/registry";
import { hookCatalogSchema } from "@skillset/schema";
import { assessPinnedCapabilityJudgment, capabilityAuthorityHash } from "../../../packages/core/src/capability-fidelity";
import { nativeHookEventName } from "../../../packages/core/src/hook-capabilities";
import { buildHookCatalog } from "../../../packages/core/src/hook-catalog";
import { assertHookCatalogIntegrity, buildHookCatalogArtifacts } from "../../hook-catalog-artifacts";

test("projects the entire pinned inventory without treating name resolution as equivalence", () => {
  const catalog = buildHookCatalog();
  for (const target of catalog.targets) {
    const names = getProviderHookEvidence(target).events
      .map(({ name }) => nativeHookEventName(target, name)).sort();
    expect(Object.keys(catalog.providers[target].events)).toEqual(names);
    expect(catalog.providers[target].installedRuntime).toBe("unknown");
  }

  expect(catalog.events.UserPromptSubmit?.providers).toMatchObject({
    claude: { fidelity: "equivalent", nativeName: "UserPromptSubmit" },
    codex: { fidelity: "equivalent", nativeName: "UserPromptSubmit" },
    cursor: { fidelity: "equivalent", nativeName: "beforeSubmitPrompt" },
  });
  const cursor = catalog.providers.cursor;
  expect(cursor.nativeNamesByAlias.UserPromptSubmit).toEqual(["beforeSubmitPrompt"]);
  expect(cursor.nativeNamesByAlias.beforeSubmitPrompt).toEqual(["beforeSubmitPrompt"]);
  expect(cursor.events.beforeSubmitPrompt?.skillsetEventIds).toEqual(["BeforeSubmitPrompt", "UserPromptSubmit"]);
  expect(catalog.events.BeforeSubmitPrompt?.providers.cursor.fidelity).toBe("unknown");

  expect(catalog.events.WorkspaceOpen?.providers).toMatchObject({
    claude: { fidelity: "unavailable" },
    codex: { fidelity: "unavailable" },
    cursor: { fidelity: "provider-only", nativeName: "workspaceOpen" },
  });
});

test("retains native PreToolUse constraints and makes field-level evidence gaps visible", () => {
  const catalog = buildHookCatalog();
  expect(catalog.providers.claude.events.PreToolUse).toMatchObject({
    matcher: { subject: "tool", evaluation: "exact-list-or-regex" },
    handlerTypes: ["agent", "command", "http", "mcp_tool", "prompt"],
    canBlock: true,
  });
  expect(catalog.providers.codex.events.PreToolUse).toMatchObject({
    matcher: { subject: "tool", evaluation: "provider-native" },
    handlerTypes: ["command"],
    canBlock: true,
    input: { coverage: "field-inventory", schemaRef: { url: expect.stringMatching(/\/[a-f0-9]{40}\//u) } },
  });
  expect(catalog.providers.cursor.events.preToolUse).toMatchObject({
    matcher: { subject: "tool", evaluation: "provider-native" },
    handlerTypes: ["command", "prompt"],
    canBlock: true,
    input: { coverage: "unknown" },
  });
  expect(catalog.events.PreToolUse?.providers.cursor.fidelity).toBe("partial");
});

test("changed authority invalidates only the relationship pinned to it", () => {
  const subject = { trigger: "first" };
  const peer = { trigger: "unchanged" };
  const review = { fidelity: "equivalent", scope: "trigger", reason: "Observed", authorityHash: capabilityAuthorityHash(subject) } as const;
  const peerReview = { ...review, authorityHash: capabilityAuthorityHash(peer) };
  expect(assessPinnedCapabilityJudgment(review, capabilityAuthorityHash(subject)).fidelity).toBe("equivalent");
  expect(assessPinnedCapabilityJudgment(review, capabilityAuthorityHash({ trigger: "changed" })).fidelity).toBe("unknown");
  expect(assessPinnedCapabilityJudgment(peerReview, capabilityAuthorityHash(peer)).fidelity).toBe("equivalent");
  expect(assessPinnedCapabilityJudgment(review, undefined).fidelity).toBe("unknown");
});

test("rejects malformed data, broken aliases, and unpinned schema links", () => {
  const catalog = buildHookCatalog();
  const validate = new Ajv2020({ strict: true }).compile(hookCatalogSchema);
  expect(validate(catalog)).toBe(true);
  expect(validate({ ...catalog, schemaVersion: "v2" })).toBe(false);
  const cursor = { ...catalog.providers.cursor, nativeNamesByAlias: {} };
  expect(() => assertHookCatalogIntegrity({
    ...catalog, providers: { ...catalog.providers, cursor },
  })).toThrow("missing an alias");
  const id = catalog.providers.codex.evidenceIds[0]!;
  expect(() => assertHookCatalogIntegrity({
    ...catalog,
    evidence: { ...catalog.evidence, [id]: { ...catalog.evidence[id]!, urls: ["https://raw.githubusercontent.com/openai/codex/main/schema.json"] } },
  })).toThrow("non-public or unpinned");
});

test("produces byte-identical valid JSON on repeated generation and matches the committed artifacts", async () => {
  const artifacts = buildHookCatalogArtifacts();
  expect(buildHookCatalogArtifacts()).toEqual(artifacts);
  for (const artifact of artifacts) {
    expect(await readFile(new URL(`../../../${artifact.path}`, import.meta.url), "utf8")).toBe(artifact.content);
  }
});
