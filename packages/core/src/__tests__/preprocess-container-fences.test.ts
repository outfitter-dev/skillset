import { expect, test } from "bun:test";
import { Parser } from "commonmark";
import { markdownCodeRanges, rewritePreprocessReferences, type PreprocessContext } from "../preprocess";

const token = "@{{shared:references/a.md}}";
const tick = String.fromCharCode(96);
const context: PreprocessContext = { frontmatter: {}, rootPath: "/virtual", sourceRoot: ".skillset", sourcePath: "/virtual/source.md" };

for (const [name, lines] of [
  ["four-column list", ["-   item", "", "    ~~~", "    " + token, "    ~~~"]],
  ["quote", ["> ~~~", "> " + token, "> ~~~"]],
  ["ordered list", ["12. item", "", "    ~~~text", "    " + token, "    ~~~~"]],
  ["quote list", ["> - ~~~", ">   " + token, ">   ~~~"]],
  ["nested list", ["- item", "  - ~~~", "    " + token, "    ~~~"]],
  ["tab list", ["-\t~~~", "\t" + token, "\t~~~"]],
  ["quote ticks", ["> " + tick.repeat(3), "> " + token, "> " + tick.repeat(3)]],
  ["short closer", ["> ~~~~", "> ~~~", "> " + token, "> ~~~~"]],
  ["wrong closer", ["> ~~~", "> " + tick.repeat(3), "> " + token, "> ~~~"]],
  ["unclosed quote", ["> ~~~", "> " + token]],
] as const) {
  test("container fence protects references: " + name, async () => {
    const source = lines.join("\n");
    const walker = new Parser().parse(source).walker();
    let fenced = false;
    for (let event = walker.next(); event !== null; event = walker.next()) {
      if (event.entering && event.node.type === "code_block" && event.node.info !== null && event.node.literal?.includes(token)) fenced = true;
    }
    expect(fenced).toBe(true);
    const seen: string[] = [];
    expect(await rewritePreprocessReferences(source, context, ({ specifier }) => { seen.push(specifier); return "changed"; })).toBe(source);
    expect(seen).toEqual([]);
  });
}

test("a container-ending unclosed fence does not mask the following block", async () => {
  for (const prefix of ["> ", "    "]) {
    const source = (prefix === "    " ? "-   item\n\n" : "") + prefix + "~~~\n" + prefix + token + "\n\n" + token;
    expect(await rewritePreprocessReferences(source, context, () => "changed"))
      .toBe((source.slice(0, source.lastIndexOf(token)) + "changed").replaceAll(/\r\n?/g, "\n"));
  }
});

test("container fence ranges remain ordered UTF-16 offsets with raw newline variants", async () => {
  for (const newline of ["\n", "\r\n", "\r"]) {
    const source = ["😀", "", "> ~~~", "> " + token, "> ~~~", "", tick + "code" + tick, token].join(newline);
    const ranges = markdownCodeRanges(source);
    expect(ranges).toEqual([[source.indexOf("> ~~~"), source.lastIndexOf("> ~~~") + 5], [source.indexOf(tick), source.lastIndexOf(tick) + 1]]);
    expect(await rewritePreprocessReferences(source, context, () => "changed")).toBe((source.slice(0, source.lastIndexOf(token)) + "changed").replaceAll(/\r\n?/g, "\n"));
  }
});

test("HTML fence-looking lines and inline tilde text keep references active", async () => {
  for (const source of ["<div>\n> ~~~\n" + token + "\n> ~~~\n</div>", "ordinary ~~~ " + token + " ~~~", "| a | b |\n| --- | --- |\n| ~~~ | " + token + " |"] ) {
    expect(await rewritePreprocessReferences(source, context, () => "changed")).toBe(source.replace(token, "changed"));
  }
});
