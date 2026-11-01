import { expect, test } from "bun:test";
import { Parser } from "commonmark";
import { rewritePreprocessReferences, type PreprocessContext } from "../preprocess";

const tick = String.fromCharCode(96);
const token = "@{{shared:references/a.md}}";
const context: PreprocessContext = { frontmatter: {}, rootPath: "/virtual", sourceRoot: ".skillset", sourcePath: "/virtual/source.md" };

test("backticks in opener info do not create a fenced code block", async () => {
  const source = [tick.repeat(3) + "js" + tick, token, tick.repeat(3)].join("\n");
  expect(new Parser().parse(source).firstChild?.type).toBe("paragraph");
  expect(await rewritePreprocessReferences(source, context, () => "active")).toBe(source.replace(token, "active"));
});

test("valid info and backticks in tilde-fence info retain code protection", async () => {
  for (const [open, close] of [[tick.repeat(3) + "js", tick.repeat(3)], ["~~~js" + tick, "~~~"]]) {
    const source = [open, token, close].join("\n");
    expect(await rewritePreprocessReferences(source, context, () => "active")).toBe(source);
  }
});
