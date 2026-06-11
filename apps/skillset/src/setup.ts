import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { seedReleaseBaselines, type ReleaseBaselineEntry } from "./adoption";
import { CI_WORKFLOW_PATH, renderCiWorkflow } from "./ci";
import { validateConfigDocument } from "./config";
import { gitSafeEnv } from "./git-env";
import type { TargetName } from "./types";
import { validateSlug } from "./path";
import { parseYamlRecord } from "./yaml";

const DEFAULT_CREATE_NAME = "my-skillset";
const DEFAULT_GLOBAL_SOURCE = ".skillset/src";
const SETUP_SOURCE_DIR = ".skillset/src";

export type SetupInclude = "agents" | "ci";

export interface SetupOptions {
  readonly cwd?: string;
  readonly global?: boolean;
  readonly homeDir?: string;
  readonly include?: readonly SetupInclude[];
  readonly name?: string;
  readonly rootPath?: string;
  readonly targets?: readonly TargetName[];
  readonly useGitRoot?: boolean;
  readonly write?: boolean;
}

export interface SetupFile {
  readonly path: string;
  readonly status: "create" | "exists";
}

export interface SetupReport {
  readonly baselines: readonly ReleaseBaselineEntry[];
  readonly files: readonly SetupFile[];
  readonly importCandidates: readonly SetupImportCandidate[];
  readonly kind: "create" | "init";
  readonly rootPath: string;
  readonly sourceDir: string;
  readonly surveySkips: readonly SurveySkip[];
  readonly write: boolean;
}

export interface SetupImportCandidate {
  readonly kind: "instructions" | "plugin" | "plugins" | "skills";
  readonly path: string;
}

/**
 * A recognized adoption surface Skillset cannot import yet. The survey
 * contract from the adoption ADR: anything recognized becomes a candidate or
 * a structured skip with a reason — never silence.
 */
export interface SurveySkip {
  readonly path: string;
  readonly reason: string;
  readonly surface: string;
}

interface PlannedFile {
  readonly content: string;
  readonly path: string;
}

export async function initSkillset(options: SetupOptions = {}): Promise<SetupReport> {
  const rootPath = await initRootPath(options);
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
  // Captured before any writes: this run's own config scaffold must not make
  // the repo look pre-adopted to the survey.
  const alreadyAdopted = await pathExists(join(rootPath, ".skillset/config.yaml"));
  const targets = normalizeTargets(options.targets);
  const plannedFiles = setupFiles({ ...options, name, targets });
  const files: SetupFile[] = [];

  for (const file of plannedFiles) {
    const absolutePath = join(rootPath, file.path);
    const existing = await readExistingFile(absolutePath);
    if (existing !== undefined && existing !== file.content) {
      if (kind === "init" && file.path === ".skillset/config.yaml") {
        await validateExistingRootConfig(absolutePath);
        files.push({ path: file.path, status: "exists" });
        continue;
      }
      // The scaffolded CI workflow is user-owned after creation; keep edits.
      if (file.path === CI_WORKFLOW_PATH) {
        files.push({ path: file.path, status: "exists" });
        continue;
      }
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

  const baselines = kind === "init"
    ? (await seedReleaseBaselines(rootPath, {}, { write: options.write === true })).entries
    : [];
  const importCandidates = kind === "init" ? await detectImportCandidates(rootPath, alreadyAdopted) : [];
  const surveySkips = kind === "init" ? await detectSurveySkips(rootPath) : [];

  return {
    baselines,
    files,
    importCandidates,
    kind,
    rootPath,
    sourceDir: SETUP_SOURCE_DIR,
    surveySkips,
    write: options.write === true,
  };
}

async function initRootPath(options: SetupOptions): Promise<string> {
  const cwd = resolve(options.cwd ?? process.cwd());
  if (options.rootPath !== undefined) return resolve(cwd, options.rootPath);
  if (options.useGitRoot === false) return cwd;
  return (await gitRoot(cwd)) ?? cwd;
}

async function gitRoot(cwd: string): Promise<string | undefined> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return undefined;
  const path = stdout.trim();
  return path.length === 0 ? undefined : path;
}

async function validateExistingRootConfig(path: string): Promise<void> {
  const content = await readFile(path, "utf8");
  validateConfigDocument(parseYamlRecord(content, path), path, { allowCompile: true });
}

const GENERATED_INSTRUCTIONS_MARKER = "<!-- Generated by skillset";
const ROOT_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const NATIVE_PLUGIN_MANIFEST_DIRS = new Set([".claude-plugin", ".codex-plugin"]);

async function detectImportCandidates(
  rootPath: string,
  alreadyAdopted: boolean
): Promise<readonly SetupImportCandidate[]> {
  const candidates: SetupImportCandidate[] = [];
  await maybeCandidate(candidates, rootPath, ".claude/skills", "skills");
  await maybeCandidate(candidates, rootPath, ".codex/skills", "skills");
  await maybeCandidate(candidates, rootPath, ".agents/skills", "skills");
  await maybeCandidate(candidates, rootPath, "plugins-claude/plugins", "plugins");
  await maybeCandidate(candidates, rootPath, "plugins-codex/plugins", "plugins");
  if (await pathExists(join(rootPath, ".claude-plugin/plugin.json")) || await pathExists(join(rootPath, ".codex-plugin/plugin.json"))) {
    candidates.push({ kind: "plugin", path: "." });
  }
  for (const path of [...(await marketplacePluginSources(rootPath)), ...(await nestedPluginSources(rootPath))]) {
    if (!candidates.some((candidate) => candidate.kind === "plugin" && candidate.path === path)) {
      candidates.push({ kind: "plugin", path });
    }
  }
  // Instruction candidates are for un-adopted repos: an existing
  // .skillset/config.yaml means the repo already authors instructions in
  // .skillset/instructions, so its root files are (or will be) generated.
  if (!alreadyAdopted) {
    for (const name of ROOT_INSTRUCTION_FILES) {
      if (await isImportableInstructionFile(join(rootPath, name))) {
        candidates.push({ kind: "instructions", path: name });
      }
    }
  }
  return candidates.sort((left, right) => compareCandidate(left, right));
}

/**
 * Repos can nest plugin directories under a top-level plugins/ without any
 * marketplace manifest: each direct child carrying a native plugin manifest
 * is an import candidate. The same containment and managed-output guards as
 * marketplace sources apply; marketplace duplicates are deduped by the caller.
 */
async function nestedPluginSources(rootPath: string): Promise<readonly string[]> {
  const pluginsPath = join(rootPath, "plugins");
  if (!(await pathExists(pluginsPath))) return [];
  if (!(await stat(pluginsPath)).isDirectory()) return [];
  const realRoot = await realpath(rootPath);
  const sources: string[] = [];
  for (const entry of (await readdir(pluginsPath)).sort()) {
    const absolutePath = join(pluginsPath, entry);
    if (!(await pathExists(absolutePath))) continue;
    if (!(await stat(absolutePath)).isDirectory()) continue;
    const hasManifest =
      (await pathExists(join(absolutePath, ".claude-plugin/plugin.json"))) ||
      (await pathExists(join(absolutePath, ".codex-plugin/plugin.json")));
    if (!hasManifest) continue;
    const realSource = await realpath(absolutePath);
    if (realSource !== realRoot && !realSource.startsWith(`${realRoot}/`)) continue;
    if (await isManagedCandidate(absolutePath)) continue;
    const path = relative(realRoot, realSource).replaceAll("\\", "/");
    if (path.length === 0 || sources.includes(path)) continue;
    sources.push(path);
  }
  return sources;
}

/**
 * Root instruction files are candidates only when handwritten: generated
 * output carries the skillset marker and must never be suggested for import.
 */
async function isImportableInstructionFile(path: string): Promise<boolean> {
  if (!(await pathExists(path))) return false;
  if (!(await stat(path)).isFile()) return false;
  const content = await readFile(path, "utf8");
  return !content.startsWith(GENERATED_INSTRUCTIONS_MARKER);
}

/**
 * Recognized-but-unimportable surfaces. Import has no lowering for them yet;
 * `skillset adopt` will lower them in the transform milestone. Until then the
 * survey reports them with a reason instead of staying silent.
 */
async function detectSurveySkips(rootPath: string): Promise<readonly SurveySkip[]> {
  const skips: SurveySkip[] = [];
  await maybeSkip(
    skips,
    rootPath,
    ".claude/commands",
    "commands",
    "project-level commands have no portable source home yet; adopt will lower them to target-native islands in the transform milestone"
  );
  await maybeSkip(
    skips,
    rootPath,
    ".claude/agents",
    "agents",
    "project-level agents are not importable yet; adopt will lower them to .skillset/src/agents/ in the transform milestone"
  );
  await maybeSkip(
    skips,
    rootPath,
    ".claude/rules",
    "rules",
    "rules are not importable yet; adopt will lower them to .skillset/instructions/ in the transform milestone"
  );
  if (await hasNonSkillCodexContent(rootPath)) {
    skips.push({
      path: ".codex",
      reason:
        "Codex content outside .codex/skills has no portable lowering yet; adopt will lower it to target-native islands in the transform milestone",
      surface: "codex",
    });
  }
  for (const path of await foreignPluginManifests(rootPath)) {
    skips.push({
      path,
      reason: "plugin manifest for an unsupported target; skillset can only represent claude and codex surfaces",
      surface: "foreign-manifest",
    });
  }
  return skips.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

async function maybeSkip(
  skips: SurveySkip[],
  rootPath: string,
  path: string,
  surface: string,
  reason: string
): Promise<void> {
  const absolutePath = join(rootPath, path);
  if (!(await pathExists(absolutePath))) return;
  if (!(await stat(absolutePath)).isDirectory()) return;
  if (await isManagedCandidate(absolutePath)) return;
  const entries = await readdir(absolutePath);
  if (entries.filter((entry) => entry !== ".DS_Store").length === 0) return;
  skips.push({ path, reason, surface });
}

async function hasNonSkillCodexContent(rootPath: string): Promise<boolean> {
  const codexPath = join(rootPath, ".codex");
  if (!(await pathExists(codexPath))) return false;
  if (!(await stat(codexPath)).isDirectory()) return false;
  if (await isManagedCandidate(codexPath)) return false;
  const entries = await readdir(codexPath);
  return entries.some((entry) => entry !== "skills" && entry !== ".DS_Store");
}

/** Foreign `.<target>-plugin/` manifest directories (for example `.cursor-plugin/`). */
async function foreignPluginManifests(rootPath: string): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const entry of (await readdir(rootPath)).sort()) {
    if (NATIVE_PLUGIN_MANIFEST_DIRS.has(entry)) continue;
    if (!/^\.[a-z][a-z0-9]*-plugin$/.test(entry)) continue;
    const absolutePath = join(rootPath, entry);
    if (!(await pathExists(absolutePath))) continue;
    if (!(await stat(absolutePath)).isDirectory()) continue;
    paths.push(entry);
  }
  return paths;
}

/**
 * A repo can be a Claude plugin marketplace instead of a single plugin:
 * `.claude-plugin/marketplace.json` lists plugins whose `source` points at a
 * repo-relative plugin directory. Surface each existing source directory as an
 * import candidate. Candidates are suggestions, so malformed manifests or
 * entries that point outside the repo are skipped rather than failing init.
 */
async function marketplacePluginSources(rootPath: string): Promise<readonly string[]> {
  const manifestPath = join(rootPath, ".claude-plugin/marketplace.json");
  if (!(await pathExists(manifestPath))) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const plugins = (parsed as Record<string, unknown>).plugins;
  if (!Array.isArray(plugins)) return [];

  const realRoot = await realpath(rootPath);
  const sources: string[] = [];
  for (const plugin of plugins) {
    if (typeof plugin !== "object" || plugin === null || Array.isArray(plugin)) continue;
    const source = (plugin as Record<string, unknown>).source;
    if (typeof source !== "string" || source.trim().length === 0) continue;
    const absolutePath = resolve(rootPath, source);
    if (absolutePath === resolve(rootPath)) continue;
    if (!(await pathExists(absolutePath))) continue;
    if (!(await stat(absolutePath)).isDirectory()) continue;
    const realSource = await realpath(absolutePath);
    if (realSource !== realRoot && !realSource.startsWith(`${realRoot}/`)) continue;
    if (await isManagedCandidate(absolutePath)) continue;
    const path = relative(realRoot, realSource).replaceAll("\\", "/");
    if (path.length === 0 || sources.includes(path)) continue;
    sources.push(path);
  }
  return sources;
}

async function maybeCandidate(
  candidates: SetupImportCandidate[],
  rootPath: string,
  path: string,
  kind: SetupImportCandidate["kind"]
): Promise<void> {
  const absolutePath = join(rootPath, path);
  if (!(await pathExists(absolutePath))) return;
  const stats = await stat(absolutePath);
  if (!stats.isDirectory()) return;
  if (await isManagedCandidate(absolutePath)) return;
  const entries = await readdir(absolutePath);
  if (entries.filter((entry) => entry !== ".DS_Store").length === 0) return;
  candidates.push({ kind, path: relative(rootPath, absolutePath).replaceAll("\\", "/") });
}

async function isManagedCandidate(path: string): Promise<boolean> {
  return (await pathExists(join(path, ".skillset.lock"))) || (await pathExists(join(dirname(path), ".skillset.lock")));
}

function compareCandidate(left: SetupImportCandidate, right: SetupImportCandidate): number {
  return `${left.kind}:${left.path}` < `${right.kind}:${right.path}` ? -1 :
    `${left.kind}:${left.path}` > `${right.kind}:${right.path}` ? 1 : 0;
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

  const include = options.include ?? [];
  if (include.includes("agents")) {
    files.push({
      path: `${SETUP_SOURCE_DIR}/agents/.gitkeep`,
      content: "",
    });
  }
  if (include.includes("ci")) {
    files.push({ path: CI_WORKFLOW_PATH, content: renderCiWorkflow() });
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
