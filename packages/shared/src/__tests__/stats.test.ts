import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageEntry } from "../stats";
import {
  aggregateUsageBySkill,
  clearUsageLog,
  parseDuration,
  readUsageLog,
} from "../stats";

describe("parseDuration", () => {
  test("parses days correctly", () => {
    expect(parseDuration("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration("1d")).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration("30d")).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test("parses weeks correctly", () => {
    expect(parseDuration("1w")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration("2w")).toBe(14 * 24 * 60 * 60 * 1000);
    expect(parseDuration("4w")).toBe(28 * 24 * 60 * 60 * 1000);
  });

  test("parses months correctly (30 days)", () => {
    expect(parseDuration("1m")).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseDuration("2m")).toBe(60 * 24 * 60 * 60 * 1000);
  });

  test("is case-insensitive", () => {
    expect(parseDuration("7D")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration("1W")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration("1M")).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test("returns undefined for invalid formats", () => {
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("abc")).toBeUndefined();
    expect(parseDuration("7")).toBeUndefined();
    expect(parseDuration("d7")).toBeUndefined();
    expect(parseDuration("7x")).toBeUndefined();
    expect(parseDuration("-7d")).toBeUndefined();
    expect(parseDuration("7.5d")).toBeUndefined();
  });
});

describe("aggregateUsageBySkill", () => {
  test("aggregates counts correctly", () => {
    const entries: UsageEntry[] = [
      {
        timestamp: "2024-01-01T00:00:00Z",
        action: "load",
        skill: "project:api",
        source: "cli",
      },
      {
        timestamp: "2024-01-01T00:01:00Z",
        action: "load",
        skill: "project:api",
        source: "cli",
      },
      {
        timestamp: "2024-01-01T00:02:00Z",
        action: "resolve",
        skill: "user:auth",
        source: "hook",
      },
    ];

    const result = aggregateUsageBySkill(entries);

    expect(result.get("project:api")).toBe(2);
    expect(result.get("user:auth")).toBe(1);
    expect(result.size).toBe(2);
  });

  test("returns empty map for empty array", () => {
    const result = aggregateUsageBySkill([]);
    expect(result.size).toBe(0);
  });

  test("handles multiple skills with various counts", () => {
    const entries: UsageEntry[] = [
      {
        timestamp: "2024-01-01T00:00:00Z",
        action: "load",
        skill: "project:api",
        source: "cli",
      },
      {
        timestamp: "2024-01-01T00:01:00Z",
        action: "load",
        skill: "project:auth",
        source: "cli",
      },
      {
        timestamp: "2024-01-01T00:02:00Z",
        action: "load",
        skill: "project:api",
        source: "hook",
      },
      {
        timestamp: "2024-01-01T00:03:00Z",
        action: "resolve",
        skill: "user:utils",
        source: "mcp",
      },
      {
        timestamp: "2024-01-01T00:04:00Z",
        action: "inject",
        skill: "project:api",
        source: "inject",
      },
    ];

    const result = aggregateUsageBySkill(entries);

    expect(result.get("project:api")).toBe(3);
    expect(result.get("project:auth")).toBe(1);
    expect(result.get("user:utils")).toBe(1);
    expect(result.size).toBe(3);
  });
});

describe("readUsageLog", () => {
  let tempDir: string;
  let originalXdgDataHome: string | undefined;

  beforeEach(() => {
    // Save original env
    originalXdgDataHome = process.env.XDG_DATA_HOME;

    // Create temp directory and set XDG_DATA_HOME
    tempDir = mkdtempSync(join(tmpdir(), "skillset-stats-"));
    process.env.XDG_DATA_HOME = tempDir;

    // Create logs directory
    mkdirSync(join(tempDir, "skillset", "logs"), { recursive: true });
  });

  afterEach(() => {
    // Restore original env
    if (originalXdgDataHome === undefined) {
      process.env.XDG_DATA_HOME = undefined;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("reads valid JSONL entries", async () => {
    const logFile = join(tempDir, "skillset", "logs", "usage.jsonl");
    const entries = [
      {
        timestamp: "2024-01-01T10:00:00Z",
        action: "load",
        skill: "project:api",
        source: "cli",
      },
      {
        timestamp: "2024-01-01T11:00:00Z",
        action: "resolve",
        skill: "user:auth",
        source: "hook",
      },
    ];
    writeFileSync(logFile, entries.map((e) => JSON.stringify(e)).join("\n"));

    const result = await readUsageLog();

    expect(result).toHaveLength(2);
    expect(result[0]?.skill).toBe("project:api");
    expect(result[1]?.skill).toBe("user:auth");
  });

  test("filters entries by since date", async () => {
    const logFile = join(tempDir, "skillset", "logs", "usage.jsonl");
    const entries = [
      {
        timestamp: "2024-01-01T10:00:00Z",
        action: "load",
        skill: "old:skill",
        source: "cli",
      },
      {
        timestamp: "2024-01-15T10:00:00Z",
        action: "load",
        skill: "new:skill",
        source: "cli",
      },
    ];
    writeFileSync(logFile, entries.map((e) => JSON.stringify(e)).join("\n"));

    const since = new Date("2024-01-10T00:00:00Z");
    const result = await readUsageLog(since);

    expect(result).toHaveLength(1);
    expect(result[0]?.skill).toBe("new:skill");
  });

  test("returns empty array for non-existent file", async () => {
    // Don't create any log file
    const result = await readUsageLog();
    expect(result).toEqual([]);
  });

  test("returns empty array for empty file", async () => {
    const logFile = join(tempDir, "skillset", "logs", "usage.jsonl");
    writeFileSync(logFile, "");

    const result = await readUsageLog();
    expect(result).toEqual([]);
  });

  test("skips malformed JSON lines", async () => {
    const logFile = join(tempDir, "skillset", "logs", "usage.jsonl");
    const content = [
      JSON.stringify({
        timestamp: "2024-01-01T10:00:00Z",
        action: "load",
        skill: "valid:skill",
        source: "cli",
      }),
      "not valid json",
      JSON.stringify({
        timestamp: "2024-01-01T11:00:00Z",
        action: "resolve",
        skill: "also:valid",
        source: "hook",
      }),
    ].join("\n");
    writeFileSync(logFile, content);

    const result = await readUsageLog();

    expect(result).toHaveLength(2);
    expect(result[0]?.skill).toBe("valid:skill");
    expect(result[1]?.skill).toBe("also:valid");
  });

  test("handles entries with optional duration_ms", async () => {
    const logFile = join(tempDir, "skillset", "logs", "usage.jsonl");
    const entries = [
      {
        timestamp: "2024-01-01T10:00:00Z",
        action: "load",
        skill: "project:api",
        source: "cli",
        duration_ms: 150,
      },
      {
        timestamp: "2024-01-01T11:00:00Z",
        action: "resolve",
        skill: "user:auth",
        source: "hook",
      },
    ];
    writeFileSync(logFile, entries.map((e) => JSON.stringify(e)).join("\n"));

    const result = await readUsageLog();

    expect(result).toHaveLength(2);
    expect(result[0]?.duration_ms).toBe(150);
    expect(result[1]?.duration_ms).toBeUndefined();
  });
});

describe("clearUsageLog", () => {
  let tempDir: string;
  let originalXdgDataHome: string | undefined;

  beforeEach(() => {
    // Save original env
    originalXdgDataHome = process.env.XDG_DATA_HOME;

    // Create temp directory and set XDG_DATA_HOME
    tempDir = mkdtempSync(join(tmpdir(), "skillset-stats-"));
    process.env.XDG_DATA_HOME = tempDir;

    // Create logs directory
    mkdirSync(join(tempDir, "skillset", "logs"), { recursive: true });
  });

  afterEach(() => {
    // Restore original env
    if (originalXdgDataHome === undefined) {
      process.env.XDG_DATA_HOME = undefined;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("clears existing log file and returns true", async () => {
    const logFile = join(tempDir, "skillset", "logs", "usage.jsonl");
    writeFileSync(
      logFile,
      JSON.stringify({
        timestamp: "2024-01-01T10:00:00Z",
        action: "load",
        skill: "project:api",
        source: "cli",
      })
    );

    const result = await clearUsageLog();

    expect(result).toBe(true);

    // Verify file is now empty
    const entries = await readUsageLog();
    expect(entries).toEqual([]);
  });

  test("returns false when parent directory does not exist", async () => {
    // Remove the logs directory so clearUsageLog fails
    rmSync(join(tempDir, "skillset", "logs"), { recursive: true, force: true });

    const result = await clearUsageLog();
    expect(result).toBe(false);
  });

  test("creates empty file if file does not exist but directory does", async () => {
    // Directory exists but file doesn't - writeFile creates it
    const result = await clearUsageLog();
    expect(result).toBe(true);

    // Verify file exists and is empty
    const entries = await readUsageLog();
    expect(entries).toEqual([]);
  });

  test("clears file with multiple entries", async () => {
    const logFile = join(tempDir, "skillset", "logs", "usage.jsonl");
    const entries = [
      {
        timestamp: "2024-01-01T10:00:00Z",
        action: "load",
        skill: "project:api",
        source: "cli",
      },
      {
        timestamp: "2024-01-01T11:00:00Z",
        action: "resolve",
        skill: "user:auth",
        source: "hook",
      },
      {
        timestamp: "2024-01-01T12:00:00Z",
        action: "inject",
        skill: "plugin:test",
        source: "inject",
      },
    ];
    writeFileSync(logFile, entries.map((e) => JSON.stringify(e)).join("\n"));

    // Verify we have entries first
    const beforeClear = await readUsageLog();
    expect(beforeClear).toHaveLength(3);

    const result = await clearUsageLog();
    expect(result).toBe(true);

    // Verify file is cleared
    const afterClear = await readUsageLog();
    expect(afterClear).toEqual([]);
  });
});
