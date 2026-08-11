import { expect, test } from "bun:test";

import { runDocsGoldenPath } from "../golden-path";

test("the documented first-author path generates, detects an edit, and regenerates deterministically", async () => {
  const report = await runDocsGoldenPath(process.cwd());
  expect(report.commands).toBe(8);
  expect(report.generatedFiles).toBeGreaterThan(0);
}, 30_000);
