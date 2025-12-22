import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  buildNamespaceTree,
  CONFIG_PATHS,
  formatOutcome,
  getConfigPath,
  getConfigValue,
  indexSkills,
  isNamespaceRef,
  loadCaches,
  loadConfig,
  readConfigByScope,
  resolveToken,
  resolveTokens,
  type Skill,
  setConfigValue,
  stripFrontmatter,
  writeConfig,
} from "@skillset/core";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import {
  runConfigDiagnostic,
  runFullDiagnostic,
  runSkillDiagnostic,
} from "./doctor";

type OutputFormat = "text" | "raw" | "json";

export function buildCli() {
  const program = new Command();
  program
    .name("skillset")
    .description("Deterministic skill invocation via w/<alias>")
    .version("0.1.0")
    .option("-s, --source <sources...>", "Filter by source(s)")
    .option("--text", "Formatted output (default in TTY)")
    .option("--raw", "Raw output for piping")
    .option("--json", "JSON output")
    .option("-o, --output <format>", "Output format (text, raw, json)")
    .argument("[skills...]", "Skills to show (optional)")
    .action(
      async (
        skills: string[],
        options: {
          source?: string[];
          text?: boolean;
          raw?: boolean;
          json?: boolean;
          output?: string;
        }
      ) => {
        const format = determineFormat(options);

        // If no arguments, list all skills
        if (skills.length === 0) {
          listAllSkills(options.source, format);
          return;
        }

        // Otherwise, treat all arguments as skill references
        await showSkills(skills, options.source, format);
      }
    );

  program
    .command("index")
    .description("Scan for SKILL.md files and refresh cache")
    .action(() => {
      const spinner = ora("Indexing skills...").start();
      const cache = indexSkills();
      spinner.succeed(`Indexed ${Object.keys(cache.skills).length} skills`);
    });

  program
    .command("interactive")
    .description("Interactively pick skills and emit context")
    .action(async () => {
      const cache = loadCaches();
      const skills = Object.values(cache.skills);
      if (!skills.length) {
        console.log(
          chalk.yellow("No skills indexed. Run skillset index first.")
        );
        return;
      }
      const answers = await inquirer.prompt([
        {
          type: "checkbox",
          name: "skillRefs",
          message: "Select skills to inject",
          choices: skills.map((s) => ({
            name: `${s.name} (${s.skillRef})`,
            value: s.skillRef,
          })),
        },
      ]);
      const tokens = (answers.skillRefs as string[]).map((ref) => ({
        raw: ref,
        alias: ref,
        namespace: undefined,
      }));
      const results = resolveTokens(tokens, loadConfig(), cache);
      const outcome = formatOutcome(results, loadConfig());
      console.log(outcome.context);
    });

  // Placeholder commands for reserved commands not yet implemented
  const notImplemented = (name: string) => () => {
    console.log(chalk.yellow(`Command '${name}' not yet implemented`));
  };

  // Config command with subcommands
  const configCommand = program
    .command("config")
    .description("Manage skillset configuration")
    .option("--edit", "Open config in $EDITOR")
    .option("-S, --scope <scope>", "Config scope: project, local, or user");

  // skillset config (no args) - show merged config
  configCommand.action(async (options: { edit?: boolean; scope?: string }) => {
    const scope = validateScope(options.scope);

    // skillset config --edit
    if (options.edit) {
      await editConfig(scope);
      return;
    }

    // skillset config (show current merged config)
    showConfig();
  });

  // skillset config get <key>
  configCommand
    .command("get <key>")
    .description("Get a config value using dot notation")
    .action((key: string) => {
      getConfigCommand(key);
    });

  // skillset config set <key> <value>
  configCommand
    .command("set <key> <value>")
    .description("Set a config value using dot notation")
    .option("-S, --scope <scope>", "Config scope: project, local, or user")
    .action((key: string, value: string, options: { scope?: string }) => {
      const scope = validateScope(options.scope);
      setConfigCommand(key, value, scope);
    });

  program
    .command("alias <name> <skillRef>")
    .description("Add or update a skill alias")
    .option(
      "-S, --scope <scope>",
      "Config scope: project, local, or user",
      "project"
    )
    .option("-f, --force", "Skip confirmation prompt")
    .action(
      async (
        name: string,
        skillRef: string,
        options: { scope?: string; force?: boolean }
      ) => {
        await handleAliasCommand(
          name,
          skillRef,
          validateScope(options.scope),
          options.force ?? false
        );
      }
    );

  program
    .command("unalias <name>")
    .description("Remove a skill alias")
    .option(
      "-S, --scope <scope>",
      "Config scope: project, local, or user",
      "project"
    )
    .action(async (name: string, options: { scope?: string }) => {
      await handleUnaliasCommand(name, validateScope(options.scope));
    });

  program
    .command("init")
    .description("Scaffold config files with sensible defaults")
    .option(
      "-S, --scope <scope>",
      "Target scope (project, user, or both)",
      "both"
    )
    .option("-f, --force", "Overwrite existing config files", false)
    .action((options: { scope: string; force: boolean }) => {
      initConfig(options.scope, options.force);
    });

  program
    .command("completions")
    .description("Generate shell completions")
    .action(notImplemented("completions"));

  program
    .command("set")
    .description("Manage skill sets")
    .action(notImplemented("set"));

  program
    .command("stats")
    .description("Show skill usage statistics")
    .action(notImplemented("stats"));

  program
    .command("browse")
    .description("Browse available skills")
    .action(notImplemented("browse"));

  program
    .command("search")
    .description("Search for skills")
    .action(notImplemented("search"));

  program
    .command("suggest")
    .description("Suggest skills based on context")
    .action(notImplemented("suggest"));

  program
    .command("doctor")
    .description("Check skillset installation and configuration")
    .argument(
      "[target]",
      "What to diagnose (config, skill name, or omit for full check)"
    )
    .action(async (target?: string) => {
      if (!target) {
        runFullDiagnostic();
      } else if (target === "config") {
        runConfigDiagnostic();
      } else {
        await runSkillDiagnostic(target);
      }
    });

  program.parse(process.argv);
}

/**
 * Determine output format from command options
 */
function determineFormat(options: {
  text?: boolean;
  raw?: boolean;
  json?: boolean;
  output?: string;
}): OutputFormat {
  if (options.json) return "json";
  if (options.raw) return "raw";
  if (options.text) return "text";
  if (typeof options.output === "string") {
    const format = options.output.toLowerCase();
    if (format === "json" || format === "raw" || format === "text") {
      return format;
    }
  }
  // Default: text in TTY, raw otherwise
  return process.stdout.isTTY ? "text" : "raw";
}

/**
 * Check if a skill's skillRef matches any of the source filters
 */
function matchesSourceFilter(
  skillRef: string,
  sourceFilters: string[] | undefined
): boolean {
  if (!sourceFilters || sourceFilters.length === 0) {
    return true;
  }

  for (const filter of sourceFilters) {
    // Match exact namespace: "project" → "project:*"
    if (filter === "project" && skillRef.startsWith("project:")) {
      return true;
    }
    if (filter === "user" && skillRef.startsWith("user:")) {
      return true;
    }
    if (filter === "plugin" && skillRef.startsWith("plugin:")) {
      return true;
    }

    // Match specific plugin: "plugin:<name>" → "plugin:<name>/*"
    if (filter.startsWith("plugin:")) {
      const pluginName = filter.slice(7); // Remove "plugin:" prefix
      if (skillRef.startsWith(`plugin:${pluginName}/`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * List all indexed skills
 */
function listAllSkills(
  sourceFilters: string[] | undefined,
  format: OutputFormat
): void {
  const cache = loadCaches();
  let skills = Object.values(cache.skills);

  if (skills.length === 0) {
    const message = "No skills indexed. Run 'skillset index' first.";
    if (format === "json") {
      console.log(JSON.stringify({ error: message, skills: [] }, null, 2));
    } else {
      console.log(chalk.yellow(message));
    }
    return;
  }

  // Filter by source if specified
  if (sourceFilters && sourceFilters.length > 0) {
    skills = skills.filter((skill) =>
      matchesSourceFilter(skill.skillRef, sourceFilters)
    );

    if (skills.length === 0) {
      const message = `No skills match source filter(s): ${sourceFilters.join(", ")}`;
      if (format === "json") {
        console.log(
          JSON.stringify(
            { error: message, filters: sourceFilters, skills: [] },
            null,
            2
          )
        );
      } else {
        console.log(chalk.yellow(message));
      }
      return;
    }
  }

  if (format === "json") {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  if (format === "raw") {
    // One skill ref per line for piping
    for (const skill of skills.sort((a, b) =>
      a.skillRef.localeCompare(b.skillRef)
    )) {
      console.log(skill.skillRef);
    }
    return;
  }

  // Format: text (default)
  // Group skills by namespace
  const byNamespace = new Map<string, Skill[]>();
  for (const skill of skills) {
    const namespace = skill.skillRef.split(":")[0] ?? "unknown";
    if (!byNamespace.has(namespace)) {
      byNamespace.set(namespace, []);
    }
    byNamespace.get(namespace)?.push(skill);
  }

  // Sort namespaces: project, user, then plugins alphabetically
  const sortedNamespaces = Array.from(byNamespace.keys()).sort((a, b) => {
    if (a === "project") return -1;
    if (b === "project") return 1;
    if (a === "user") return -1;
    if (b === "user") return 1;
    return a.localeCompare(b);
  });

  const filterMsg = sourceFilters
    ? ` (filtered by: ${sourceFilters.join(", ")})`
    : "";
  console.log(chalk.bold(`${skills.length} skills indexed${filterMsg}\n`));

  for (const namespace of sortedNamespaces) {
    const namespaceSkills = byNamespace.get(namespace) ?? [];
    console.log(chalk.bold.cyan(`${namespace}:`));

    for (const skill of namespaceSkills.sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      console.log(`  ${chalk.green(skill.name)}`);
      console.log(`    ${chalk.dim(skill.skillRef)}`);
      if (skill.description) {
        console.log(`    ${skill.description}`);
      }
    }
    console.log();
  }
}

/**
 * Show one or more skills
 */
async function showSkills(
  skillRefs: string[],
  sourceFilters: string[] | undefined,
  format: OutputFormat
): Promise<void> {
  const cache = loadCaches();
  const config = loadConfig();
  const results: Array<{ ref: string; skill: Skill; content: string }> = [];

  for (const ref of skillRefs) {
    if (!ref) continue;

    const result = await resolveInput(ref, cache, config, sourceFilters);

    if (result.type === "error") {
      if (format === "json") {
        console.log(
          JSON.stringify(
            {
              error: result.message,
              ref,
              candidates: result.candidates?.map((c) => c.skillRef) ?? [],
            },
            null,
            2
          )
        );
      } else {
        console.error(chalk.red(result.message));
        if (result.candidates && result.candidates.length > 0) {
          console.error(chalk.yellow("Did you mean:"));
          for (const c of result.candidates) {
            console.error(chalk.yellow(`  ${c.skillRef}`));
          }
        }
      }
      process.exit(1);
    }

    if (result.type === "namespace") {
      // Show namespace tree
      if (format === "json") {
        const namespaceSkills = Object.values(cache.skills).filter((s) =>
          s.skillRef.startsWith(`${result.namespace}:`)
        );
        console.log(
          JSON.stringify(
            { namespace: result.namespace, skills: namespaceSkills },
            null,
            2
          )
        );
      } else {
        const tree = await buildNamespaceTree(result.namespace, cache);
        console.log(tree);
      }
      continue;
    }

    // Get the skill
    const skill =
      result.type === "skill"
        ? result.skill
        : await resolvePathToSkill(result.path);

    if (!skill) {
      const message = `Could not resolve skill: ${ref}`;
      if (format === "json") {
        console.log(JSON.stringify({ error: message, ref }, null, 2));
      } else {
        console.error(chalk.red(message));
      }
      process.exit(1);
    }

    // Read skill content
    try {
      const content = await Bun.file(skill.path).text();
      results.push({ ref, skill, content });
    } catch {
      const message = `Could not read skill content: ${skill.path}`;
      if (format === "json") {
        console.log(
          JSON.stringify({ error: message, ref, path: skill.path }, null, 2)
        );
      } else {
        console.error(chalk.red(message));
      }
      process.exit(1);
    }
  }

  // Output all results in the requested format
  if (format === "json") {
    const output = results.map(({ skill, content }) => ({
      skillRef: skill.skillRef,
      name: skill.name,
      description: skill.description,
      path: skill.path,
      content,
      lineCount: skill.lineCount,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (format === "raw") {
    // Raw concatenated content
    for (const { content } of results) {
      console.log(content);
    }
    return;
  }

  // Format: text (with metadata header and frontmatter stripped)
  for (let i = 0; i < results.length; i++) {
    const { skill, content } = results[i] as {
      skill: Skill;
      content: string;
    };

    // Metadata header
    console.log(chalk.bold(skill.name));
    console.log(chalk.dim(skill.skillRef));
    if (skill.description) {
      console.log(skill.description);
    }
    console.log(chalk.dim(skill.path));
    console.log();

    // Content with frontmatter stripped
    const strippedContent = stripFrontmatter(content);
    console.log(strippedContent);

    // Add separator if not the last item
    if (i < results.length - 1) {
      console.log(`\n${chalk.dim("─".repeat(80))}\n`);
    }
  }
}

type ResolveInputResult =
  | { type: "skill"; skill: Skill }
  | { type: "namespace"; namespace: string }
  | { type: "path"; path: string }
  | { type: "error"; message: string; candidates?: Skill[] };

async function resolveInput(
  input: string,
  cache: ReturnType<typeof loadCaches>,
  config: ReturnType<typeof loadConfig>,
  sourceFilters?: string[]
): Promise<ResolveInputResult> {
  // Check if it's a file/directory path
  const resolvedPath = isAbsolute(input)
    ? input
    : resolve(process.cwd(), input);
  try {
    const stat = statSync(resolvedPath);
    if (stat.isFile() && resolvedPath.endsWith("SKILL.md")) {
      return { type: "path", path: resolvedPath };
    }
    if (stat.isDirectory()) {
      const skillPath = join(resolvedPath, "SKILL.md");
      if (await Bun.file(skillPath).exists()) {
        return { type: "path", path: skillPath };
      }
      // Directory without SKILL.md - might be a namespace directory
      return { type: "path", path: resolvedPath };
    }
  } catch {
    // Path doesn't exist, continue with other resolution methods
  }

  // Check if it's a namespace reference
  if (isNamespaceRef(input)) {
    return { type: "namespace", namespace: input };
  }

  // Check if it looks like a namespace:name pattern without being a path
  if (input.includes(":") && !input.includes("/")) {
    const [ns, name] = input.split(":");
    if (ns && name && isNamespaceRef(ns)) {
      // Try to find skills matching this namespace prefix
      let matchingSkills = Object.values(cache.skills).filter(
        (s) => s.skillRef === input || s.skillRef.startsWith(`${input}/`)
      );

      // Apply source filter if provided
      if (sourceFilters && sourceFilters.length > 0) {
        matchingSkills = matchingSkills.filter((s) =>
          matchesSourceFilter(s.skillRef, sourceFilters)
        );
      }

      if (matchingSkills.length === 1 && matchingSkills[0]) {
        return { type: "skill", skill: matchingSkills[0] };
      }
      if (matchingSkills.length > 1) {
        // It's a namespace with multiple skills
        return { type: "namespace", namespace: input };
      }
    }
  }

  // Try to resolve as an alias
  const token = normalizeAlias(input);
  const result = resolveToken(token, config, cache);

  if (result.skill) {
    // Check if the resolved skill matches source filter
    if (
      sourceFilters &&
      sourceFilters.length > 0 &&
      !matchesSourceFilter(result.skill.skillRef, sourceFilters)
    ) {
      return {
        type: "error",
        message: `Skill "${input}" resolved to ${result.skill.skillRef}, which doesn't match source filter(s): ${sourceFilters.join(", ")}`,
      };
    }
    return { type: "skill", skill: result.skill };
  }

  if (result.reason === "ambiguous" && result.candidates) {
    const candidates = result.candidates;

    // Apply source filter to disambiguate
    if (sourceFilters && sourceFilters.length > 0) {
      const filteredCandidates = candidates.filter((c) =>
        matchesSourceFilter(c.skillRef, sourceFilters)
      );

      if (filteredCandidates.length === 1 && filteredCandidates[0]) {
        // Source filter successfully disambiguated
        return { type: "skill", skill: filteredCandidates[0] };
      }

      if (filteredCandidates.length > 1) {
        // Still ambiguous after filtering
        return {
          type: "error",
          message: `Ambiguous alias "${input}" (after filtering by source: ${sourceFilters.join(", ")})`,
          candidates: filteredCandidates,
        };
      }

      // No matches after filtering
      return {
        type: "error",
        message: `No matches for "${input}" with source filter(s): ${sourceFilters.join(", ")}`,
        candidates,
      };
    }

    return {
      type: "error",
      message: `Ambiguous alias "${input}"`,
      candidates,
    };
  }

  return { type: "error", message: `Could not resolve "${input}"` };
}

async function resolvePathToSkill(path: string): Promise<Skill | undefined> {
  const skillPath = path.endsWith("SKILL.md") ? path : join(path, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) return undefined;

  try {
    const content = await file.text();
    const name =
      extractSkillName(content) ??
      dirname(skillPath).split("/").pop() ??
      "unknown";
    const description = extractSkillDescription(content);

    return {
      skillRef: `path:${skillPath}`,
      path: skillPath,
      name,
      description,
      structure: undefined,
      lineCount: content.split("\n").length,
      cachedAt: undefined,
    };
  } catch {
    return undefined;
  }
}

function extractSkillName(content: string): string | undefined {
  // Look for name in frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch?.[1]) {
    const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)$/m);
    if (nameMatch?.[1]) {
      return nameMatch[1].trim();
    }
  }
  // Fall back to first heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  return headingMatch?.[1]?.trim();
}

function extractSkillDescription(content: string): string | undefined {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch?.[1]) {
    const descMatch = frontmatterMatch[1].match(/^description:\s*(.+)$/m);
    if (descMatch?.[1]) {
      return descMatch[1].trim();
    }
  }
  return undefined;
}

/**
 * Show the current merged configuration
 */
function showConfig(): void {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
}

/**
 * Get a config value using dot notation
 */
function getConfigCommand(key: string): void {
  const config = loadConfig();
  const value = getConfigValue(config, key);

  if (value === undefined) {
    console.error(chalk.red(`Config key not found: ${key}`));
    process.exit(1);
  }

  // Output the value based on its type
  if (typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

/**
 * Set a config value using dot notation
 */
function setConfigCommand(
  key: string,
  valueStr: string,
  scope: "project" | "local" | "user"
): void {
  // Parse the value (support JSON strings, numbers, booleans)
  let value: unknown;
  try {
    // Try to parse as JSON first
    value = JSON.parse(valueStr);
  } catch {
    // If not valid JSON, treat as string
    value = valueStr;
  }

  // Read the current config for this scope
  const currentConfig = readConfigByScope(scope);

  // Set the value
  const updatedConfig = setConfigValue(currentConfig, key, value);

  // Write back to the file
  writeConfig(scope, updatedConfig);

  const scopeLabel =
    scope === "local" ? "local" : scope === "user" ? "user" : "project";
  console.log(
    chalk.green(`✓ Set ${key} = ${JSON.stringify(value)} (${scopeLabel})`)
  );
}

/**
 * Open config file in editor
 */
async function editConfig(scope: "project" | "local" | "user"): Promise<void> {
  const configPath = getConfigPath(scope);
  const editor = process.env.EDITOR || process.env.VISUAL || "vim";

  return new Promise((resolve, reject) => {
    const child = spawn(editor, [configPath], {
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        console.log(chalk.green(`✓ Config edited: ${configPath}`));
        resolve();
      } else {
        console.error(chalk.red(`Editor exited with code ${code}`));
        reject(new Error(`Editor exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      console.error(chalk.red(`Failed to open editor: ${err.message}`));
      reject(err);
    });
  });
}

function normalizeAlias(raw: string) {
  const cleaned = raw.startsWith("w/") ? raw.slice(2) : raw;
  const [ns, alias] = cleaned.includes(":")
    ? cleaned.split(":")
    : [undefined, cleaned];
  return { raw: `w/${cleaned}`, alias: alias ?? cleaned, namespace: ns };
}

/**
 * Validate scope parameter
 */
function validateScope(
  scope: string | undefined
): "project" | "local" | "user" {
  if (!scope || scope === "project") return "project";
  if (scope === "local") return "local";
  if (scope === "user") return "user";
  console.error(
    chalk.red(`Invalid scope "${scope}". Must be: project, local, or user`)
  );
  process.exit(1);
}

/**
 * Prompt user for confirmation
 */
async function getUserConfirmation(): Promise<boolean> {
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: "Do you want to overwrite this alias?",
      default: false,
    },
  ]);
  return answer.confirmed;
}

/**
 * Handle alias command
 */
async function handleAliasCommand(
  name: string,
  skillRef: string,
  scope: "project" | "local" | "user",
  force: boolean
): Promise<void> {
  const { readConfigByScope, writeConfig, getConfigPath } = await import(
    "@skillset/core"
  );

  const currentConfig = readConfigByScope(scope);
  const existingMapping = currentConfig.mappings?.[name];

  // Check if alias exists and prompt for confirmation if needed
  if (existingMapping && !force) {
    console.log(
      chalk.yellow(
        `Alias '${name}' already exists → ${existingMapping.skillRef} (${scope})`
      )
    );
    const confirmed = await getUserConfirmation();
    if (!confirmed) {
      console.log(chalk.dim("Alias update cancelled"));
      return;
    }
  }

  // Update config
  const updatedConfig = {
    ...currentConfig,
    mappings: {
      ...currentConfig.mappings,
      [name]: { skillRef },
    },
  };

  writeConfig(scope, updatedConfig);

  const action = existingMapping ? "Updated" : "Added";
  console.log(
    chalk.green(`${action} alias '${name}' → ${skillRef} (${scope})`)
  );
  console.log(chalk.dim(`Config: ${getConfigPath(scope)}`));
}

/**
 * Handle unalias command
 */
async function handleUnaliasCommand(
  name: string,
  scope: "project" | "local" | "user"
): Promise<void> {
  const currentConfig = readConfigByScope(scope);
  const existingMapping = currentConfig.mappings?.[name];

  if (!existingMapping) {
    console.error(chalk.red(`Alias '${name}' not found in ${scope} config`));
    process.exit(1);
  }

  // Remove the alias
  const updatedMappings = { ...currentConfig.mappings };
  delete updatedMappings[name];

  const updatedConfig = {
    ...currentConfig,
    mappings: updatedMappings,
  };

  writeConfig(scope, updatedConfig);

  console.log(
    chalk.green(`Removed alias '${name}' (was → ${existingMapping.skillRef})`)
  );
  console.log(chalk.dim(`Config: ${getConfigPath(scope)}`));
}

/**
 * Initialize skillset configuration files
 */
function initConfig(scopeArg: string, force: boolean): void {
  const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
  const { dirname } = require("node:path");

  const defaultConfig = {
    version: 1,
    mode: "warn" as const,
    showStructure: false,
    maxLines: 500,
    mappings: {},
    namespaceAliases: {},
  };

  const validatedScope = scopeArg.toLowerCase();
  if (
    validatedScope !== "both" &&
    validatedScope !== "project" &&
    validatedScope !== "user"
  ) {
    console.error(
      chalk.red(
        `Invalid scope: ${scopeArg}. Must be 'project', 'user', or 'both'`
      )
    );
    process.exit(1);
  }

  const scopes: Array<"project" | "user"> = [];
  if (validatedScope === "both") {
    scopes.push("project", "user");
  } else {
    scopes.push(validatedScope as "project" | "user");
  }

  let created = 0;
  let skipped = 0;

  for (const scope of scopes) {
    const configPath = CONFIG_PATHS[scope];
    const exists = existsSync(configPath);

    if (exists && !force) {
      console.log(chalk.yellow(`Config already exists: ${configPath}`));
      console.log(chalk.dim("Use --force to overwrite"));
      skipped++;
      continue;
    }

    // Create directory if needed
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write default config
    writeFileSync(
      configPath,
      JSON.stringify(defaultConfig, null, 2) + "\n",
      "utf8"
    );

    if (exists) {
      console.log(chalk.green(`✓ Overwrote config: ${configPath}`));
    } else {
      console.log(chalk.green(`✓ Created config: ${configPath}`));
    }
    created++;
  }

  // Summary
  if (created > 0 && skipped === 0) {
    console.log(
      chalk.green(`\n✓ Successfully initialized ${created} config file(s)`)
    );
  } else if (created > 0 && skipped > 0) {
    console.log(
      chalk.yellow(
        `\n✓ Initialized ${created} config file(s), skipped ${skipped}`
      )
    );
  } else if (skipped > 0 && created === 0) {
    console.log(chalk.yellow("\nNo configs created (all already exist)"));
  }
}
