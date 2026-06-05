import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { TargetName } from "./types";
import { validateSlug } from "./path";

const DEFAULT_CREATE_NAME = "my-skillset";
const DEFAULT_GLOBAL_SOURCE = ".skillset/src";
const INSTRUCTIONS_DIR = ".skillset/instructions";
const SETUP_SOURCE_DIR = ".skillset/src";

export interface SetupOptions {
  readonly cwd?: string;
  readonly global?: boolean;
  readonly homeDir?: string;
  readonly includeAgents?: boolean;
  readonly includeIslands?: boolean;
  readonly includeProjectDoc?: boolean;
  readonly name?: string;
  readonly rootPath?: string;
  readonly targets?: readonly TargetName[];
  readonly write?: boolean;
}

export interface SetupFile {
  readonly path: string;
  readonly status: "create" | "exists";
}

export interface SetupReport {
  readonly files: readonly SetupFile[];
  readonly kind: "create" | "init";
  readonly rootPath: string;
  readonly sourceDir: string;
  readonly write: boolean;
}

interface PlannedFile {
  readonly content: string;
  readonly path: string;
}

export async function initSkillset(options: SetupOptions = {}): Promise<SetupReport> {
  const rootPath = resolve(options.cwd ?? process.cwd(), options.rootPath ?? ".");
  return applySetupPlan("init", rootPath, options);
}

export async function createSkillset(options: SetupOptions = {}): Promise<SetupReport> {
  const rootPath = createRootPath(options);
  if (await pathExists(rootPath)) {
    const stats = await stat(rootPath);
    if (!stats.isDirectory()) {
      throw new Error(`skillset: create target exists and is not a directory: ${rootPath}`);
    }
    const entries = await readdir(rootPath);
    if (entries.length > 0) {
      throw new Error(`skillset: create target must be empty: ${rootPath}`);
    }
  }
  return applySetupPlan("create", rootPath, options);
}

export function defaultGlobalSourcePath(homeDir = process.env.HOME ?? "~"): string {
  return resolve(homeDir, DEFAULT_GLOBAL_SOURCE);
}

async function applySetupPlan(
  kind: SetupReport["kind"],
  rootPath: string,
  options: SetupOptions
): Promise<SetupReport> {
  const name = options.name === undefined
    ? defaultSetupName(kind, rootPath)
    : validateSlug(options.name, "skillset setup name");
  const targets = normalizeTargets(options.targets);
  const plannedFiles = setupFiles({ ...options, name, targets });
  const files: SetupFile[] = [];

  for (const file of plannedFiles) {
    const absolutePath = join(rootPath, file.path);
    const existing = await readExistingFile(absolutePath);
    if (existing !== undefined && existing !== file.content) {
      throw new Error(`skillset: refusing to overwrite existing setup file ${file.path}`);
    }
    files.push({ path: file.path, status: existing === undefined ? "create" : "exists" });
  }

  if (options.write === true) {
    for (const file of plannedFiles) {
      const absolutePath = join(rootPath, file.path);
      const existing = await readExistingFile(absolutePath);
      if (existing !== undefined) continue;
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.content);
    }
  }

  return {
    files,
    kind,
    rootPath,
    sourceDir: SETUP_SOURCE_DIR,
    write: options.write === true,
  };
}

function setupFiles(options: Required<Pick<SetupOptions, "name" | "targets">> & SetupOptions): readonly PlannedFile[] {
  const files: PlannedFile[] = [
    {
      path: ".skillset/config.yaml",
      content: rootConfig(options.name, options.targets),
    },
    {
      path: `${SETUP_SOURCE_DIR}/.gitkeep`,
      content: "",
    },
  ];

  if (options.includeProjectDoc === true) {
    files.push({
      path: `${INSTRUCTIONS_DIR}/project.md`,
      content: "# Project Notes\n\nAdd project-scoped setup notes here.\n",
    });
  }
  if (options.includeAgents === true) {
    files.push({
      path: `${SETUP_SOURCE_DIR}/agents/.gitkeep`,
      content: "",
    });
  }
  if (options.includeIslands === true) {
    files.push(
      { path: `${SETUP_SOURCE_DIR}/claude/.gitkeep`, content: "" },
      { path: `${SETUP_SOURCE_DIR}/codex/rules/.gitkeep`, content: "" }
    );
  }

  return files;
}

function rootConfig(name: string, targets: readonly TargetName[]): string {
  const targetLines = targets.map((target) => `    - ${target}`).join("\n");
  return [
    "skillset:",
    `  name: ${name}`,
    "compile:",
    "  targets:",
    targetLines,
    "",
  ].join("\n");
}

function createRootPath(options: SetupOptions): string {
  if (options.rootPath !== undefined) return resolve(options.cwd ?? process.cwd(), options.rootPath);
  if (options.global === true) return defaultGlobalSourcePath(options.homeDir);
  return resolve(options.cwd ?? process.cwd(), DEFAULT_CREATE_NAME);
}

function defaultSetupName(kind: SetupReport["kind"], rootPath: string): string {
  if (kind === "create" && basename(rootPath) === "src" && basename(join(rootPath, "..")) === ".skillset") {
    return DEFAULT_CREATE_NAME;
  }
  const slug = slugifySetupName(basename(rootPath));
  return slug.length === 0 ? DEFAULT_CREATE_NAME : slug;
}

function slugifySetupName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTargets(targets: readonly TargetName[] | undefined): readonly TargetName[] {
  if (targets === undefined || targets.length === 0) return ["claude", "codex"];
  const seen = new Set<TargetName>();
  for (const target of targets) {
    if (target !== "claude" && target !== "codex") {
      throw new Error(`skillset: unsupported setup target ${JSON.stringify(target)}`);
    }
    seen.add(target);
  }
  return [...seen];
}

async function readExistingFile(path: string): Promise<string | undefined> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      throw new Error(`skillset: refusing to overwrite non-file setup path ${path}`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
