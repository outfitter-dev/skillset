import { describe, expect, it } from "bun:test";

import { rebaseRuleLinks } from "../rule-links";

describe("rebaseRuleLinks [SET-755]", () => {
  it("leaves links unchanged when the output sits in the rule's scope directory", () => {
    const body = "Read [tenets](docs/project/tenets.md) first.";
    expect(rebaseRuleLinks(body, { scopeDir: "", outputDir: "." })).toBe(body);
    expect(rebaseRuleLinks(body, { scopeDir: "apps", outputDir: "apps" })).toBe(body);
  });

  it("rebases relative links from the scope directory to a deeper output", () => {
    expect(
      rebaseRuleLinks("Read [tenets](docs/project/tenets.md#why) and ![logo](img/logo.png).", {
        outputDir: ".claude",
        scopeDir: "",
      })
    ).toBe("Read [tenets](../docs/project/tenets.md#why) and ![logo](../img/logo.png).");
  });

  it("resolves a scoped rule's links against its scope directory", () => {
    expect(
      rebaseRuleLinks("See [the readme](README.md) and [root](../CONTRIBUTING.md).", {
        outputDir: ".claude/rules/apps",
        scopeDir: "apps",
      })
    ).toBe("See [the readme](../../../apps/README.md) and [root](../../../CONTRIBUTING.md).");
  });

  it("keeps URLs, anchors, absolute paths, and template references", () => {
    const body = [
      "[site](https://example.com/a.md)",
      "[mail](mailto:team@example.com)",
      "[section](#commands)",
      "[abs](/docs/a.md)",
      "[token]({{skillset.repo_root}}/docs/a.md)",
      "[angle](<docs/a b.md>)",
    ].join("\n");
    expect(rebaseRuleLinks(body, { outputDir: ".claude", scopeDir: "" })).toBe(body);
  });

  it("skips links inside inline code and fenced code blocks", () => {
    const body = [
      "Write `[x](docs/a.md)` literally.",
      "",
      "```markdown",
      "[x](docs/a.md)",
      "```",
      "",
      "[y](docs/b.md)",
    ].join("\n");
    expect(rebaseRuleLinks(body, { outputDir: ".claude", scopeDir: "" })).toBe(
      [
        "Write `[x](docs/a.md)` literally.",
        "",
        "```markdown",
        "[x](docs/a.md)",
        "```",
        "",
        "[y](../docs/b.md)",
      ].join("\n")
    );
  });

  it("rebases titled links, nested image links, queries, and reference definitions", () => {
    const base = { outputDir: ".claude", scopeDir: "" };
    expect(rebaseRuleLinks('[a](docs/a.md "Title") [b](docs/b.md (Note))', base)).toBe(
      '[a](../docs/a.md "Title") [b](../docs/b.md (Note))'
    );
    expect(rebaseRuleLinks("[![badge](img/b.svg)](docs/a.md)", base)).toBe(
      "[![badge](../img/b.svg)](../docs/a.md)"
    );
    expect(rebaseRuleLinks("[guide](docs/a.md?raw=1#top)", base)).toBe(
      "[guide](../docs/a.md?raw=1#top)"
    );
    expect(rebaseRuleLinks('See [the guide][g].\n\n[g]: docs/guide.md "Guide"', base)).toBe(
      'See [the guide][g].\n\n[g]: ../docs/guide.md "Guide"'
    );
  });

  it("matches code fences and spans the way Markdown does", () => {
    const base = { outputDir: ".claude", scopeDir: "" };
    const nestedFence = ["````markdown", "```", "[x](docs/a.md)", "```", "````", "[y](docs/b.md)"].join("\n");
    expect(rebaseRuleLinks(nestedFence, base)).toBe(nestedFence.replace("(docs/b.md)", "(../docs/b.md)"));
    const tildeInBacktick = ["```", "~~~", "[x](docs/a.md)", "```", "[y](docs/b.md)"].join("\n");
    expect(rebaseRuleLinks(tildeInBacktick, base)).toBe(
      tildeInBacktick.replace("(docs/b.md)", "(../docs/b.md)")
    );
    const doubleTick = "Use ``a `b` [x](docs/a.md)`` here, then [y](docs/b.md).";
    expect(rebaseRuleLinks(doubleTick, base)).toBe(doubleTick.replace("(docs/b.md)", "(../docs/b.md)"));
  });

  it("rebases a link to the scope directory itself", () => {
    expect(
      rebaseRuleLinks("[here](.)", { outputDir: ".claude", scopeDir: "" })
    ).toBe("[here](..)");
  });
});
