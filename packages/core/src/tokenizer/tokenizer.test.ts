import { describe, expect, it } from "bun:test";
import { tokenizePrompt } from "./index";

describe("tokenizePrompt", () => {
  it("finds aliases with boundaries", () => {
    const tokens = tokenizePrompt("please $frontend-design and $ship!");
    expect(tokens.map((t) => t.alias)).toEqual(["frontend-design", "ship"]);
  });

  it("ignores code fences and inline code", () => {
    const prompt = "````\n$frontend-design\n```` and `$ship` then $real";
    const tokens = tokenizePrompt(prompt);
    expect(tokens.map((t) => t.alias)).toEqual(["real"]);
  });

  it("parses namespace:alias format", () => {
    const tokens = tokenizePrompt("use $Project:FrontEnd_Design for this");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.namespace).toBe("project");
    expect(tokens[0]?.alias).toBe("front-end-design");
    expect(tokens[0]?.raw).toBe("$Project:FrontEnd_Design");
  });

  it("returns empty array for prompt without tokens", () => {
    const tokens = tokenizePrompt("just a normal prompt without skills");
    expect(tokens).toEqual([]);
  });

  it("handles multiple namespaced tokens", () => {
    const tokens = tokenizePrompt("$user:auth $project:api $plugin:mcp");
    expect(tokens.map((t) => t.namespace)).toEqual([
      "user",
      "project",
      "plugin",
    ]);
    expect(tokens.map((t) => t.alias)).toEqual(["auth", "api", "mcp"]);
  });

  it("does not match tokens embedded in words", () => {
    const tokens = tokenizePrompt("check$skill and$other");
    expect(tokens).toEqual([]);
  });

  it("matches tokens at start and end of prompt", () => {
    const tokens = tokenizePrompt("$start some text $end");
    expect(tokens.map((t) => t.alias)).toEqual(["start", "end"]);
  });

  it("normalizes non-kebab-case tokens", () => {
    const tokens = tokenizePrompt(
      "$my_skill $AnotherSkill $double__underscore $bad--token"
    );
    expect(tokens.map((t) => t.alias)).toEqual([
      "my-skill",
      "another-skill",
      "double-underscore",
      "bad-token",
    ]);
  });

  it("does NOT match old w/ syntax", () => {
    const tokens = tokenizePrompt("w/debug w/frontend");
    expect(tokens).toEqual([]);
  });

  it("parses explicit set: prefix", () => {
    const tokens = tokenizePrompt("load $set:frontend");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("set");
    expect(tokens[0]?.alias).toBe("frontend");
    expect(tokens[0]?.raw).toBe("$set:frontend");
  });

  it("parses explicit skill: prefix", () => {
    const tokens = tokenizePrompt("load $skill:auth");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("skill");
    expect(tokens[0]?.alias).toBe("auth");
    expect(tokens[0]?.raw).toBe("$skill:auth");
  });

  it("parses kind with namespace", () => {
    const tokens = tokenizePrompt("use $set:project:frontend");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("set");
    expect(tokens[0]?.namespace).toBe("project");
    expect(tokens[0]?.alias).toBe("frontend");
    expect(tokens[0]?.raw).toBe("$set:project:frontend");
  });

  it("does NOT match invalid patterns", () => {
    const invalid = "$bad/thing $trailing:colon: $-dash";
    const tokens = tokenizePrompt(invalid);
    expect(tokens).toEqual([]);
  });

  it("does NOT match incomplete kind prefixes", () => {
    // $set: and $skill: with trailing colon but no ref should not match
    // Note: This is handled by the regex requiring at least one segment after the colon
    const invalid = "use $set: and $skill: patterns";
    const tokens = tokenizePrompt(invalid);
    expect(tokens).toEqual([]);
  });

  it("handles multi-segment namespaces", () => {
    const tokens = tokenizePrompt("$project:deep:nested:skill");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.namespace).toBe("project");
    expect(tokens[0]?.alias).toBe("deep:nested:skill");
  });

  it("parses $set:frontend-design with both kind and namespace", () => {
    const tokens = tokenizePrompt("apply $set:frontend-design please");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("set");
    expect(tokens[0]?.alias).toBe("frontend-design");
    expect(tokens[0]?.raw).toBe("$set:frontend-design");
  });

  it("parses all variations of frontend-design syntax", () => {
    const tokens = tokenizePrompt(
      "$frontend-design $project:frontend-design $set:frontend-design"
    );
    expect(tokens).toHaveLength(3);
    expect(tokens.map((t) => t.raw)).toEqual([
      "$frontend-design",
      "$project:frontend-design",
      "$set:frontend-design",
    ]);
  });
});
