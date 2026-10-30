import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { InputValidationError } from "../input-validation-error";
import {
  preprocessText,
  resolveMarkedPathReferences,
  rewritePreprocessReferences,
  type PreprocessContext,
} from "../preprocess";

async function fixture(): Promise<PreprocessContext> {
  const rootPath = await createTestFixtureRoot("preprocess-callback-errors-");
  const shared = join(rootPath, ".skillset/shared");
  await mkdir(join(shared, "partials"), { recursive: true });
  await writeFile(join(shared, "reference.md"), "Reference");
  await writeFile(join(shared, "partials/outer.md"), "{{> inner}}");
  await writeFile(join(shared, "partials/inner.md"), "@{{shared:reference.md}}");
  return {
    rootPath,
    sourceRoot: ".skillset",
    sourcePath: join(rootPath, ".skillset/skills/demo/SKILL.md"),
    frontmatter: {},
  };
}

async function rejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}

for (const asynchronous of [false, true]) {
  test(`path callback preserves thrown values through nested partials (async=${asynchronous})`, async () => {
    const context = await fixture();
    const priorInputError = await rejection(preprocessText("{{> missing}}", context));
    for (const failure of [new TypeError("callback"), new InputValidationError("caller data"), priorInputError, "failure", undefined]) {
      const renderPathReference = asynchronous
        ? () => Promise.reject(failure)
        : () => { throw failure; };
      const configured = { ...context, renderPathReference };
      for (const content of ["@{{shared:reference.md}}", "{{> outer}}"] ) {
        expect(await rejection(preprocessText(content, configured))).toBe(failure);
      }
      expect(await rejection(resolveMarkedPathReferences("@{{shared:reference.md}}", configured))).toBe(failure);
    }
  });
}

test("partial transform and direct rewrite retain callback failure identity", async () => {
  const context = await fixture();
  const priorInputError = await rejection(preprocessText("{{> missing}}", context));
  for (const failure of [new TypeError("callback"), new InputValidationError("caller data"), priorInputError, "failure", undefined]) {
    expect(await rejection(preprocessText("{{> outer}}", {
      ...context,
      transformPartialContent: (content) => {
        if (content.startsWith("@")) throw failure;
        return content;
      },
    }))).toBe(failure);
    expect(await rejection(rewritePreprocessReferences("@{{shared:reference.md}}", context, () => { throw failure; }))).toBe(failure);
  }
});

test("successful callbacks and nested source diagnostics keep their behavior", async () => {
  const context = await fixture();
  expect(await preprocessText("{{> outer}}", {
    ...context,
    renderPathReference: async () => "rendered.md",
    transformPartialContent: (content) => content,
  })).toBe("@rendered.md");
  await writeFile(join(context.rootPath, ".skillset/shared/partials/inner.md"), "{{> missing}}");
  const failure = await rejection(preprocessText("{{> outer}}", context));
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(/failed to read partial outer.*failed to read partial inner.*failed to read partial missing/u);
});
