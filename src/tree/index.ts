import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import treeify from "object-treeify";
import type { CacheSchema, Skill } from "../types";
import { headingsToTreeObject, parseMarkdownHeadings } from "./markdown";

export { parseMarkdownHeadings, headingsToTreeObject } from "./markdown";

interface TreeOptions {
	/** Include markdown heading structure for SKILL.md files */
	includeMarkdown?: boolean;
	/** Maximum depth to recurse */
	maxDepth?: number;
}

/**
 * Build a tree for a single skill, showing its directory + SKILL.md headings.
 */
export async function buildSkillTree(
	skill: Skill,
	options: TreeOptions = {},
): Promise<string> {
	const { includeMarkdown = true } = options;
	const skillDir = dirname(skill.path);
	const dirName = basename(skillDir);

	const treeObj = await buildDirectoryTree(
		skillDir,
		skill.path,
		includeMarkdown,
		0,
		options.maxDepth ?? 5,
	);

	return treeify({ [dirName]: treeObj });
}

/**
 * Build a tree for a namespace, showing all skills in that namespace.
 */
export async function buildNamespaceTree(
	namespace: string,
	cache: CacheSchema,
	options: TreeOptions = {},
): Promise<string> {
	const { includeMarkdown = true, maxDepth = 5 } = options;

	// Find all skills in this namespace
	const skills = Object.values(cache.skills).filter(
		(skill) =>
			skill.skillRef.startsWith(`${namespace}:`) ||
			skill.skillRef.startsWith(`${namespace}/`),
	);

	if (skills.length === 0) {
		return `${namespace}/\n  (no skills found)`;
	}

	// Group skills by their base directory
	const treeObj: Record<string, unknown> = {};

	for (const skill of skills) {
		const skillDir = dirname(skill.path);
		const skillDirName = basename(skillDir);
		const dirTree = await buildDirectoryTree(
			skillDir,
			skill.path,
			includeMarkdown,
			0,
			maxDepth,
		);
		treeObj[skillDirName] = dirTree;
	}

	return treeify({ [`${namespace}/`]: treeObj });
}

/**
 * Build a tree from a direct path (directory or SKILL.md file).
 */
export async function buildPathTree(
	path: string,
	options: TreeOptions = {},
): Promise<string> {
	const { includeMarkdown = true, maxDepth = 5 } = options;

	const stat = statSync(path);

	if (stat.isFile()) {
		// It's a SKILL.md file
		const dir = dirname(path);
		const dirName = basename(dir);
		const treeObj = await buildDirectoryTree(
			dir,
			path,
			includeMarkdown,
			0,
			maxDepth,
		);
		return treeify({ [dirName]: treeObj });
	}

	// It's a directory - check for SKILL.md
	const skillPath = join(path, "SKILL.md");
	const hasSkill = await Bun.file(skillPath).exists();
	const dirName = basename(path);
	const treeObj = await buildDirectoryTree(
		path,
		hasSkill ? skillPath : undefined,
		includeMarkdown,
		0,
		maxDepth,
	);
	return treeify({ [dirName]: treeObj });
}

/**
 * Recursively build directory tree, only including dirs that contain SKILL.md
 * somewhere in their subtree (for namespace view) or all files (for skill view).
 */
async function buildDirectoryTree(
	dirPath: string,
	skillPath: string | undefined,
	includeMarkdown: boolean,
	depth: number,
	maxDepth: number,
): Promise<Record<string, unknown>> {
	if (depth >= maxDepth) {
		return { "...": null };
	}

	const result: Record<string, unknown> = {};

	let entries: string[];
	try {
		entries = readdirSync(dirPath);
	} catch {
		return result;
	}

	// Sort: SKILL.md first, then directories, then other files
	const sorted = entries
		.filter((e) => !e.startsWith("."))
		.sort((a, b) => {
			// SKILL.md always first
			if (a === "SKILL.md") return -1;
			if (b === "SKILL.md") return 1;

			const aPath = join(dirPath, a);
			const bPath = join(dirPath, b);
			const aIsDir = statSync(aPath).isDirectory();
			const bIsDir = statSync(bPath).isDirectory();
			if (aIsDir && !bIsDir) return -1;
			if (!aIsDir && bIsDir) return 1;
			return a.localeCompare(b);
		});

	for (const entry of sorted) {
		const entryPath = join(dirPath, entry);
		const stat = statSync(entryPath);

		if (stat.isDirectory()) {
			// Check if this directory or its children contain SKILL.md
			if (await hasSkillMdInSubtree(entryPath)) {
				result[`${entry}/`] = await buildDirectoryTree(
					entryPath,
					undefined,
					includeMarkdown,
					depth + 1,
					maxDepth,
				);
			} else {
				// Just show directory name without recursing deep
				result[`${entry}/`] = null;
			}
		} else if (entry === "SKILL.md" && includeMarkdown) {
			// This is a SKILL.md - inline its headings
			try {
				const content = await Bun.file(entryPath).text();
				const headings = parseMarkdownHeadings(content);
				if (headings.length > 0) {
					result["SKILL.md"] = headingsToTreeObject(headings);
				} else {
					result["SKILL.md"] = null;
				}
			} catch {
				result["SKILL.md"] = null;
			}
		} else {
			// Regular file
			result[entry] = null;
		}
	}

	return result;
}

/**
 * Check if a directory or any of its subdirectories contains a SKILL.md file.
 */
async function hasSkillMdInSubtree(dirPath: string): Promise<boolean> {
	try {
		const entries = readdirSync(dirPath);

		for (const entry of entries) {
			if (entry === "SKILL.md") return true;

			const entryPath = join(dirPath, entry);
			const stat = statSync(entryPath);

			if (stat.isDirectory() && !entry.startsWith(".")) {
				if (await hasSkillMdInSubtree(entryPath)) return true;
			}
		}
	} catch {
		// Ignore errors
	}

	return false;
}

/**
 * Determine if input is a namespace reference.
 */
export function isNamespaceRef(input: string): boolean {
	// Namespace refs look like: project, user, plugin:name
	// They don't contain path separators and match known patterns
	return input === "project" || input === "user" || input.startsWith("plugin:");
}
