import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_ROOT = path.join(import.meta.dir, "..");

test("SET-298: prompt owners and adapter primitives stay intentionally complete", async () => {
  const sourceFiles: Array<{ readonly name: string; readonly text: string }> =
    [];
  for await (const name of new Bun.Glob("*.ts").scan(SOURCE_ROOT)) {
    sourceFiles.push({
      name,
      text: await readFile(path.join(SOURCE_ROOT, name), "utf8"),
    });
  }

  expect(
    sourceFiles
      .filter(
        ({ name, text }) =>
          name !== "interactive-session.ts" &&
          text.includes("createInteractiveSession")
      )
      .map(({ name }) => name)
      .sort()
  ).toEqual([
    "create-cli.ts",
    "distribution-cli.ts",
    "init-cli.ts",
    "inspect-cli.ts",
    "recovery-cli.ts",
    "source-cli.ts",
    "test-cli.ts",
  ]);

  const used = new Set<string>();
  for (const { text } of sourceFiles) {
    for (const match of text.matchAll(
      /\b(?:interactiveSession|session)\.prompts\.([A-Za-z]+)/gu
    )) {
      if (match[1] !== undefined) used.add(match[1]);
    }
  }
  expect([...used].sort()).toEqual([
    "checkbox",
    "confirm",
    "groupedCheckbox",
    "input",
    "search",
    "searchCheckbox",
    "select",
  ]);
});
