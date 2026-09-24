import { createHash } from "node:crypto";

/** The narrow Bun 1.4 JUnit shape needed to prove a sharded test union. */
export interface JunitEvidence {
  readonly tests: number;
  readonly assertions: number;
  readonly failures: number;
  readonly skipped: number;
  readonly files: readonly string[];
  readonly identities: readonly string[];
}

export interface ShardUnion {
  readonly tests: number;
  readonly assertions: number;
  readonly skipped: number;
  readonly fileCount: number;
  readonly identitySha256: string;
}

export function parseJunitEvidence(
  xml: string,
  repoRoot: string
): JunitEvidence {
  if (!xml.trimEnd().endsWith("</testsuites>")) {
    throw new Error("JUnit report is missing its closing testsuites tag");
  }
  const root = xml.match(/^<testsuites\b([^\n]*)>$/mu);
  if (!root) throw new Error("JUnit report is missing its testsuites root");
  const rootAttributes = attributes(root[1] ?? "");
  const files = [...xml.matchAll(/^  <testsuite\b([^\n]*)>$/gmu)].map((match) =>
    required(attributes(match[1] ?? ""), "file")
  );
  const cases = [
    ...[...xml.matchAll(/^[ \t]+<testcase\b([^\n]*?)\/>$/gmu)].map((match) => ({
      attrs: attributes(match[1] ?? ""),
      outcome: "passed",
    })),
    ...[
      ...xml.matchAll(
        /^[ \t]+<testcase\b([^\n]*?)(?<!\/)>\n([\s\S]*?)^[ \t]+<\/testcase>$/gmu
      ),
    ].map((match) => ({
      attrs: attributes(match[1] ?? ""),
      outcome: testcaseOutcome(match[2] ?? ""),
    })),
  ];
  const identities = cases.map(({ attrs, outcome }) =>
    [
      required(attrs, "file"),
      present(attrs, "classname"),
      required(attrs, "name").replaceAll(repoRoot, "<repo>"),
      required(attrs, "line"),
      nonnegativeInteger(attrs, "assertions"),
      outcome,
    ].join("\0")
  );
  const tests = nonnegativeInteger(rootAttributes, "tests");
  if (files.length === 0 || identities.length !== tests) {
    throw new Error(
      `JUnit report is incomplete: ${files.length} files and ${identities.length}/${tests} testcases`
    );
  }
  const assertions = nonnegativeInteger(rootAttributes, "assertions");
  const skipped = nonnegativeInteger(rootAttributes, "skipped");
  const failures = nonnegativeInteger(rootAttributes, "failures");
  if (
    cases.reduce(
      (total, entry) => total + nonnegativeInteger(entry.attrs, "assertions"),
      0
    ) !== assertions ||
    cases.filter((entry) => entry.outcome.startsWith("skipped:")).length !==
      skipped ||
    (failures === 0 && cases.some((entry) => entry.outcome === "failed"))
  ) {
    throw new Error(
      "JUnit testcase assertions or skipped outcomes differ from report totals"
    );
  }
  return {
    assertions,
    failures,
    files,
    identities,
    skipped,
    tests,
  };
}

function testcaseOutcome(body: string): string {
  const skipped = body.trim().match(/^<skipped\b([^>]*)\/>$/u);
  if (skipped)
    return `skipped:${attributes(skipped[1] ?? "").get("message") ?? ""}`;
  return "failed";
}

export function verifyShardUnion(
  manifest: readonly string[],
  baseline: JunitEvidence,
  shards: readonly JunitEvidence[]
): ShardUnion {
  if (shards.length === 0) throw new Error("no shard reports were provided");
  equalMultiset(baseline.files, manifest, "baseline file manifest");
  const files = shards.flatMap((shard) => shard.files);
  equalMultiset(files, manifest, "shard file union");
  const identities = shards.flatMap((shard) => shard.identities);
  equalMultiset(identities, baseline.identities, "shard test identities");
  const sum = (key: "tests" | "assertions" | "failures" | "skipped") =>
    shards.reduce((total, shard) => total + shard[key], 0);
  for (const key of ["tests", "assertions", "failures", "skipped"] as const) {
    if (sum(key) !== baseline[key]) {
      throw new Error(
        `shard ${key} sum ${sum(key)} differs from baseline ${baseline[key]}`
      );
    }
  }
  if (baseline.failures !== 0) {
    throw new Error("baseline JUnit is not an all-green comparison manifest");
  }
  return {
    assertions: sum("assertions"),
    fileCount: files.length,
    identitySha256: sha256(sortedLines(identities)),
    skipped: sum("skipped"),
    tests: sum("tests"),
  };
}

function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(/([A-Za-z][\w-]*)="([^"]*)"/gu)) {
    const key = match[1] ?? "";
    if (result.has(key)) throw new Error(`duplicate JUnit attribute ${key}`);
    result.set(key, match[2] ?? "");
  }
  return result;
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = present(values, key);
  if (value.length === 0) {
    throw new Error(`JUnit report is missing ${key}`);
  }
  return value;
}

function present(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined) throw new Error(`JUnit report is missing ${key}`);
  return value;
}

function nonnegativeInteger(
  values: ReadonlyMap<string, string>,
  key: string
): number {
  const value = Number(required(values, key));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`JUnit report has invalid ${key}`);
  }
  return value;
}

function equalMultiset(
  actual: readonly string[],
  expected: readonly string[],
  label: string
): void {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (
    left.length !== right.length ||
    left.some((item, index) => item !== right[index])
  ) {
    throw new Error(
      `${label} differs: ${left.length} actual vs ${right.length} expected`
    );
  }
}

function sortedLines(values: readonly string[]): string {
  return [...values].sort().join("\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
