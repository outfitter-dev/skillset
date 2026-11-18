import { expect, test } from "bun:test";

import { TARGET_NAMES } from "@skillset/schema";

import { checkWorkbenchSourceContract } from "../index";

const target = TARGET_NAMES[0];
const check = (content: string) =>
  checkWorkbenchSourceContract({
    content,
    kind: "workspace-config",
    path: "skillset.yaml",
  });

for (const entries of [
  ["bogus"],
  [target, "bogus"],
  [target, "bogus", target],
]) {
  test(`compile target suggestion supplies a valid array for ${entries.join(", ")}`, () => {
    const diagnostics = check(`compile:\n  targets: [${entries.join(", ")}]\n`);
    const unsupported = diagnostics.find(
      (diagnostic) => diagnostic.message === "unsupported compile target bogus"
    );
    expect(unsupported?.fix?.kind).toBe("suggestion");
    const message = unsupported?.fix?.message ?? "";
    const example = message.match(/`(compile:[^`]+)`/)?.[1];
    expect(example).toBe(`compile:\\n  targets: [${TARGET_NAMES.join(", ")}]`);
    expect(check(example!.replaceAll("\\n", "\n"))).toEqual([]);
    expect(message).not.toContain("targets: true");
    expect(message).not.toContain("targets: false");
    expect(message).not.toContain("targets: { ... }");
    if (entries.length === 3) {
      expect(
        diagnostics.some((diagnostic) =>
          diagnostic.message.includes("duplicate")
        )
      ).toBe(true);
    }
  });
}

test("ordinary provider overrides retain boolean/object guidance", () => {
  const diagnostics = check(`${target}: []\n`);
  expect(diagnostics[0]?.fix).toEqual({
    kind: "suggestion",
    message: `Use \`${target}: true\`, \`${target}: false\`, or \`${target}: { ... }\`.`,
  });
  const skill = checkWorkbenchSourceContract({
    content: `---\nname: demo\ndescription: Demo.\n${target}: []\n---\nBody.\n`,
    kind: "skill",
    path: ".skillset/skills/demo/SKILL.md",
  });
  expect(skill.find((diagnostic) => diagnostic.fix !== undefined)?.fix).toEqual(
    diagnostics[0]?.fix
  );
});
