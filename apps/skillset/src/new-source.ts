import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { detectWorkspaceSourceDir } from "@skillset/core/internal/resolver";
import { resolveInside, validateSlug } from "@skillset/core/internal/path";
import type { SkillsetOptions } from "@skillset/core/internal/types";

export type NewSourceKind = "agent" | "hook" | "skill";
export type NewSourceScope = "repo";

export interface NewSourceOptions {
  readonly container?: string;
  readonly displayName?: string;
  readonly id?: string;
  readonly kind: NewSourceKind;
  readonly name?: string;
  readonly presets?: readonly string[];
  readonly scope?: NewSourceScope;
  readonly skillsetOptions?: SkillsetOptions;
  readonly write?: boolean;
}

export interface NewSourceFile {
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

type SkillPreset =
  | "assets"
  | "evals"
  | "examples-file"
  | "minimal"
  | "reference-file"
  | "references"
  | "scripts"
  | "support";

interface PlannedFile {
  readonly content: string;
  readonly path: string;
}

const SKILL_PRESETS = new Set<SkillPreset>([
  "assets",
  "evals",
  "examples-file",
  "minimal",
  "reference-file",
  "references",
  "scripts",
  "support",
]);

export async function scaffoldSourceUnit(
  rootPath: string,
  options: NewSourceOptions
): Promise<NewSourceReport> {
  if (options.scope !== undefined && options.scope !== "repo") {
    throw new Error("skillset: new currently supports only --scope repo");
  }
  if (options.kind === "hook") {
    throw new Error(
      "skillset: new hook is not available yet; current hook source is hooks/hooks.json"
    );
  }

  const id = resolveSourceId(options);
  const displayName = resolveDisplayName(options, id);
  const sourceDir = await detectWorkspaceSourceDir(rootPath, options.skillsetOptions ?? {});
  await assertWorkspaceInitialized(rootPath, sourceDir);
  const sourceRoot = sourceDir;
  const plans = options.kind === "skill"
    ? await planSkill(rootPath, sourceRoot, id, displayName, options)
    : planAgent(sourceRoot, id, displayName, options);

  for (const plan of plans) {
    if (await fileExists(resolveInside(rootPath, plan.path))) {
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
    files: plans.map((plan) => ({ path: plan.path })),
    id,
    kind: options.kind,
    rootPath,
    sourceRoot,
    write: options.write === true,
  };
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
): Promise<readonly PlannedFile[]> {
  const container = options.container === undefined
    ? undefined
    : validateSlug(options.container, "new --in container");
  if (container !== undefined) await assertPluginContainer(rootPath, sourceRoot, container);
  const skillRoot = container === undefined
    ? join(sourceRoot, "skills", id)
    : join(sourceRoot, "plugins", container, "skills", id);
  const presets = readSkillPresets(options.presets);
  const files: PlannedFile[] = [
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
      files.push({ content: "{\n  \"evals\": []\n}\n", path: join(skillRoot, "evals", "evals.json") });
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

function planAgent(
  sourceRoot: string,
  id: string,
  displayName: string,
  options: NewSourceOptions
): readonly PlannedFile[] {
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
  container: string
): Promise<void> {
  const pluginPath = join(sourceRoot, "plugins", container);
  try {
    const stats = await stat(resolveInside(rootPath, pluginPath));
    if (stats.isDirectory() && await hasPluginManifest(rootPath, pluginPath)) return;
  } catch {
    // Surface the normalized source-relative path below.
  }
  throw new Error(`skillset: new --in container does not exist or has no skillset.yaml: ${pluginPath}`);
}

async function assertWorkspaceInitialized(rootPath: string, sourceDir: string): Promise<void> {
  if (await fileExists(resolveInside(rootPath, "skillset.yaml"))) return;
  throw new Error(
    "skillset: new requires an initialized Skillset workspace; run skillset init --yes or skillset create"
  );
}

function readSkillPresets(values: readonly string[] | undefined): readonly SkillPreset[] {
  const raw = values === undefined || values.length === 0
    ? ["minimal"]
    : values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const presets: SkillPreset[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (!SKILL_PRESETS.has(value as SkillPreset)) {
      throw new Error(
        "skillset: expected --preset minimal, support, references, assets, scripts, evals, reference-file, or examples-file"
      );
    }
    if (seen.has(value)) continue;
    seen.add(value);
    presets.push(value as SkillPreset);
  }
  return presets;
}

function uniquePlans(plans: readonly PlannedFile[]): readonly PlannedFile[] {
  const seen = new Set<string>();
  const unique: PlannedFile[] = [];
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

async function hasPluginManifest(rootPath: string, pluginPath: string): Promise<boolean> {
  return (await fileExists(resolveInside(rootPath, join(pluginPath, "skillset.yaml")))) ||
    (await fileExists(resolveInside(rootPath, join(pluginPath, "config.yaml"))));
}
