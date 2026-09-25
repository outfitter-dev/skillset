import { describe, expect, test } from "bun:test";

import { skillsetSourceReferenceDescriptors } from "@skillset/schema";

import {
  assertRewrittenSourceReference,
  assertSourceReferenceContract,
  sourceReferenceAcceptsSelector,
  sourceReferenceHandler,
} from "../source-reference-contract";

describe("schema-owned source reference contract", () => {
  test("requires one Core handler for every schema descriptor", () => {
    expect(() => assertSourceReferenceContract()).not.toThrow();
    expect(
      skillsetSourceReferenceDescriptors.map((descriptor) => [
        descriptor.id,
        sourceReferenceHandler(descriptor.id),
      ])
    ).toHaveLength(skillsetSourceReferenceDescriptors.length);
  });

  test("uses schema mutation policy as the rewrite gate", () => {
    expect(() => assertRewrittenSourceReference("agent-skills")).not.toThrow();
    expect(() =>
      assertRewrittenSourceReference("internal-plugin-selection")
    ).not.toThrow();
    expect(() =>
      assertRewrittenSourceReference("skill-resource-destination")
    ).toThrow("must use rewrite policy");
  });

  test("checks rewritten selectors against the schema pattern for each contract", () => {
    expect(sourceReferenceAcceptsSelector("configured-draft-selector", "workspace-config", "plugin.tools.skill:demo")).toBe(true);
    expect(sourceReferenceAcceptsSelector("configured-draft-selector", "plugin-config", "plugin.tools.skill:demo")).toBe(false);
    expect(sourceReferenceAcceptsSelector("distribution-source-selector", "workspace-config", "skill:demo")).toBe(true);
    expect(sourceReferenceAcceptsSelector("distribution-source-selector", "workspace-config", "plugin.tools.skill:demo")).toBe(false);
    expect(() =>
      sourceReferenceAcceptsSelector("pending-change-scope", "change-entry", "skill:demo")
    ).toThrow("declares no selector pattern for change-entry");
  });
});
