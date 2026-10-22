import { expect, test } from "bun:test";

import { runDocsGoldenPath } from "../golden-path";

test("the checked-in first-author example passes check, detects an edit, and regenerates deterministically", async () => {
  const report = await runDocsGoldenPath(process.cwd());
  expect(report.commands).toBe(10);
  expect(report.generatedFiles).toBeGreaterThan(0);
}, 30_000);
