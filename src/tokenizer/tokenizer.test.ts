import { describe, expect, it } from "bun:test";
import { tokenizePrompt } from "./index";

describe("tokenizePrompt", () => {
	it("finds aliases with boundaries", () => {
		const tokens = tokenizePrompt("please w/frontend-design and w/ship!");
		expect(tokens.map((t) => t.alias)).toEqual(["frontend-design", "ship"]);
	});

	it("ignores code fences and inline code", () => {
		const prompt = "````\nw/frontend-design\n```` and `w/ship` then w/real";
		const tokens = tokenizePrompt(prompt);
		expect(tokens.map((t) => t.alias)).toEqual(["real"]);
	});

	it("parses namespace:alias format", () => {
		const tokens = tokenizePrompt("use w/project:frontend-design for this");
		expect(tokens).toHaveLength(1);
		expect(tokens[0]?.namespace).toBe("project");
		expect(tokens[0]?.alias).toBe("frontend-design");
		expect(tokens[0]?.raw).toBe("w/project:frontend-design");
	});

	it("returns empty array for prompt without tokens", () => {
		const tokens = tokenizePrompt("just a normal prompt without skills");
		expect(tokens).toEqual([]);
	});

	it("handles multiple namespaced tokens", () => {
		const tokens = tokenizePrompt("w/user:auth w/project:api w/plugin:mcp");
		expect(tokens.map((t) => t.namespace)).toEqual([
			"user",
			"project",
			"plugin",
		]);
		expect(tokens.map((t) => t.alias)).toEqual(["auth", "api", "mcp"]);
	});

	it("does not match tokens embedded in words", () => {
		const tokens = tokenizePrompt("checkw/skill andw/other");
		expect(tokens).toEqual([]);
	});

	it("matches tokens at start and end of prompt", () => {
		const tokens = tokenizePrompt("w/start some text w/end");
		expect(tokens.map((t) => t.alias)).toEqual(["start", "end"]);
	});

	it("handles underscore and hyphen in aliases", () => {
		const tokens = tokenizePrompt("w/my_skill w/another-skill");
		expect(tokens.map((t) => t.alias)).toEqual(["my_skill", "another-skill"]);
	});
});
