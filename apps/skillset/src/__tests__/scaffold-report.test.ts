import { describe, expect, test } from "bun:test";

import {
  formatScaffoldFileLine,
  formatScaffoldNextStep,
  formatScaffoldWriteHint,
  scaffoldWriteReason,
} from "../scaffold-report";

describe("SET-341 scaffold report primitives", () => {
  test.each([
    ["create", "  + skillset.yaml"],
    ["exists", "  = skillset.yaml"],
    ["update", "  ~ skillset.yaml"],
  ] as const)("formats %s file lines", (state, expected) => {
    expect(formatScaffoldFileLine("skillset.yaml", state)).toBe(expected);
  });

  test.each([
    [false, false, "write confirmation required"],
    [true, false, "blocked before write"],
    [true, true, "written"],
  ] as const)("selects the write reason", (write, written, expected) => {
    expect(scaffoldWriteReason(write, written)).toBe(expected);
  });

  test.each([
    ["skillset check", "  next: skillset check"],
    [
      "skillset check, skillset check --only outputs",
      "  next: skillset check, skillset check --only outputs",
    ],
  ] as const)("formats next steps", (command, expected) => {
    expect(formatScaffoldNextStep(command)).toBe(expected);
  });

  test.each([
    [
      "init with --yes",
      "setup files",
      "skillset: rerun init with --yes to write setup files",
    ],
    [
      "init with --adopt and --yes",
      "adopted source",
      "skillset: rerun init with --adopt and --yes to write adopted source",
    ],
  ] as const)("formats write hints", (invocation, subject, expected) => {
    expect(formatScaffoldWriteHint(invocation, subject)).toBe(expected);
  });
});
