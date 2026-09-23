import { expect, test } from "bun:test";

import { parseJunitEvidence, verifyShardUnion } from "../test-shard-evidence";

function junit(
  files: readonly {
    file: string;
    name: string;
    assertions?: number;
    skipped?: "skip" | "todo";
  }[],
  failures = 0
): string {
  const assertions = files.reduce(
    (total, file) => total + (file.assertions ?? (file.skipped ? 0 : 1)),
    0
  );
  const skipped = files.filter((file) => file.skipped).length;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="bun test" tests="${files.length}" assertions="${assertions}" failures="${failures}" skipped="${skipped}" time="0.1">`,
    ...files.flatMap(
      ({ file, name, assertions: fileAssertions, skipped: skipKind }) => {
        const count = fileAssertions ?? (skipKind ? 0 : 1);
        return [
          `  <testsuite name="${file}" file="${file}" tests="1" assertions="${count}" failures="0" skipped="${skipKind ? 1 : 0}" time="0.1">`,
          `    <testcase name="${name}" classname="suite" time="0.1" file="${file}" line="12" assertions="${count}"${skipKind ? ">" : " />"}`,
          ...(skipKind
            ? [
                `      <skipped${skipKind === "todo" ? ' message="TODO"' : ""} />`,
                "    </testcase>",
              ]
            : []),
          "  </testsuite>",
        ];
      }
    ),
    "</testsuites>",
  ].join("\n");
}

test("SET-608: exact shard union accepts every file and normalized test once", () => {
  const baseline = parseJunitEvidence(
    junit([
      { file: "a.test.ts", name: "reads /source/repo" },
      { file: "b.test.ts", name: "writes" },
    ]),
    "/source/repo"
  );
  const first = parseJunitEvidence(
    junit([{ file: "b.test.ts", name: "writes" }]),
    "/clone/one"
  );
  const second = parseJunitEvidence(
    junit([{ file: "a.test.ts", name: "reads /clone/two" }]),
    "/clone/two"
  );
  expect(
    verifyShardUnion(["a.test.ts", "b.test.ts"], baseline, [first, second])
  ).toMatchObject({
    assertions: 2,
    fileCount: 2,
    skipped: 0,
    tests: 2,
  });
});

test("SET-608: missing or duplicated files cannot be full success", () => {
  const baseline = parseJunitEvidence(
    junit([
      { file: "a.test.ts", name: "a" },
      { file: "b.test.ts", name: "b" },
    ]),
    "/source"
  );
  const first = parseJunitEvidence(
    junit([{ file: "a.test.ts", name: "a" }]),
    "/one"
  );
  expect(() =>
    verifyShardUnion(["a.test.ts", "b.test.ts"], baseline, [first])
  ).toThrow("shard file union differs");
  expect(() =>
    verifyShardUnion(["a.test.ts", "b.test.ts"], baseline, [first, first])
  ).toThrow("shard file union differs");
});

test("SET-608: mismatched test identities and assertions fail aggregation", () => {
  const baseline = parseJunitEvidence(
    junit([{ file: "a.test.ts", name: "expected" }]),
    "/source"
  );
  const renamed = parseJunitEvidence(
    junit([{ file: "a.test.ts", name: "different" }]),
    "/clone"
  );
  const changedAssertions = parseJunitEvidence(
    junit([{ file: "a.test.ts", name: "expected", assertions: 2 }]),
    "/clone"
  );
  expect(() => verifyShardUnion(["a.test.ts"], baseline, [renamed])).toThrow(
    "shard test identities differs"
  );
  expect(() =>
    verifyShardUnion(["a.test.ts"], baseline, [changedAssertions])
  ).toThrow("shard test identities differs");
});

test("SET-608: equal totals cannot hide swapped per-test assertions or outcomes", () => {
  const baseline = parseJunitEvidence(
    junit([
      { file: "a.test.ts", name: "a", assertions: 1 },
      { file: "b.test.ts", name: "b", assertions: 2 },
      { file: "c.test.ts", name: "c", skipped: "skip" },
      { file: "d.test.ts", name: "d", skipped: "todo" },
    ]),
    "/source"
  );
  const redistributed = parseJunitEvidence(
    junit([
      { file: "a.test.ts", name: "a", assertions: 2 },
      { file: "b.test.ts", name: "b", assertions: 1 },
      { file: "c.test.ts", name: "c", skipped: "todo" },
      { file: "d.test.ts", name: "d", skipped: "skip" },
    ]),
    "/clone"
  );
  expect(redistributed.assertions).toBe(baseline.assertions);
  expect(redistributed.skipped).toBe(baseline.skipped);
  expect(() =>
    verifyShardUnion(
      ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"],
      baseline,
      [redistributed]
    )
  ).toThrow("shard test identities differs");
});

test("SET-608: an active test and skipped test cannot trade places", () => {
  const baseline = parseJunitEvidence(
    junit([
      { file: "a.test.ts", name: "a" },
      { file: "b.test.ts", name: "b", skipped: "skip" },
    ]),
    "/source"
  );
  const swapped = parseJunitEvidence(
    junit([
      { file: "a.test.ts", name: "a", skipped: "skip" },
      { file: "b.test.ts", name: "b" },
    ]),
    "/clone"
  );
  expect(swapped.assertions).toBe(baseline.assertions);
  expect(swapped.skipped).toBe(baseline.skipped);
  expect(() =>
    verifyShardUnion(["a.test.ts", "b.test.ts"], baseline, [swapped])
  ).toThrow("shard test identities differs");
});

test("SET-608: incomplete, failed, and malformed JUnit are not accepted", () => {
  const complete = junit([{ file: "a.test.ts", name: "a" }]);
  expect(() =>
    parseJunitEvidence(complete.replace("</testsuites>", ""), "/clone")
  ).toThrow("closing testsuites");
  expect(() =>
    parseJunitEvidence(complete.replace('tests="1"', 'tests="2"'), "/clone")
  ).toThrow("incomplete");
  expect(() =>
    parseJunitEvidence(complete.replace('line="12"', ""), "/clone")
  ).toThrow("missing line");
  expect(() =>
    parseJunitEvidence(
      complete.replace(
        'assertions="1" />',
        'assertions="1">\n      <failure />\n    </testcase>'
      ),
      "/clone"
    )
  ).toThrow("outcomes differ");
  const failed = parseJunitEvidence(
    junit([{ file: "a.test.ts", name: "a" }], 1),
    "/clone"
  );
  expect(() => verifyShardUnion(["a.test.ts"], failed, [failed])).toThrow(
    "not an all-green"
  );
});
