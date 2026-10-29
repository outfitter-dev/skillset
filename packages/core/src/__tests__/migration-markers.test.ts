import { expect, test } from "bun:test";
import { MIGRATION_STATE_SCHEMA_VERSION, type MigrationFlag, type MigrationState } from "@skillset/schema";
import { inspectMigrationMarkers, planMigrationMarker } from "../migration-markers";

const path = ".skillset/skills/demo/SKILL.md";
const marker = "<!-- skillset:todo ::: #adopt-k3m9 [ambiguous-reference] Review {{missing}} and @alice. -->";
const flag: MigrationFlag = {
  id: "adopt-k3m9", code: "ambiguous-reference", severity: "error", disposition: "ambiguous",
  state: "open", message: "Review {{missing}} and @alice.", source: { path, line: 6 },
  fingerprints: { content: `sha256:${"a".repeat(64)}`, context: `sha256:${"b".repeat(64)}` },
  placement: { kind: "inline", label: "todo", line: 5 }, evidence: [{ summary: "Review source meaning." }],
  relatedReportIds: [], history: [],
};
const ledger = (...flags: MigrationFlag[]): MigrationState => ({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags });
const prefix = "---\nname: demo\n---\n\n";

test("owned markers are removed exactly, preserving authored source coordinates and EOL", () => {
  for (const eol of ["\n", "\r\n"]) {
    const content = `${prefix}${marker}\nQuestionable content.\n`.replaceAll("\n", eol);
    const result = inspectMigrationMarkers({ content, path, state: ledger(flag) });
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toBe(`${prefix}Questionable content.\n`.replaceAll("\n", eol));
    expect(result.sourceLines).toEqual([1, 2, 3, 4, 6, 7]);
    expect(result.markers.map((item) => item.id)).toEqual([flag.id]);
  }
});

test("only ledger-owned exact markers can be removed; errors preserve the whole document", () => {
  const content = `${prefix}${marker}\nQuestionable content.\n`;
  for (const state of [ledger(), ledger({ ...flag, code: "other-code" }), ledger({ ...flag, source: { path: "other.md" } }),
    ledger({ ...flag, placement: { kind: "sidecar", reason: "Unsafe." } }),
    ledger({ ...flag, placement: { kind: "inline", label: "fix", line: 5 } }),
    ledger({ ...flag, placement: { kind: "inline", label: "todo", line: 6 } }),
    ledger({ ...flag, message: "Other meaning." }),
  ]) {
    const result = inspectMigrationMarkers({ content, path, state });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.content).toBe(content);
  }
});

test("malformed, duplicate and missing anchors produce finite source diagnostics", () => {
  for (const content of [`${prefix}${marker.replace(" ::: ", " :: ")}\nText.\n`, `${prefix}${marker}\n${marker}\nText.\n`, `${prefix}Text.\n`]) {
    const result = inspectMigrationMarkers({ content, path, state: ledger(flag) });
    expect(result.content).toBe(content);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((item) => item.path === path && item.line > 0)).toBe(true);
  }
});

test("unrelated comments and code examples stay literal", () => {
  for (const content of ["<!-- ordinary -->\n", "<!-- skillset:other text -->\n", `\`\`\`md\n${marker}\n\`\`\`\n`, `    ${marker}\n`, `Text \`${marker}\` here.\n`]) {
    const result = inspectMigrationMarkers({ content, path, state: ledger() });
    expect(result.content).toBe(content);
    expect(result.diagnostics).toEqual([]);
  }
});

test("safe placement inserts before top-level paragraphs, headings and lists only", () => {
  for (const body of ["Text.\n", "# Heading\n", "- First\n- Second\n"]) {
    const content = `${prefix}${body}`;
    const plan = planMigrationMarker({ content, path, flag, beforeLine: 5, kind: "adaptive-markdown" });
    expect(plan.placement).toEqual({ kind: "inline", label: "todo", line: 5 });
    expect(plan.content).toBe(`${prefix}${marker}\n${body}`);
    expect(inspectMigrationMarkers({ content: plan.content!, path, state: ledger(flag) }).content).toBe(content);
  }
});

test("unsafe contexts deterministically remain sidecar-only and unchanged", () => {
  const inputs = [
    { content: prefix + "Paragraph\ncontinuation\n", beforeLine: 6 },
    { content: prefix + "- First\n  continuation\n", beforeLine: 6 },
    { content: prefix + "```md\ntext\n```\n", beforeLine: 6 },
    { content: prefix + "| A | B |\n| - | - |\n| x | y |\n", beforeLine: 5 },
    { content: prefix + "text\n", beforeLine: 2 },
    { content: prefix + "> quote\n", beforeLine: 5 },
  ];
  for (const input of inputs) {
    const plan = planMigrationMarker({ ...input, path, flag, kind: "adaptive-markdown" });
    expect(plan.placement.kind).toBe("sidecar");
    expect(plan.content).toBeUndefined();
    expect(plan).toEqual(planMigrationMarker({ ...input, path, flag, kind: "adaptive-markdown" }));
  }
  for (const kind of ["provider-native", "resource", "other"] as const) {
    expect(planMigrationMarker({ content: "Text.\n", path, flag, beforeLine: 1, kind }).placement.kind).toBe("sidecar");
  }
});


test("non-Markdown and binary content never receive inline anchors even with an incorrect caller kind", () => {
  for (const [sourcePath, content] of [["settings.json", '{"key":true}'], [path, "binary\0bytes"]]) {
    const result = planMigrationMarker({ path: sourcePath!, content: content!, flag: { ...flag, source: { path: sourcePath! } }, beforeLine: 1, kind: "adaptive-markdown" });
    expect(result.placement.kind).toBe("sidecar");
    expect(result.content).toBeUndefined();
  }
});

test("single-column GFM table rows without pipes remain sidecar-only", () => {
  const content = "Header\n| --- |\nfirst row\nsecond row\n";
  for (const beforeLine of [1, 2, 3, 4]) expect(planMigrationMarker({ content, path, flag, beforeLine, kind: "adaptive-markdown" }).placement.kind).toBe("sidecar");
});

test("multiple markers preserve semantic text and authored positions without dropping adjacent whitespace", () => {
  const second = { ...flag, id: "adopt-second", placement: { kind: "inline" as const, label: "fix" as const, line: 8 } };
  const secondText = marker.replace("skillset:todo", "skillset:fix").replace(flag.id, second.id);
  const content = `${prefix}${marker}\nFirst.\n\n${secondText}\nSecond.\n`;
  const result = inspectMigrationMarkers({ content, path, state: ledger(flag, second) });
  expect(result.diagnostics).toEqual([]);
  expect(result.content).toBe(`${prefix}First.\n\nSecond.\n`);
  expect(result.sourceLines).toEqual([1, 2, 3, 4, 6, 7, 9, 10]);
});
