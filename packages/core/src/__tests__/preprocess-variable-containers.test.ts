import { expect, test } from "bun:test";
import { Parser, type Node } from "commonmark";
import { preprocessText, type PreprocessContext } from "../preprocess";

const token = "{{this.value}}";
const tick = String.fromCharCode(96);
const value = { answer: 42, nested: [true, "text"] };
const context: PreprocessContext = { frontmatter: { value }, rootPath: "/virtual", sourceRoot: ".skillset", sourcePath: "/virtual/source.md" };

function fenced(source: string): { literal: string; ancestry: string[] }[] {
  const result: { literal: string; ancestry: string[] }[] = [];
  const walker = new Parser().parse(source).walker();
  for (let event = walker.next(); event !== null; event = walker.next()) {
    if (!event.entering || event.node.type !== "code_block" || event.node.info === null) continue;
    const ancestry: string[] = [];
    for (let parent: Node | null = event.node.parent; parent !== null; parent = parent.parent) ancestry.push(parent.type);
    result.push({ literal: event.node.literal ?? "", ancestry });
  }
  return result;
}

for (const [name, source] of [
  ["four-column list", "-   item\n\n    ~~~\n    " + token + "\n    ~~~"],
  ["ordered list", "7. item\n\n   ~~~\n   " + token + "\n   ~~~"],
  ["wide ordered opener", "123. ~~~\n     " + token + "\n     ~~~"],
  ["same-line list opener", "- ~~~\n  " + token + "\n  ~~~"],
  ["nested list opener", "- - ~~~\n    " + token + "\n    ~~~"],
  ["quote", "> ~~~\n> " + token + "\n> ~~~"],
  ["compact quote", ">~~~\n>" + token + "\n>~~~"],
  ["compact nested quote", ">>~~~\n>>" + token + "\n>>~~~"],
  ["compact quote list", ">- ~~~\n>   " + token + "\n>   ~~~"],
  ["compact quote tab list", ">-\t~~~\n>    " + token + "\n>    ~~~"],
  ["quote list quote", "> - > ~~~\n>   > " + token + "\n>   > ~~~"],
  ["list quote", "- > ~~~\n  > " + token + "\n  > ~~~"],
  ["nested quote", "> > ~~~\n> > " + token + "\n> > ~~~"],
  ["literal quote in code", "> ~~~\n> > " + token + "\n> ~~~"],
  ["midline and repeated tokens", "> ~~~\n> prefix " + token + " and " + token + " suffix\n> ~~~"],
  ["tab list opener", "-\t~~~\n\t" + token + "\n\t~~~"],
  ["tab quote opener", ">\t~~~\n>\t" + token + "\n>\t~~~"],
  ["partially consumed body tab", "- item\n\n  ~~~\n\t" + token + "\n  ~~~"],
  ["extra fence indentation", ">   ~~~\n>   " + token + "\n>   ~~~"],
  ["unclosed quote", "> ~~~\n> " + token],
  ["backticks", "> " + tick.repeat(3) + "json\n> " + token + "\n> " + tick.repeat(4)],
] as const) {
  test("variable JSON stays in its original fenced container: " + name, async () => {
    const before = fenced(source);
    expect(before).toHaveLength(1);
    const output = await preprocessText(source, context);
    expect(fenced(output)).toEqual(before.map((block) => ({ ...block, literal: block.literal.replaceAll(token, JSON.stringify(value, null, 2)) })));
    expect(output).not.toContain(token);
  });
}

test("arrays and empty values keep the quote fence and normalized newline behavior", async () => {
  for (const data of [[1, 2], [], {}]) {
    const source = "> ~~~\r\n> " + token + "\r\n> ~~~";
    const output = await preprocessText(source, { ...context, frontmatter: { value: data } });
    expect(fenced(output)[0]?.literal).toBe(JSON.stringify(data, null, 2) + "\n");
    expect(output).not.toContain("\r");
  }
});

test("root, prose, inline, sidecar and scalar variable policies stay unchanged", async () => {
  const pretty = JSON.stringify(value, null, 2);
  expect(await preprocessText("~~~\n" + token + "\n~~~", context)).toBe("~~~\n" + pretty + "\n~~~");
  expect(await preprocessText(token, context)).toBe(tick.repeat(3) + "json\n" + pretty + "\n" + tick.repeat(3));
  expect(await preprocessText(tick + token + tick, context)).toBe(tick + tick.repeat(3) + "json\n" + pretty + "\n" + tick.repeat(4));
  expect(await preprocessText(token, { ...context, sourcePath: "/virtual/source.json" })).toBe(JSON.stringify(value));
  for (const data of ["plain", 2, true, null]) {
    expect(await preprocessText("> ~~~\n> " + token + "\n> ~~~", { ...context, frontmatter: { value: data } }))
      .toBe("> ~~~\n> " + String(data) + "\n> ~~~");
  }
});

test("container ending leaves a later object in prose", async () => {
  const output = await preprocessText("> ~~~\n> " + token + "\n\n" + token, context);
  const blocks = fenced(output);
  expect(blocks).toHaveLength(2);
  expect(blocks[0]?.ancestry).toEqual(["block_quote", "document"]);
  expect(blocks[1]?.ancestry).toEqual(["document"]);
  expect(blocks.map((block) => block.literal)).toEqual([JSON.stringify(value, null, 2) + "\n", JSON.stringify(value, null, 2) + "\n"]);
});

test("an unclosed list fence does not classify a later prose object as code", async () => {
  for (const [item, prefix] of [["- item", "  "], ["7. item", "   "], ["-   item", "    "]]) {
    const source = item + "\n\n" + prefix + "~~~\n" + prefix + token + "\n\n" + token;
    const output = await preprocessText(source, context);
    expect(output.endsWith(tick.repeat(3) + "json\n" + JSON.stringify(value, null, 2) + "\n" + tick.repeat(3))).toBe(true);
    expect(fenced(output).at(-1)?.ancestry).toEqual(["document"]);
  }
});

test("literal escapes, explicit variables and preprocessing opt-out retain their policies", async () => {
  expect(await preprocessText("> ~~~\n> {{{this.value}}}\n> ~~~", context)).toBe("> ~~~\n> " + token + "\n> ~~~");
  expect(await preprocessText("> ~~~\n> {{custom}}\n> ~~~", { ...context, variables: { custom: "line1\nline2" } }))
    .toBe("> ~~~\n> line1\nline2\n> ~~~");
  const source = "> ~~~\n> " + token + "\n> ~~~";
  expect(await preprocessText(source, { ...context, frontmatter: { value, skillset: { preprocess: false } } })).toBe(source);
});

test("container opener-info interpolation preserves its existing rendering policy", async () => {
  const pretty = JSON.stringify(value, null, 2);
  const list = "7. item\n\n   ~~~ " + token + "\n   body\n   ~~~";
  expect(await preprocessText(list, context)).toBe(list.replace(token, pretty));
  const quote = "> ~~~ " + token + "\n> body\n> ~~~";
  expect(await preprocessText(quote, context)).toBe(quote.replace(token, tick.repeat(3) + "json\n" + pretty + "\n" + tick.repeat(3)));
});
