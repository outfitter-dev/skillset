import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { defineRenderResult, type SkillsetRenderResult } from "@skillset/core";
import { schemaUri } from "@skillset/schema";

import { seedReleaseBaselines, type ReleaseBaselineEntry } from "./adoption";
import { CI_WORKFLOW_PATH, renderCiWorkflow } from "./ci";
import { validateConfigDocument, validateWorkspaceConfigDocument } from "./config";
import { gitSafeEnv } from "./git-env";
import { validateSlug } from "./path";
import { selectorForTargetNativeIsland } from "./source-unit-selector";
import type { TargetName } from "./types";
import { workspaceChangesDir } from "./workspace-state";
import { parseYamlRecord } from "./yaml";

const DEFAULT_CREATE_NAME = "my-skillset";
const DEFAULT_GLOBAL_SOURCE = ".skillset/source";
const ORDINARY_WORKSPACE_DIR = ".skillset";
const WORKSPACE_SOURCE_ROOT = ".skillset";
const SETUP_SOURCE_PLACEHOLDERS = [
  "agents",
  "hooks",
  "plugins",
  "rules",
  "shared",
  "skills",
  "_claude",
  "_codex",
] as const;
const OPERATIONAL_GITIGNORE = "cache/*\n!cache/.gitignore\nsnapshots/*\n!snapshots/.gitignore\n";
const OPERATIONAL_DIR_GITIGNORE = "*\n!.gitignore\n";
const ROOT_OPERATIONAL_GITIGNORE =
  ".skillset/cache/*\n!.skillset/cache/.gitignore\n.skillset/snapshots/*\n!.skillset/snapshots/.gitignore\n";

type SetupLayout = "workspace";

export type SetupLayoutOption = "nested" | "root";

export type SetupInclude = "ci";

export interface SetupOptions {
  readonly cwd?: string;
  readonly global?: boolean;
  readonly homeDir?: string;
  readonly include?: readonly SetupInclude[];
  readonly layout?: SetupLayoutOption;
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

export interface SetupGit {
  readonly path: ".git";
  readonly status: "create" | "exists";
}

export interface SetupReport {
  readonly baselines: readonly ReleaseBaselineEntry[];
  readonly files: readonly SetupFile[];
  readonly git?: SetupGit;
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
  readonly renderResult?: SkillsetRenderResult;
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
  if (options.global === true && options.include !== undefined && options.include.length > 0) {
    throw new Error("skillset: create --global does not support --include");
  }
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
  const layout = await resolveSetupLayout(kind, rootPath, options);
  const workspaceManifestPath = await setupWorkspaceManifestPath(kind, rootPath, layout);
  // Captured before any writes: this run's own config scaffold must not make
  // the repo look pre-adopted to the survey.
  const alreadyAdopted = await setupWorkspaceExists(rootPath, layout);
  const targets = normalizeTargets(options.targets);
  const plannedFiles = setupFiles({ ...options, kind, resolvedLayout: layout, name, targets, workspaceManifestPath });
  const git = await setupGit(kind, rootPath, options);
  const files: SetupFile[] = [];

  for (const file of plannedFiles) {
    const absolutePath = join(rootPath, file.path);
    const existing = await readExistingFile(absolutePath);
    if (existing !== undefined && existing !== file.content) {
      if (kind === "init" && file.path === workspaceManifestPath) {
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
    if (git?.status === "create") await initializeGit(rootPath);
  }

  const baselines = kind === "init"
    ? (await seedReleaseBaselines(rootPath, {}, { write: options.write === true })).entries
    : [];
  const importCandidates = kind === "init" ? await detectImportCandidates(rootPath, alreadyAdopted) : [];
  const surveySkips = kind === "init" ? await detectSurveySkips(rootPath) : [];

  return {
    baselines,
    files,
    ...(git === undefined ? {} : { git }),
    importCandidates,
    kind,
    rootPath,
    sourceDir: ORDINARY_WORKSPACE_DIR,
    surveySkips,
    write: options.write === true,
  };
}

async function resolveSetupLayout(
  kind: SetupReport["kind"],
  rootPath: string,
  options: SetupOptions
): Promise<SetupLayout> {
  if (options.layout !== undefined) {
    throw new Error("skillset: --layout is retired; Skillset uses root skillset.yaml plus .skillset/");
  }
  if (kind === "init") await rejectRetiredSetupMarkers(rootPath);
  return "workspace";
}

async function setupWorkspaceExists(rootPath: string, layout: SetupLayout): Promise<boolean> {
  return pathExists(join(rootPath, "skillset.yaml"));
}

async function setupWorkspaceManifestPath(
  kind: SetupReport["kind"],
  rootPath: string,
  layout: SetupLayout
): Promise<string> {
  return "skillset.yaml";
}

async function rejectRetiredSetupMarkers(rootPath: string): Promise<void> {
  const retired = [
    ".skillset/skillset.yaml",
    ".skillset/config.yaml",
    ".skillset/src",
    "skillset",
  ];
  for (const path of retired) {
    if (await pathExists(join(rootPath, path))) {
      throw new Error(`skillset: ${path} uses a retired source layout; migrate to root skillset.yaml plus .skillset/`);
    }
  }
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
  const parsed = parseYamlRecord(content, path);
  if (path.endsWith("/config.yaml")) validateWorkspaceConfigDocument(parsed, path);
  else validateConfigDocument(parsed, path, { allowCompile: true });
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
  // skillset.yaml means the repo already authors instructions in
  // .skillset/rules, so its root files are (or will be) generated.
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
 * Recognized-but-unimportable surfaces. Import cannot represent them yet;
 * `skillset adopt` will handle them in the transform milestone. Until then the
 * survey reports them with a reason instead of staying silent.
 */
async function detectSurveySkips(rootPath: string): Promise<readonly SurveySkip[]> {
  const skips: SurveySkip[] = [];
  await maybeSkip(
    skips,
    rootPath,
    ".claude/commands",
    "commands",
    "project-level commands have no portable source home yet; adopt will represent them as provider source in the transform milestone",
    surveySkipOutcome({
      featureId: "target-native-islands",
      path: ".claude/commands",
      reason: "project-level commands have no portable source home yet; adopt will represent them as provider source in the transform milestone",
      relativeTargetPath: "commands",
      target: "claude",
    })
  );
  await maybeSkip(
    skips,
    rootPath,
    ".claude/agents",
    "agents",
    "project-level agents are not importable yet; adopt will represent them in the active workspace source root in the transform milestone",
    surveySkipOutcome({
      featureId: "project-agents",
      path: ".claude/agents",
      reason: "project-level agents are not importable yet; adopt will represent them in the active workspace source root in the transform milestone",
      relativeTargetPath: "agents",
      target: "claude",
    })
  );
  await maybeSkip(
    skips,
    rootPath,
    ".claude/rules",
    "rules",
    "rules are not importable yet; adopt will represent them in the active workspace source root in the transform milestone",
    surveySkipOutcome({
      featureId: "project-instructions",
      path: ".claude/rules",
      reason: "rules are not importable yet; adopt will represent them in the active workspace source root in the transform milestone",
      relativeTargetPath: "rules",
      target: "claude",
    })
  );
  if (await hasNonSkillCodexContent(rootPath)) {
    const reason =
      "Codex content outside .codex/skills has no portable source representation yet; adopt will represent it as provider source in the transform milestone";
    skips.push({
      renderResult: surveySkipOutcome({
        featureId: "target-native-islands",
        path: ".codex",
        reason,
        relativeTargetPath: ".codex",
        target: "codex",
      }),
      path: ".codex",
      reason,
      surface: "codex",
    });
  }
  for (const path of await foreignPluginManifests(rootPath)) {
    const reason = "plugin manifest for an unsupported target; skillset can only represent claude and codex surfaces";
    skips.push({
      renderResult: foreignManifestSkipOutcome(path, reason),
      path,
      reason,
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
  reason: string,
  renderResult?: SkillsetRenderResult
): Promise<void> {
  const absolutePath = join(rootPath, path);
  if (!(await pathExists(absolutePath))) return;
  if (!(await stat(absolutePath)).isDirectory()) return;
  if (await isManagedCandidate(absolutePath)) return;
  const entries = await readdir(absolutePath);
  if (entries.filter((entry) => entry !== ".DS_Store").length === 0) return;
  skips.push({ ...(renderResult === undefined ? {} : { renderResult }), path, reason, surface });
}

function surveySkipOutcome(args: {
  readonly featureId: string;
  readonly path: string;
  readonly reason: string;
  readonly relativeTargetPath: string;
  readonly target: TargetName;
}): SkillsetRenderResult {
  return defineRenderResult({
    destination: "target-native-island",
    diagnostics: [
      {
        code: "adoption-survey-skip",
        message: args.reason,
        path: args.path,
      },
    ],
    featureId: args.featureId,
    policy: "default",
    reason: args.reason,
    sourcePath: args.path,
    sourceUnit: selectorForTargetNativeIsland(args.target, "project", args.relativeTargetPath),
    status: "intentionally_skipped",
    target: args.target,
  });
}

function foreignManifestSkipOutcome(path: string, reason: string): SkillsetRenderResult {
  return defineRenderResult({
    diagnostics: [{ code: "adoption-survey-skip", message: reason, path }],
    featureId: "runtime-adapters",
    policy: "default",
    reason,
    sourcePath: path,
    sourceUnit: `runtime-adapter:${foreignManifestRuntime(path)}`,
    status: "intentionally_skipped",
  });
}

function foreignManifestRuntime(path: string): string {
  return path.match(/^\.([a-z][a-z0-9]*)-plugin$/)?.[1] ?? path;
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
  return (await pathExists(join(path, "skillset.lock"))) || (await pathExists(join(dirname(path), "skillset.lock")));
}

function compareCandidate(left: SetupImportCandidate, right: SetupImportCandidate): number {
  return `${left.kind}:${left.path}` < `${right.kind}:${right.path}` ? -1 :
    `${left.kind}:${left.path}` > `${right.kind}:${right.path}` ? 1 : 0;
}

function setupFiles(
  options: Required<Pick<SetupOptions, "name" | "targets">> & SetupOptions & {
    readonly kind: SetupReport["kind"];
    readonly resolvedLayout: SetupLayout;
    readonly workspaceManifestPath: string;
  }
): readonly PlannedFile[] {
  const sourceRoot = WORKSPACE_SOURCE_ROOT;
  const changesRoot = workspaceChangesDir(".skillset");
  const files: PlannedFile[] = [
    {
      path: options.workspaceManifestPath,
      content: workspaceManifest(options.name, options.targets),
    },
    {
      path: `${sourceRoot}/.gitkeep`,
      content: "",
    },
    ...SETUP_SOURCE_PLACEHOLDERS.map((directory) => ({
      path: `${sourceRoot}/${directory}/.gitkeep`,
      content: "",
    })),
    {
      path: `${changesRoot}/.gitkeep`,
      content: "",
    },
  ];

  if (options.global !== true) {
    files.push(
      {
        path: ".skillset/.gitignore",
        content: OPERATIONAL_GITIGNORE,
      },
      {
        path: ".skillset/cache/.gitignore",
        content: OPERATIONAL_DIR_GITIGNORE,
      },
      {
        path: ".skillset/snapshots/.gitignore",
        content: OPERATIONAL_DIR_GITIGNORE,
      }
    );
  }

  if (options.kind === "create" && options.global !== true) {
    files.push(
      {
        path: ".gitignore",
        content: ROOT_OPERATIONAL_GITIGNORE,
      },
      {
        path: "skillset.lock",
        content: emptyWorkspaceLock(),
      }
    );
  }

  if (options.kind === "create" && options.global !== true) {
    files.unshift(
      {
        path: "README.md",
        content: createReadme(options.name, options.targets),
      },
      {
        path: "AGENTS.md",
        content: createAgentsGuide(options.name),
      },
    );
  }

  const include = options.include ?? [];
  if (include.includes("ci")) {
    files.push({ path: CI_WORKFLOW_PATH, content: renderCiWorkflow() });
  }

  return files;
}

async function setupGit(
  kind: SetupReport["kind"],
  rootPath: string,
  options: SetupOptions
): Promise<SetupGit | undefined> {
  if (kind !== "create" || options.global === true) return undefined;
  return {
    path: ".git",
    status: await pathExists(join(rootPath, ".git")) ? "exists" : "create",
  };
}

async function initializeGit(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });
  const proc = Bun.spawn({
    cmd: ["git", "init", "-q"],
    cwd: rootPath,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`skillset: failed to initialize Git repository at ${rootPath}\n${stdout}${stderr}`.trim());
  }
}

function rootConfig(targets: readonly TargetName[]): string {
  const targetLines = targets.map((target) => `    - ${target}`).join("\n");
  return [
    "compile:",
    "  targets:",
    targetLines,
    "",
  ].join("\n");
}

function workspaceManifest(name: string, targets: readonly TargetName[]): string {
  return [
    `# yaml-language-server: $schema=${schemaUri("workspace-config")}`,
    "skillset:",
    `  name: ${name}`,
    rootConfig(targets).trimEnd(),
    "",
  ].join("\n");
}

function emptyWorkspaceLock(): string {
  return [
    "{",
    "  \"items\": []",
    "}",
    "",
  ].join("\n");
}

function createReadme(name: string, targets: readonly TargetName[]): string {
  return [
    `# ${name}`,
    "",
    "This repository is a Skillset source repo. Edit authored source under `.skillset/`, then run Skillset commands to preview or write generated Claude and Codex outputs.",
    "",
    "## Quick Start",
    "",
    "```bash",
    "skillset build --dry-run",
    "skillset build --yes",
    "skillset check",
    "skillset verify",
    "skillset change status",
    "```",
    "",
    "## Layout",
    "",
    "- `skillset.yaml` names the source loadout and selects compile targets and destination settings.",
    "- `.skillset/` is the Skillset workspace for rules, agents, hooks, skills, plugins, shared files, provider source, and change state.",
    "- `.skillset/plugins/` holds plugin source when this repo authors marketplace plugins.",
    "- `.skillset/skills/` holds standalone skill source when this repo authors repo-local or user skill roots.",
    "- `.skillset/changes/` stores pending and applied Skillset change history.",
    "- `.skillset/cache/` keeps the logical cache boundary visible while cache payloads resolve to XDG; `.skillset/snapshots/` holds ignored Git-backed recovery snapshots. Their `.gitignore` sentinels remain tracked.",
    "",
    `Default compile targets: ${targets.join(", ")}.`,
    "",
  ].join("\n");
}

function createAgentsGuide(name: string): string {
  return [
    "# AGENTS.md",
    "",
    `This repo is the source of truth for the ${name} Skillset loadout.`,
    "",
    "## Working Rules",
    "",
    "- Treat `.skillset/` as editable Skillset source and source-adjacent state.",
    "- Treat `skillset.yaml` as workspace/build configuration and root source metadata.",
    "- Treat `.skillset/changes/` as Skillset-managed change and release state.",
    "- Treat generated target directories as outputs; do not hand-edit them as source truth.",
    "- Run `skillset build --dry-run` before writing generated outputs.",
    "- Run `skillset check` and `skillset verify` before committing source changes.",
    "- Add pending change entries with `skillset change add` when source units change and the repo uses Skillset release tracking.",
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
