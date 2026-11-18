import { expect, test } from "bun:test";

import { builtinTransformEntries, lowerTransform, recognizeTransforms, transformEntries } from "../index";
import type { TransformDialect, TransformTarget } from "../types";

// Every detector needs deliberate examples. Adding an entry requires extending
// this corpus; enabling a rewrite requires a separate reviewed semantic proof.
const corpus = {
  "path.project-config-dir": [".claude/settings.json", "The .claude/plugins/marketplaces/cache path belongs to Claude."],
  "path.user-config-dir": ["~/.claude/config", "Keep ~/.claude/plugins/cache while explaining ~/.codex/config.toml."],
  "path.skills-dir": [".claude/skills/demo", "Backups stay in .claude/skills-backup; active skills use .agents/skills."],
  "doc.project-instructions": ["CLAUDE.md", "Claude reads CLAUDE.md; Codex reads AGENTS.md. Keep CLAUDE.md.backup."],
  "invoke.subagent": ["Ask @reviewer", "Follow @alice.\n@media screen {}\n@decorator()\n```css\n@media print {}\n```"],
  "dynamic.arguments": ["Use $ARGUMENTS", "The literal `$ARGUMENTS` is documented here; $ARGUMENTS_SUFFIX is unrelated."],
  "dynamic.positional": ["Use $1", "A shell example uses $1, but prices are $1.99 and US$100."],
  "dynamic.env-substitution": ["Use ${CLAUDE_PLUGIN_ROOT}", "The variable name `${CLAUDE_PLUGIN_ROOT}` is provider-specific; ${CODEX_HOME} is different."],
  "dynamic.pre-resolution": ["!`git status`", "```text\n!`git status`\n```\nThis example describes deferred execution; it is not permission to execute."],
  "reference.file-mention": ["Read @src/index.ts", "Install @scope/package; compare with the literal `@src/index.ts` example."],
} satisfies Record<string, readonly [string, string]>;

const cases: Readonly<Record<string, readonly [string, string]>> = corpus;
const directions = [["claude", "codex"], ["codex", "claude"]] as const;

function rewrite(body: string, from: TransformDialect, to: TransformTarget): string {
  let result = body;
  for (const match of [...recognizeTransforms(body, from)].reverse()) {
    const replacement = lowerTransform(match, to);
    if (replacement !== undefined) {
      result = result.slice(0, match.index) + replacement + result.slice(match.index + match.text.length);
    }
  }
  return result;
}

function changedNegativeCases(): string[] {
  return Object.entries(cases).flatMap(([intent, [, body]]) =>
    directions.filter(([from, to]) => rewrite(body, from, to) !== body).map(([from, to]) => `${intent}:${from}->${to}`)
  );
}

test("every built-in detector has recognition and semantic collision coverage", () => {
  expect(builtinTransformEntries.map(({ intent }) => intent).sort()).toEqual(Object.keys(cases).sort());
  for (const entry of builtinTransformEntries) {
    const [example] = cases[entry.intent]!;
    expect(recognizeTransforms(example, "claude").some(({ intent }) => intent === entry.intent)).toBe(true);
    // Current entries report ambiguity or unsupported behavior. A future
    // mapping must replace this disposition with reviewed semantic fixtures.
    expect(entry.lowering).toBe("none");
    expect(entry.reason?.trim().length).toBeGreaterThan(0);
  }
});

test("semantic collision corpus stays byte-identical in both directions", () => {
  expect(changedNegativeCases()).toEqual([]);
});

test("negative corpus catches a reversible rewrite to an invented provider path", () => {
  const intent = "path.project-config-dir";
  const original = transformEntries.get(intent)!;
  transformEntries.set(intent, {
    ...original,
    lowering: "bidirectional",
    forms: {
      claude: { pattern: /\.claude\//gu, render: () => ".claude/" },
      codex: { pattern: /\.codex\//gu, render: () => ".codex/" },
    },
  });
  try {
    const body = cases[intent]![1];
    const invented = rewrite(body, "claude", "codex");
    expect(invented).toContain(".codex/plugins/marketplaces/cache");
    expect(rewrite(invented, "codex", "claude")).toBe(body);
    expect(changedNegativeCases()).toContain(`${intent}:claude->codex`);
  } finally {
    transformEntries.set(intent, original);
  }
});
