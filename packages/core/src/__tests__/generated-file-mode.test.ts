import { describe, expect, it } from "bun:test";

import {
  generatedFileModeMatches,
  normalizeGeneratedFileMode,
  supportsGeneratedFileModes,
} from "../generated-file-mode";

describe("generated file modes", () => {
  it("normalizes any executable source bit to 0755", () => {
    expect(normalizeGeneratedFileMode(0o644)).toBe(0o644);
    expect(normalizeGeneratedFileMode(0o600)).toBe(0o644);
    expect(normalizeGeneratedFileMode(0o700)).toBe(0o755);
    expect(normalizeGeneratedFileMode(0o010)).toBe(0o755);
    expect(normalizeGeneratedFileMode(0o001)).toBe(0o755);
  });

  it("checks exact normalized modes on Unix and explicitly skips them on Windows", () => {
    expect(generatedFileModeMatches(0o755, 0o755, "linux")).toBe(true);
    expect(generatedFileModeMatches(0o700, 0o755, "linux")).toBe(false);
    expect(generatedFileModeMatches(0o644, 0o755, "darwin")).toBe(false);
    expect(generatedFileModeMatches(0o644, 0o755, "win32")).toBe(true);
    expect(supportsGeneratedFileModes("win32")).toBe(false);
  });
});
