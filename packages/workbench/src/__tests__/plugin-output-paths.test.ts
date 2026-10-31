import { expect, test } from "bun:test";
import { checkWorkbenchSourceContract } from "../index";

test("workspace editor reports malformed consumed plugin output path", () => {
  const content = 'skillset:\n  outputs:\n    plugins:\n      codex: 42\n';
  const diagnostics = checkWorkbenchSourceContract({ content, kind: "workspace-config", path: "skillset.yaml" });
  expect(diagnostics.some(item => item.message.includes("outputs.plugins.codex"))).toBe(true);
});
