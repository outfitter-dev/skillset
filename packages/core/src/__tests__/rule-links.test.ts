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

  it("rebases a link to the scope directory itself", () => {
    expect(
      rebaseRuleLinks("[here](.)", { outputDir: ".claude", scopeDir: "" })
    ).toBe("[here](..)");
  });
});
