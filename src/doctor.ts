import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { CACHE_PATHS, loadCaches } from "./cache";
import { CONFIG_PATHS, loadConfig } from "./config";
import { resolveToken } from "./resolver";

/**
 * Helper to normalize alias for resolution
 */
function normalizeAlias(raw: string) {
	const cleaned = raw.startsWith("w/") ? raw.slice(2) : raw;
	const [ns, alias] = cleaned.includes(":")
		? cleaned.split(":")
		: [undefined, cleaned];
	return { raw: `w/${cleaned}`, alias: alias ?? cleaned, namespace: ns };
}

/**
 * Run full diagnostic check
 */
export function runFullDiagnostic(): void {
	console.log(chalk.bold("wskill doctor"));
	console.log("─".repeat(40));

	// Check config files
	const projectConfigExists = existsSync(CONFIG_PATHS.project);
	const localConfigExists = existsSync(CONFIG_PATHS.projectLocal);
	const userConfigExists = existsSync(CONFIG_PATHS.user);

	if (projectConfigExists) {
		console.log(
			`${chalk.green("✓")} Config: project (${CONFIG_PATHS.project})`,
		);
	} else {
		console.log(`${chalk.dim("○")} Config: project (not found)`);
	}

	if (localConfigExists) {
		console.log(
			`${chalk.green("✓")} Config: local (${CONFIG_PATHS.projectLocal})`,
		);
	} else {
		console.log(`${chalk.dim("○")} Config: local (not found)`);
	}

	if (userConfigExists) {
		console.log(`${chalk.green("✓")} Config: user (${CONFIG_PATHS.user})`);
	} else {
		console.log(`${chalk.dim("○")} Config: user (not found)`);
	}

	// Check cache
	const projectCacheExists = existsSync(CACHE_PATHS.project);

	try {
		const cache = loadCaches();
		const skillCount = Object.keys(cache.skills).length;

		// Count skills by source
		const sourceCounts = { project: 0, user: 0, plugin: 0 };
		for (const skill of Object.values(cache.skills)) {
			if (skill.skillRef.startsWith("project:")) {
				sourceCounts.project++;
			} else if (skill.skillRef.startsWith("user:")) {
				sourceCounts.user++;
			} else if (skill.skillRef.startsWith("plugin:")) {
				sourceCounts.plugin++;
			}
		}

		// Get cache age
		let cacheAge = "unknown";
		if (projectCacheExists) {
			try {
				const stat = statSync(CACHE_PATHS.project);
				const ageMs = Date.now() - stat.mtimeMs;
				const ageMinutes = Math.floor(ageMs / 60000);
				if (ageMinutes < 1) {
					cacheAge = "just now";
				} else if (ageMinutes === 1) {
					cacheAge = "1m ago";
				} else if (ageMinutes < 60) {
					cacheAge = `${ageMinutes}m ago`;
				} else {
					const ageHours = Math.floor(ageMinutes / 60);
					cacheAge = ageHours === 1 ? "1h ago" : `${ageHours}h ago`;
				}
			} catch {
				// Ignore stat errors
			}
		}

		console.log(
			`${chalk.green("✓")} Cache: ${skillCount} skills indexed (${cacheAge})`,
		);
		console.log(
			`${chalk.green("✓")} Sources: ${sourceCounts.project} project, ${sourceCounts.user} user, ${sourceCounts.plugin} plugin`,
		);
	} catch (err) {
		console.log(`${chalk.red("✗")} Cache: Error loading cache`);
		if (err instanceof Error) {
			console.log(`  ${chalk.dim(err.message)}`);
		}
	}

	// Check for plugins
	const pluginsDir = join(homedir(), ".claude", "plugins");
	if (existsSync(pluginsDir)) {
		console.log(
			`${chalk.green("✓")} Plugins: directory exists (${pluginsDir})`,
		);
	} else {
		console.log(`${chalk.dim("○")} Plugins: directory not found`);
	}

	// Hook detection (check if wskill plugin exists)
	const wskillPluginDir = join(homedir(), ".claude", "plugins", "wskill");
	if (existsSync(wskillPluginDir)) {
		console.log(
			`${chalk.green("✓")} Hook: Plugin detected (${wskillPluginDir})`,
		);
	} else {
		console.log(`${chalk.yellow("⚠")} Hook: Plugin not detected`);
	}
}

/**
 * Run config-specific diagnostic
 */
export function runConfigDiagnostic(): void {
	console.log(chalk.bold("wskill doctor config"));
	console.log("─".repeat(40));

	// Show which config files exist
	console.log(chalk.bold("\nConfig files:"));

	const projectConfigExists = existsSync(CONFIG_PATHS.project);
	const localConfigExists = existsSync(CONFIG_PATHS.projectLocal);
	const userConfigExists = existsSync(CONFIG_PATHS.user);

	console.log(
		`  Project: ${projectConfigExists ? chalk.green("exists") : chalk.dim("not found")}`,
	);
	console.log(`    ${chalk.dim(CONFIG_PATHS.project)}`);

	console.log(
		`  Local:   ${localConfigExists ? chalk.green("exists") : chalk.dim("not found")}`,
	);
	console.log(`    ${chalk.dim(CONFIG_PATHS.projectLocal)}`);

	console.log(
		`  User:    ${userConfigExists ? chalk.green("exists") : chalk.dim("not found")}`,
	);
	console.log(`    ${chalk.dim(CONFIG_PATHS.user)}`);

	// Try to load and validate merged config
	console.log(chalk.bold("\nMerged config:"));
	try {
		const config = loadConfig();
		console.log(JSON.stringify(config, null, 2));

		// Validate config schema
		console.log(chalk.bold("\nValidation:"));
		const errors: string[] = [];

		if (typeof config.version !== "number") {
			errors.push("version must be a number");
		}
		if (config.mode !== "warn" && config.mode !== "strict") {
			errors.push("mode must be 'warn' or 'strict'");
		}
		if (typeof config.showStructure !== "boolean") {
			errors.push("showStructure must be a boolean");
		}
		if (typeof config.maxLines !== "number") {
			errors.push("maxLines must be a number");
		}
		if (typeof config.mappings !== "object") {
			errors.push("mappings must be an object");
		}
		if (typeof config.namespaceAliases !== "object") {
			errors.push("namespaceAliases must be an object");
		}

		if (errors.length === 0) {
			console.log(`${chalk.green("✓")} Config schema is valid`);
		} else {
			console.log(`${chalk.red("✗")} Config schema has errors:`);
			for (const error of errors) {
				console.log(`  ${chalk.red("•")} ${error}`);
			}
		}
	} catch (err) {
		console.log(`${chalk.red("✗")} Error loading config:`);
		if (err instanceof Error) {
			console.log(`  ${err.message}`);
		}
	}
}

/**
 * Run skill-specific diagnostic
 */
export async function runSkillDiagnostic(skillAlias: string): Promise<void> {
	console.log(chalk.bold(`wskill doctor ${skillAlias}`));
	console.log("─".repeat(40));

	const cache = loadCaches();
	const config = loadConfig();

	// Normalize the alias
	const token = normalizeAlias(skillAlias);

	console.log(chalk.bold("\nResolution:"));
	console.log(`  Input: ${chalk.cyan(skillAlias)}`);
	console.log(`  Token: ${chalk.dim(JSON.stringify(token))}`);

	// Try to resolve
	const result = resolveToken(token, config, cache);

	if (result.skill) {
		console.log(
			`  ${chalk.green("✓")} Resolved to: ${chalk.green(result.skill.skillRef)}`,
		);
		console.log();
		console.log(chalk.bold("Skill details:"));
		console.log(`  Name: ${result.skill.name}`);
		console.log(
			`  Description: ${result.skill.description ?? chalk.dim("(none)")}`,
		);
		console.log(`  Path: ${result.skill.path}`);
		console.log(`  Lines: ${result.skill.lineCount ?? chalk.dim("unknown")}`);
	} else if (result.reason === "ambiguous" && result.candidates) {
		console.log(`  ${chalk.yellow("⚠")} Ambiguous - multiple matches found:`);
		console.log();
		console.log(chalk.bold("Candidates:"));
		for (const candidate of result.candidates) {
			console.log(`  ${chalk.yellow("•")} ${candidate.skillRef}`);
			console.log(`    ${chalk.dim(candidate.name)}`);
			console.log(`    ${chalk.dim(candidate.path)}`);
		}
		console.log();
		console.log(
			chalk.yellow(
				"Suggestion: Use a more specific alias or add a namespace prefix",
			),
		);
	} else if (result.reason === "unmatched") {
		console.log(`  ${chalk.red("✗")} Not found`);
		console.log();
		console.log(chalk.bold("Suggestions:"));
		console.log(`  • Run ${chalk.cyan("wskill index")} to refresh the cache`);
		console.log(`  • Check that the skill exists with ${chalk.cyan("wskill")}`);
		console.log("  • Try a different alias or namespace");
	} else {
		console.log(
			`  ${chalk.red("✗")} Resolution failed: ${result.reason ?? "unknown error"}`,
		);
	}

	// Show all sources where this skill might exist
	console.log();
	console.log(chalk.bold("All matching skills in cache:"));
	const allMatches = Object.values(cache.skills).filter(
		(s) =>
			s.name.toLowerCase().includes(token.alias.toLowerCase()) ||
			s.skillRef.toLowerCase().includes(token.alias.toLowerCase()),
	);

	if (allMatches.length === 0) {
		console.log(`  ${chalk.dim("(none)")}`);
	} else {
		for (const match of allMatches) {
			console.log(`  ${chalk.cyan("•")} ${match.skillRef}`);
			console.log(`    ${chalk.dim(match.name)}`);
		}
	}
}
