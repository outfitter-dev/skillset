import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectLegacyConfig,
  migrateConfigFile,
  migrateLegacyConfig,
} from "../migrate";

const BACKUP_EXTENSION_PATTERN = /\.bak$/;

describe("config migration", () => {
  test("detectLegacyConfig returns false for non-objects", () => {
    expect(detectLegacyConfig(null)).toBe(false);
    expect(detectLegacyConfig(undefined)).toBe(false);
    expect(detectLegacyConfig("string")).toBe(false);
    expect(detectLegacyConfig(123)).toBe(false);
    expect(detectLegacyConfig([])).toBe(false);
  });

  test("detectLegacyConfig returns false for new config format", () => {
    const newConfig = {
      version: 1,
      rules: { unresolved: "warn", ambiguous: "warn" },
      output: { max_lines: 500, include_layout: false },
      skills: {},
    };
    expect(detectLegacyConfig(newConfig)).toBe(false);
  });

  test("detectLegacyConfig returns true for mode key", () => {
    const legacyConfig = {
      mode: "warn",
      mappings: {},
    };
    expect(detectLegacyConfig(legacyConfig)).toBe(true);
  });

  test("detectLegacyConfig returns true for mappings key", () => {
    const legacyConfig = {
      mappings: { api: "api" },
    };
    expect(detectLegacyConfig(legacyConfig)).toBe(true);
  });

  test("detectLegacyConfig returns true for showStructure key", () => {
    const legacyConfig = {
      showStructure: true,
    };
    expect(detectLegacyConfig(legacyConfig)).toBe(true);
  });

  test("detectLegacyConfig returns true for maxLines key", () => {
    const legacyConfig = {
      maxLines: 300,
    };
    expect(detectLegacyConfig(legacyConfig)).toBe(true);
  });

  test("detectLegacyConfig returns true for namespaceAliases key", () => {
    const legacyConfig = {
      namespaceAliases: { p: "project" },
    };
    expect(detectLegacyConfig(legacyConfig)).toBe(true);
  });

  test("migrateLegacyConfig throws on non-object", () => {
    expect(() => migrateLegacyConfig(null)).toThrow();
    expect(() => migrateLegacyConfig("string")).toThrow();
  });

  test("migrateLegacyConfig transforms mode=warn to rules.unresolved=warn", () => {
    const legacy = {
      mode: "warn" as const,
    };
    const migrated = migrateLegacyConfig(legacy);
    expect(migrated.rules.unresolved).toBe("warn");
    expect(migrated.rules.ambiguous).toBe("warn");
  });

  test("migrateLegacyConfig transforms mode=strict to rules.unresolved=error", () => {
    const legacy = {
      mode: "strict" as const,
    };
    const migrated = migrateLegacyConfig(legacy);
    expect(migrated.rules.unresolved).toBe("error");
    expect(migrated.rules.ambiguous).toBe("warn");
  });

  test("migrateLegacyConfig transforms mappings to skills", () => {
    const legacy = {
      mappings: {
        api: "api",
        debug: { skill: "debugging" },
      },
    };
    const migrated = migrateLegacyConfig(legacy);
    expect(migrated.skills).toEqual({
      api: "api",
      debug: { skill: "debugging" },
    });
  });

  test("migrateLegacyConfig transforms showStructure to output.include_layout", () => {
    const legacy = {
      showStructure: true,
    };
    const migrated = migrateLegacyConfig(legacy);
    expect(migrated.output.include_layout).toBe(true);
  });

  test("migrateLegacyConfig transforms maxLines to output.max_lines", () => {
    const legacy = {
      maxLines: 300,
    };
    const migrated = migrateLegacyConfig(legacy);
    expect(migrated.output.max_lines).toBe(300);
  });

  test("migrateLegacyConfig drops namespaceAliases", () => {
    const legacy = {
      namespaceAliases: { p: "project", u: "user" },
    };
    const migrated = migrateLegacyConfig(legacy);
    expect("namespaceAliases" in migrated).toBe(false);
  });

  test("migrateLegacyConfig preserves valid new fields", () => {
    const legacy = {
      mode: "warn" as const,
      mappings: { api: "api" },
      resolution: { fuzzy_matching: false },
      ignore_scopes: ["plugin"],
      tools: ["claude", "codex"],
      sets: { dev: { name: "Dev", skills: ["api"] } },
    };
    const migrated = migrateLegacyConfig(legacy);

    expect(migrated.resolution).toEqual({ fuzzy_matching: false });
    expect(migrated.ignore_scopes).toEqual(["plugin"]);
    expect(migrated.tools).toEqual(["claude", "codex"]);
    expect(migrated.sets).toEqual({
      dev: { name: "Dev", skills: ["api"] },
    });
  });

  test("migrateLegacyConfig uses defaults when legacy fields missing", () => {
    const legacy = {};
    const migrated = migrateLegacyConfig(legacy);

    expect(migrated.version).toBe(1);
    expect(migrated.rules.unresolved).toBe("warn");
    expect(migrated.rules.ambiguous).toBe("warn");
    expect(migrated.output.max_lines).toBe(500);
    expect(migrated.output.include_layout).toBe(false);
    expect(migrated.skills).toEqual({});
  });

  test("migrateLegacyConfig full transformation", () => {
    const legacy = {
      mode: "strict" as const,
      mappings: {
        api: "api",
        debug: { skill: "debugging", scope: "user" },
      },
      showStructure: true,
      maxLines: 1000,
      namespaceAliases: { p: "project" },
      resolution: { fuzzy_matching: false },
      tools: ["claude"],
    };

    const migrated = migrateLegacyConfig(legacy);

    expect(migrated).toEqual({
      version: 1,
      rules: {
        unresolved: "error",
        ambiguous: "warn",
      },
      output: {
        max_lines: 1000,
        include_layout: true,
      },
      skills: {
        api: "api",
        debug: { skill: "debugging", scope: "user" },
      },
      resolution: { fuzzy_matching: false },
      tools: ["claude"],
    });
  });
});

describe("migrateConfigFile", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skillset-migrate-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("returns migrated: false for non-existent file", async () => {
    const result = await migrateConfigFile(join(testDir, "nonexistent.yaml"));
    expect(result.migrated).toBe(false);
    expect(result.backupPath).toBeUndefined();
  });

  test("returns migrated: false for new format config", async () => {
    const configPath = join(testDir, "config.yaml");
    const newConfig = `version: 1
rules:
  unresolved: warn
  ambiguous: warn
output:
  max_lines: 500
  include_layout: false
skills: {}
`;
    await Bun.write(configPath, newConfig);

    const result = await migrateConfigFile(configPath);
    expect(result.migrated).toBe(false);
    expect(result.backupPath).toBeUndefined();
  });

  test("migrates legacy config and creates backup", async () => {
    const configPath = join(testDir, "config.yaml");
    const legacyConfig = `mode: strict
mappings:
  api: api
  debug:
    skill: debugging
showStructure: true
maxLines: 1000
`;
    await Bun.write(configPath, legacyConfig);

    const result = await migrateConfigFile(configPath);
    expect(result.migrated).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(result.backupPath).toMatch(BACKUP_EXTENSION_PATTERN);

    // Verify backup was created and contains original content
    if (result.backupPath) {
      expect(existsSync(result.backupPath)).toBe(true);
      const backupContent = await Bun.file(result.backupPath).text();
      expect(backupContent).toBe(legacyConfig);
    }

    // Verify migrated file has new format
    const migratedContent = await Bun.file(configPath).text();
    expect(migratedContent).toContain("version: 1");
    expect(migratedContent).toContain("rules:");
    expect(migratedContent).toContain("unresolved: error");
    expect(migratedContent).toContain("skills:");
    expect(migratedContent).not.toContain("mappings:");
    expect(migratedContent).not.toContain("mode:");
  });

  test("returns migrated: false for invalid YAML", async () => {
    const configPath = join(testDir, "config.yaml");
    await Bun.write(configPath, "invalid: yaml: content: [[[");

    const result = await migrateConfigFile(configPath);
    expect(result.migrated).toBe(false);
  });

  test("creates unique backup with timestamp", async () => {
    const configPath = join(testDir, "config.yaml");
    const legacyConfig = `mode: warn
mappings: {}
`;
    await Bun.write(configPath, legacyConfig);

    // Migrate twice
    const result1 = await migrateConfigFile(configPath);
    await Bun.write(configPath, legacyConfig); // Restore legacy config
    await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure different timestamp
    const result2 = await migrateConfigFile(configPath);

    expect(result1.migrated).toBe(true);
    expect(result2.migrated).toBe(true);
    expect(result1.backupPath).not.toBe(result2.backupPath);

    // Both backups should exist
    const files = readdirSync(testDir);
    const backupFiles = files.filter((f) => f.endsWith(".bak"));
    expect(backupFiles.length).toBeGreaterThanOrEqual(2);
  });
});
