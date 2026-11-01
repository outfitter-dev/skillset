import { readdir } from "node:fs/promises";
import { join, posix, relative } from "node:path";
import { readCompileConfig, readCompileTargets, readOutputConfig, readSkillsetMetadata, resolveTargets } from "@skillset/core/internal/config";
import { readCurrentGeneratedLockFromDisk } from "@skillset/core/internal/generated-lock-read";
import { assertRealPathInside, isPathInside, resolveInside } from "@skillset/core/internal/path";
import { DEFAULT_PLUGIN_OUTPUT_ROOT, claudeMarketplacePath, cursorMarketplacePath, chatGptMarketplacePath } from "@skillset/core/internal/plugin-output";
import { CLAUDE_PROJECT_INSTRUCTION_PATHS } from "@skillset/core/internal/render-rules";
import { STANDARD_PROJECTION_MANAGED_ROOTS } from "@skillset/core/internal/standard-projections";
import { CLAUDE_RULES_OUTPUT_ROOT, targetDescriptor, targetNames } from "@skillset/core/internal/targets";
import { parseYamlRecord } from "@skillset/core/internal/yaml";

export interface FormatterIgnoreSuggestion {
  readonly formatter: "oxfmt" | "prettier" | "biome";
  readonly detectedPaths: readonly string[];
  readonly destination: string;
  readonly patterns: readonly string[];
  readonly snippet: string;
  readonly notes: readonly string[];
}

/** Advisory only: no formatter config is parsed, executed or written. */
export async function formatterIgnoreSuggestions(
  rootPath: string,
  configText: string,
  nativeAgents: boolean
): Promise<readonly FormatterIgnoreSuggestion[]> {
  let entries;
  try { entries = await readdir(rootPath, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const detected = [
    { formatter: "oxfmt" as const, files: names.filter((name) => /^(?:\.oxfmtrc(?:\.(?:json|jsonc))?|oxfmt\.config\.(?:ts|mts))$/.test(name)), destination: ".oxfmtrc.json" },
    { formatter: "prettier" as const, files: names.filter((name) => name === ".prettierignore" || /^prettier\.config\.(?:js|cjs|mjs|ts|cts|mts)$/.test(name) || /^\.prettierrc(?:\.(?:json|json5|yaml|yml|toml|js|cjs|mjs|ts|cts|mts))?$/.test(name)), destination: ".prettierignore" },
    { formatter: "biome" as const, files: names.filter((name) => /^biome\.jsonc?$/.test(name)), destination: "biome.json" },
  ].filter((item) => item.files.length > 0);
  if (detected.length === 0) return [];
  const { patterns, notes } = await suggestedPatterns(rootPath, configText, nativeAgents);
  return detected.map(({ formatter, files, destination }) => ({
    formatter,
    detectedPaths: files,
    destination: formatter === "prettier" ? destination : files[0]!,
    patterns,
    snippet: formatter === "prettier"
      ? patterns.map((pattern) => pattern === "**/skillset.lock" ? pattern : `/${pattern}`).join("\n")
      : JSON.stringify(formatter === "oxfmt" ? { ignorePatterns: patterns } : { files: { includes: ["**", ...patterns.map((pattern) => `!${pattern}`)] } }, null, 2),
    notes: [
      formatter === "prettier" ? "Append to .prettierignore; retain existing entries." : formatter === "oxfmt"
        ? "Merge these ignorePatterns into the existing config object (JSON/JSONC or TypeScript); retain existing entries."
        : "Biome 2: append only the negations to existing files.includes; retain its positive patterns. Use the sample ** only when creating files.includes. This excludes files from all Biome tools.",
      ...notes,
    ],
  }));
}

async function suggestedPatterns(rootPath: string, configText: string, nativeAgents: boolean) {
  const patterns = new Set([".skillset/**", "**/skillset.lock"]);
  const notes = ["Directory suggestions cover potential generated roots and may also match authored neighbors; review before copying.", "Additional scoped instructions, catalogs and native files may appear after adoption. Review post-build skillset.lock entries and skillset explain for complete coverage."];
  const add = (path: string, directory = false) => {
    // Do not guess at formatter-specific escaping or ignore an entire repository.
    if (path === "." || path === "" || /[\\*?{}\[\]!#\r\n]/.test(path) || path.trim() !== path) {
      notes.push(`Review formatter escaping for output path ${JSON.stringify(path)}; no pattern added.`);
      return;
    }
    try { path = relative(rootPath, resolveInside(rootPath, path)).replaceAll("\\", "/"); }
    catch { notes.push(`Output path ${JSON.stringify(path)} is outside this workspace; no pattern added.`); return; }
    if (path === "") return;
    patterns.add(path.replace(/\/$/, "") + (directory ? "/**" : ""));
  };
  const roots = new Set<string>([DEFAULT_PLUGIN_OUTPUT_ROOT, ...STANDARD_PROJECTION_MANAGED_ROOTS.map((entry) => entry.path)]);
  try {
    const config = parseYamlRecord(configText, "skillset.yaml");
    const targets = resolveTargets(readCompileTargets(config, "skillset.yaml"), config, "skillset.yaml", { allowDefaults: true, objectInheritsEnabled: true });
    const outputs = readOutputConfig(config, readSkillsetMetadata(config, "skillset.yaml"));
    for (const entry of STANDARD_PROJECTION_MANAGED_ROOTS) add(entry.path, true);
    if (!nativeAgents) add("AGENTS.md");
    for (const target of targetNames()) {
      roots.add(outputs.skills[target]);
      roots.add(outputs.plugins[target]);
      if (!targets[target].enabled) continue;
      if (outputs.targetOutputs[target].skills !== false) add(outputs.skills[target], true);
      const projectRoot = typeof targets[target].options.projectRoot === "string" ? targets[target].options.projectRoot : targetDescriptor(target).projectRoot;
      add(posix.join(projectRoot, "agents"), true);
      const islandRoot = join(rootPath, ".skillset", `_${target}`);
      try {
        await assertRealPathInside(rootPath, islandRoot);
        for (const entry of await readdir(islandRoot, { withFileTypes: true })) {
          if (!entry.isFile() && !entry.isDirectory()) continue;
          add(posix.join(projectRoot, entry.name), entry.isDirectory());
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") notes.push(`Could not inspect ${target} native source for output suggestions.`);
      }
      switch (target) {
        case "claude":
          add(CLAUDE_RULES_OUTPUT_ROOT, true);
          add(CLAUDE_PROJECT_INSTRUCTION_PATHS[readCompileConfig(config, "skillset.yaml").instructionFrontPage]);
          if (outputs.targetOutputs[target].plugins !== false) add(claudeMarketplacePath(outputs.plugins[target]));
          break;
        case "cursor":
          add(posix.join(projectRoot, "rules"), true);
          if (outputs.targetOutputs[target].plugins !== false) add(cursorMarketplacePath(outputs.plugins[target]));
          break;
        case "codex":
          if (outputs.targetOutputs[target].plugins !== false) add(chatGptMarketplacePath());
          break;
      }
    }
  } catch {
    notes.push("Could not derive all configured output roots; source and lock exclusions remain available.");
  }
  for (const outputRoot of [".", ...roots]) {
    const lockPath = posix.join(outputRoot, "skillset.lock");
    try {
      const absolute = resolveInside(rootPath, lockPath);
      await assertRealPathInside(rootPath, absolute);
      const result = await readCurrentGeneratedLockFromDisk(absolute, { logicalPath: lockPath, expectedOutputRoot: outputRoot, missing: "absent", provenance: "require" });
      if (result.kind === "absent") continue;
      for (const item of result.lock.items) {
        if (item.kind === "settings-entry") continue;
        for (const file of item.files) {
          const path = posix.join(outputRoot, file);
          if (nativeAgents && path === "AGENTS.md") continue;
          add(path);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") notes.push(`Could not use ${lockPath} for additional file suggestions; inspect it after building.`);
    }
  }
  const directories = [...patterns].filter((pattern) => pattern.endsWith("/**")).map((pattern) => pattern.slice(0, -3));
  const compact = [...patterns].filter((pattern) => pattern === "**/skillset.lock" || !directories.some((directory) => {
    const path = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
    return path !== directory && isPathInside(directory, path);
  }));
  return { patterns: compact.sort(), notes: [...new Set(notes)] };
}

export function formatFormatterIgnoreSuggestions(suggestions: readonly FormatterIgnoreSuggestion[] | undefined): string {
  if (!suggestions?.length) return "";
  return ["Formatter ignore suggestions (manual review; config files are unchanged)", ...suggestions.flatMap((item) => [
    `  ${item.formatter}: detected ${item.detectedPaths.join(", ")}; entries for ${item.destination}`,
    ...item.notes.map((note) => `  ${note}`),
    item.snippet,
  ])].join("\n");
}
