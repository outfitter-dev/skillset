import { expect, test } from "bun:test";
import { checkWorkbenchSourceContract } from "../index";

test("workspace policy uses shared minimum diagnostic", () => {
  const content = 'changes:\n  reason:\n    minLength: "2"\n';
  expect(checkWorkbenchSourceContract({ content, kind: "workspace-config", path: "skillset.yaml" }).some(item => item.message.includes("minLength must be a positive integer"))).toBe(true);
});
