import { describe, expect, test } from "bun:test";

import { skillsetSourceReferenceDescriptors } from "@skillset/schema";

import {
  assertRewrittenSourceReference,
  assertSourceReferenceContract,
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
      assertRewrittenSourceReference("skill-resource-destination")
    ).toThrow("must use rewrite policy");
  });
});
