import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  detectWorkspaceSourceDir,
  loadBuildGraph,
} from "@skillset/core/internal/resolver";
import {
  compareStrings,
  resolveInside,
  validateSlug,
} from "@skillset/core/internal/path";
import type { SkillsetOptions } from "@skillset/core/internal/types";
import type { TargetName } from "@skillset/core/internal/types";
import { formatList } from "@skillset/schema";

import { planNewAdaptiveHook } from "./new-hook";

export type NewSourceKind = "agent" | "hook" | "instruction" | "skill";
export type NewSourceScope = "repo";

export interface NewSourceKindDefinition {
  readonly description: string;
  readonly enabled: boolean;
  readonly id: NewSourceKind;
  readonly name: string;
  readonly reason?: string;
}

export const NEW_SOURCE_KINDS: readonly NewSourceKindDefinition[] = [
  {
    description: "Skill directory, SKILL.md, and optional supporting files",
    enabled: true,
    id: "skill",
    name: "Skill",
  },
  {
    description: "Markdown file with repository-level agent instructions",
    enabled: true,
    id: "agent",
    name: "Project agent",
  },
  {
    description: "Instruction file under the canonical rules source directory",
    enabled: true,
    id: "instruction",
    name: "Instruction",
  },
  {
    description: "Adaptive runtime hook",
    enabled: true,
    id: "hook",
    name: "Hook",
  },
];

export const NEW_SOURCE_KIND_LIST_TEXT = formatList(
  NEW_SOURCE_KINDS.map((kind) => kind.id)
);

export interface NewSourceOptions {
  readonly container?: string;
  readonly displayName?: string;
  readonly hookAttachment?: string;
  readonly hookCommand?: string;
  readonly hookEvents?: readonly string[];
  readonly hookProviders?: readonly TargetName[];
  readonly hookScript?: string;
  readonly id?: string;
  readonly kind: NewSourceKind;
  readonly name?: string;
  readonly presets?: readonly string[];
  readonly scope?: NewSourceScope;
  readonly skillsetOptions?: SkillsetOptions;
  readonly write?: boolean;
}

export interface NewSourceFile {
  readonly operation: "create" | "update";
  readonly path: string;
}

export interface NewSourceReport {
  readonly displayName: string;
  readonly files: readonly NewSourceFile[];
  readonly id: string;
  readonly kind: NewSourceKind;
  readonly rootPath: string;
  readonly sourceRoot: string;
  readonly write: boolean;
}

export type SkillPreset =
  | "assets"
  | "evals"
  | "examples-file"
  | "minimal"
  | "reference-file"
  | "references"
  | "scripts"
  | "support";

export interface SkillPresetDefinition {
  readonly description: string;
  readonly id: SkillPreset;
  readonly name: string;
}

export interface NewSourcePlannedFile {
  readonly content: string;
  readonly expectedContent?: string;
  readonly operation?: "create" | "update";
  readonly path: string;
}

export const SKILL_PRESETS: readonly SkillPresetDefinition[] = [
  { description: "Only SKILL.md", id: "minimal", name: "Minimal" },
  {
    description: "References, assets, and scripts directories",
    id: "support",
    name: "Support directories",
  },
  { description: "References directory", id: "references", name: "References" },
  { description: "Assets directory", id: "assets", name: "Assets" },
  { description: "Scripts directory", id: "scripts", name: "Scripts" },
  { description: "Evaluation fixture", id: "evals", name: "Evals" },
  {
    description: "Top-level REFERENCE.md",
    id: "reference-file",
    name: "Reference file",
  },
  {
    description: "Top-level EXAMPLES.md",
    id: "examples-file",
    name: "Examples file",
  },
];

const SKILL_PRESET_IDS = new Set(SKILL_PRESETS.map((preset) => preset.id));

export async function scaffoldSourceUnit(
  rootPath: string,
  options: NewSourceOptions
): Promise<NewSourceReport> {
  if (options.scope !== undefined && options.scope !== "repo") {
    throw new Error("skillset: new currently supports only --scope repo");
  }
  assertHookOptionsMatchKind(options);
  const id = resolveSourceId(options);
  const displayName = resolveDisplayName(options, id);
  const sourceDir = await detectWorkspaceSourceDir(rootPath, options.skillsetOptions ?? {});
  await assertWorkspaceInitialized(rootPath, sourceDir);
  const sourceRoot = sourceDir;
  const plans = await planSourceUnit(
    rootPath,
    sourceRoot,
    id,
    displayName,
    options
  );

  for (const plan of plans) {
    const absolutePath = resolveInside(rootPath, plan.path);
    if (plan.operation === "update") {
      const current = await readFile(absolutePath, "utf8");
      if (current !== plan.expectedContent) {
        throw new Error(`skillset: source file changed while planning ${plan.path}`);
      }
    } else if (await fileExists(absolutePath)) {
      throw new Error(`skillset: refusing to overwrite existing source file ${plan.path}`);
    }
  }

  if (options.write === true) {
    for (const plan of plans) {
      const absolutePath = resolveInside(rootPath, plan.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, plan.content);
    }
  }

  return {
    displayName,
    files: plans.map((plan) => ({
      operation: plan.operation ?? "create",
      path: plan.path,
    })),
    id,
    kind: options.kind,
    rootPath,
    sourceRoot,
    write: options.write === true,
  };
}

function assertHookOptionsMatchKind(options: NewSourceOptions): void {
  if (options.kind === "hook") return;
  const flags = [
    ["--attach", options.hookAttachment],
    ["--command", options.hookCommand],
    ["--event", options.hookEvents],
    ["--provider", options.hookProviders],
    ["--script", options.hookScript],
  ].flatMap(([flag, value]) => (value === undefined ? [] : [flag]));
  if (flags.length > 0) {
    throw new Error(
      `skillset: new ${options.kind} does not support hook options: ${flags.join(", ")}`
    );
  }
}

async function planSourceUnit(
  rootPath: string,
  sourceRoot: string,
  id: string,
  displayName: string,
  options: NewSourceOptions
): Promise<readonly NewSourcePlannedFile[]> {
  switch (options.kind) {
    case "agent":
      return planAgent(sourceRoot, id, displayName, options);
    case "instruction":
      return planInstruction(rootPath, sourceRoot, id, displayName, options);
    case "skill":
      return planSkill(rootPath, sourceRoot, id, displayName, options);
    case "hook":
      return planNewAdaptiveHook(rootPath, id, displayName, {
        attachment: options.hookAttachment,
        command: options.hookCommand,
        container: options.container,
        events: options.hookEvents,
        providers: options.hookProviders,
        presets: options.presets,
        script: options.hookScript,
        skillsetOptions: options.skillsetOptions ?? {},
      });
  }
}

export function isNewSourceKind(value: unknown): value is NewSourceKind {
  return NEW_SOURCE_KINDS.some((kind) => kind.id === value);
}

export async function listNewSourceContainers(
  rootPath: string,
  skillsetOptions: SkillsetOptions = {}
): Promise<readonly string[]> {
  const sourceRoot = await detectWorkspaceSourceDir(rootPath, skillsetOptions);
  await assertWorkspaceInitialized(rootPath, sourceRoot);
  const graph = await loadBuildGraph(rootPath, skillsetOptions);
  return graph.plugins.map((plugin) => plugin.id);
}

export async function discoverNewSourceContainers(
  rootPath: string,
  skillsetOptions: SkillsetOptions = {}
): Promise<readonly string[]> {
  const sourceRoot = await detectWorkspaceSourceDir(rootPath, skillsetOptions);
  await assertWorkspaceInitialized(rootPath, sourceRoot);
  const pluginsPath = resolveInside(rootPath, join(sourceRoot, "plugins"));
  let entries;
  try {
    entries = await readdir(pluginsPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const containers: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = validateSlug(entry.name, "plugin directory");
    if (
      await fileExists(
        resolveInside(rootPath, join(sourceRoot, "plugins", id, "skillset.yaml"))
      )
    ) {
      containers.push(id);
    }
  }
  return containers.sort(compareStrings);
}

function resolveSourceId(options: NewSourceOptions): string {
  if (options.id !== undefined) return validateSlug(options.id, `${options.kind} id`);
  const name = options.name ?? options.displayName;
  if (name === undefined || name.trim().length === 0) {
    throw new Error(`skillset: new ${options.kind} requires a name or --id`);
  }
  return validateSlug(kebabCase(name), `${options.kind} id`);
}

function resolveDisplayName(options: NewSourceOptions, id: string): string {
  if (options.displayName !== undefined && options.displayName.trim().length > 0) {
    return options.displayName.trim();
  }
  if (options.name !== undefined && options.name.trim().length > 0) return options.name.trim();
  return titleFromId(id);
}

async function planSkill(
  rootPath: string,
  sourceRoot: string,
  id: string,
  displayName: string,
  options: NewSourceOptions
): Promise<readonly NewSourcePlannedFile[]> {
  const container = options.container === undefined
    ? undefined
    : validateSlug(options.container, "new --in container");
  if (container !== undefined) {
    await assertPluginContainer(
      rootPath,
      sourceRoot,
      container,
      options.skillsetOptions ?? {}
    );
  }
  const skillRoot = container === undefined
    ? join(sourceRoot, "skills", id)
    : join(sourceRoot, "plugins", container, "skills", id);
  const presets = readSkillPresets(options.presets);
  const files: NewSourcePlannedFile[] = [
    {
      content: renderSkill(id, displayName),
      path: join(skillRoot, "SKILL.md"),
    },
  ];

  for (const preset of presets) {
    if (preset === "minimal") continue;
    if (preset === "support" || preset === "references") {
      files.push({ content: "", path: join(skillRoot, "references", ".gitkeep") });
    }
    if (preset === "support" || preset === "assets") {
      files.push({ content: "", path: join(skillRoot, "assets", ".gitkeep") });
    }
    if (preset === "support" || preset === "scripts") {
      files.push({ content: "", path: join(skillRoot, "scripts", ".gitkeep") });
    }
    if (preset === "evals") {
      files.push({ content: `{\n  "skill_name": "${id}",\n  "evals": []\n}\n`, path: join(skillRoot, "evals", "evals.json") });
    }
    if (preset === "reference-file") {
      files.push({ content: `# ${displayName} Reference\n\nAdd concise reference material here.\n`, path: join(skillRoot, "REFERENCE.md") });
    }
    if (preset === "examples-file") {
      files.push({ content: `# ${displayName} Examples\n\nAdd examples here.\n`, path: join(skillRoot, "EXAMPLES.md") });
    }
  }

  return uniquePlans(files);
}

async function planInstruction(
  rootPath: string,
  sourceRoot: string,
  id: string,
  displayName: string,
  options: NewSourceOptions
): Promise<readonly NewSourcePlannedFile[]> {
  if (options.presets !== undefined && options.presets.length > 0) {
    throw new Error("skillset: new instruction does not support --preset");
  }
  const container = options.container === undefined
    ? undefined
    : validateSlug(options.container, "new --in container");
  if (container !== undefined) {
    await assertPluginContainer(
      rootPath,
      sourceRoot,
      container,
      options.skillsetOptions ?? {}
    );
  }
  const rulesRoot = container === undefined
    ? join(sourceRoot, "rules")
    : join(sourceRoot, "plugins", container, "rules");
  return [
    {
      content: renderInstruction(displayName),
      path: join(rulesRoot, `${id}.md`),
    },
  ];
}

function planAgent(
  sourceRoot: string,
  id: string,
  displayName: string,
  options: NewSourceOptions
): readonly NewSourcePlannedFile[] {
  if (options.container !== undefined) {
    throw new Error("skillset: new agent does not support --in; project agents live at the repo source root");
  }
  if (options.presets !== undefined && options.presets.length > 0) {
    throw new Error("skillset: new agent does not support --preset");
  }
  return [
    {
      content: renderAgent(id, displayName),
      path: join(sourceRoot, "agents", `${id}.md`),
    },
  ];
}

async function assertPluginContainer(
  rootPath: string,
  sourceRoot: string,
  container: string,
  skillsetOptions: SkillsetOptions
): Promise<void> {
  const pluginPath = join(sourceRoot, "plugins", container);
  let hasCanonicalManifest = false;
  try {
    const stats = await stat(resolveInside(rootPath, pluginPath));
    hasCanonicalManifest =
      stats.isDirectory() &&
      (await fileExists(
        resolveInside(rootPath, join(pluginPath, "skillset.yaml"))
      ));
  } catch {
    // Surface the stable source-relative diagnostic below.
  }
  if (!hasCanonicalManifest) throw missingPluginContainer(pluginPath);
  const containers = await listNewSourceContainers(rootPath, skillsetOptions);
  if (containers.includes(container)) return;
  throw missingPluginContainer(pluginPath);
}

function missingPluginContainer(pluginPath: string): Error {
  return new Error(
    `skillset: new --in container does not exist or has no skillset.yaml: ${pluginPath}`
  );
}

async function assertWorkspaceInitialized(rootPath: string, sourceDir: string): Promise<void> {
  if (await fileExists(resolveInside(rootPath, "skillset.yaml"))) return;
  throw new Error(
    "skillset: new requires an initialized Skillset workspace; run skillset init --yes"
  );
}

export function parseSkillPresets(
  values: readonly string[]
): readonly SkillPreset[] {
  const raw = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const presets: SkillPreset[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (!SKILL_PRESET_IDS.has(value as SkillPreset)) {
      throw new Error(
        `skillset: expected --preset ${formatList(SKILL_PRESETS.map((preset) => preset.id))}`
      );
    }
    if (seen.has(value)) continue;
    seen.add(value);
    presets.push(value as SkillPreset);
  }
  return presets;
}

function readSkillPresets(
  values: readonly string[] | undefined
): readonly SkillPreset[] {
  const presets = values === undefined ? [] : parseSkillPresets(values);
  return presets.length === 0 ? ["minimal"] : presets;
}

function uniquePlans(plans: readonly NewSourcePlannedFile[]): readonly NewSourcePlannedFile[] {
  const seen = new Set<string>();
  const unique: NewSourcePlannedFile[] = [];
  for (const plan of plans) {
    if (seen.has(plan.path)) continue;
    seen.add(plan.path);
    unique.push(plan);
  }
  return unique;
}

function renderSkill(id: string, displayName: string): string {
  const description = `Use when working with ${displayName} workflows.`;
  return `---\nname: ${id}\ntitle: ${yamlString(displayName)}\ndescription: ${yamlString(description)}\n---\n\n# ${displayName}\n\nUse this skill when working with ${displayName} workflows.\n\n## Workflow\n\n- Add the domain-specific guidance here.\n`;
}

function renderAgent(id: string, displayName: string): string {
  const description = `Use this agent for ${displayName} work.`;
  return `---\nname: ${id}\ndescription: ${yamlString(description)}\n---\n\nUse this agent for ${displayName} work.\n`;
}

function renderInstruction(displayName: string): string {
  return `# ${displayName}\n\nAdd repository instructions here.\n`;
}

function kebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
