import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep } from "node:path";

import { validateTestDeclaration } from "@skillset/schema";

import {
  isTargetName,
  readCompileTargets,
  readString,
  resolveTargets,
} from "./config";
import { compareStrings, resolveInside } from "./path";
import { detectWorkspaceSourceDir, loadBuildGraph } from "./resolver";
import { targetNames } from "./targets";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  SkillsetOptions,
  TargetName,
} from "./types";
import { isJsonRecord, parseYamlRecord } from "./yaml";

export type SkillsetClaudeSettingSources =
  | "isolated"
  | "local"
  | "project"
  | "user";

export interface SkillsetTestCheckResult {
  readonly detail?: string;
  readonly kind:
    | "build"
    | "contains"
    | "exists"
    | "pluginManifests"
    | "projection";
  readonly ok: boolean;
  readonly path?: string;
}

export interface SkillsetTestSelectionReport extends JsonRecord {
  readonly agents: string[];
  readonly filterSource: boolean;
  readonly pluginSkills: string[];
  readonly plugins: string[];
  readonly primarySkills: string[];
}

export interface SkillsetTestDeclaration {
  readonly activationProbes: readonly SkillsetActivationProbe[];
  readonly checks: readonly SkillsetTestCheck[];
  readonly name: string;
  readonly selection: SkillsetTestSelection;
  readonly targets: readonly TargetName[];
}

export type SkillsetTestCheck =
  | { readonly kind: "build" }
  | { readonly kind: "exists"; readonly path: string }
  | { readonly kind: "contains"; readonly path: string; readonly text: string }
  | { readonly kind: "pluginManifests" }
  | { readonly kind: "projection" };

interface PluginSkillSelection {
  readonly pluginId: string;
  readonly skillId: string;
}

interface ProjectAgentSelection {
  readonly filename: string;
  readonly outputName: string;
}

export interface SkillsetTestSelection {
  readonly agents: readonly ProjectAgentSelection[];
  readonly filterSource: boolean;
  readonly pluginSkills: readonly PluginSkillSelection[];
  readonly plugins: readonly string[];
  readonly primarySkills: readonly string[];
}

export interface SkillsetActivationProbe {
  readonly expect: SkillsetActivationExpectation;
  readonly name: string;
  readonly prompt: string;
  readonly promptProvenance: string;
  readonly runtime?: SkillsetActivationRuntime;
  readonly targets: readonly TargetName[];
}

export interface SkillsetActivationRuntime {
  readonly claudeSettingSources?: SkillsetClaudeSettingSources;
  readonly contains?: string;
  readonly notContains?: string;
  readonly timeoutMs?: number;
}

export interface SkillsetActivationExpectation {
  readonly kind: "agent" | "plugin" | "skill";
  readonly name: string;
}
export async function loadSkillsetTestEvaluationContext(
  rootPath: string,
  options: SkillsetOptions
): Promise<{
  readonly declarations: readonly SkillsetTestDeclaration[];
  readonly graph: BuildGraph;
}> {
  const context = await loadSkillsetTestDeclarationContext(rootPath, options);
  return {
    declarations: await parseSkillsetTestDeclarations(context),
    graph: context.graph,
  };
}

async function rejectRetiredWorkspaceTestConfig(
  rootPath: string,
  options: SkillsetOptions
): Promise<void> {
  const sourceDir = await detectWorkspaceSourceDir(rootPath, options);
  const configPaths = ["skillset.yaml"];
  for (const configPath of configPaths) {
    const absolutePath = resolveInside(rootPath, configPath);
    if (!(await pathExists(absolutePath))) continue;
    const config = parseYamlRecord(
      await readFile(absolutePath, "utf8"),
      absolutePath
    );
    if (config.tests !== undefined) {
      throw new Error(
        `skillset: ${absolutePath}.tests is retired; place test declarations in ${testDeclarationRootForSourceDir(sourceDir)}/tests.yaml or ${testDeclarationRootForSourceDir(sourceDir)}/tests/*.yaml`
      );
    }
    return;
  }
}

function selectTestName(
  graph: BuildGraph,
  names: readonly string[],
  requestedName: string | undefined
): string {
  if (names.length === 0) {
    throw new Error(
      `skillset: ${testDeclarationRoot(graph)} must include tests.yaml or tests/*.yaml for skillset test`
    );
  }
  const name = requestedName ?? (names.length === 1 ? names[0] : undefined);
  if (name === undefined) {
    throw new Error(
      `skillset: multiple tests configured (${names.join(", ")}); pass a test name`
    );
  }
  if (!names.includes(name)) {
    throw new Error(
      `skillset: test ${name} is not configured; available tests: ${names.join(", ")}`
    );
  }
  return name;
}

export interface SkillsetTestDeclarationContext {
  readonly defaultTargets: readonly TargetName[];
  readonly graph: BuildGraph;
  readonly names: readonly string[];
  readonly tests: Readonly<Record<string, SkillsetTestDeclarationRecord>>;
}

async function loadSkillsetTestDeclarationContext(
  rootPath: string,
  options: SkillsetOptions
): Promise<SkillsetTestDeclarationContext> {
  await rejectRetiredWorkspaceTestConfig(rootPath, options);
  const graph = await loadBuildGraph(rootPath, options);
  const configPath = graph.rootConfigPath;
  const config = parseYamlRecord(
    await readFile(configPath, "utf8"),
    configPath
  );
  if (config.tests !== undefined) {
    throw new Error(
      `skillset: ${configPath}.tests is retired; place test declarations in ${testDeclarationRoot(graph)}/tests.yaml or ${testDeclarationRoot(graph)}/tests/*.yaml`
    );
  }
  const defaultTargets = readEffectiveTargets(config, configPath);
  const tests = await readSkillsetTestDeclarations(graph);
  const names = Object.keys(tests).sort(compareStrings);
  return { defaultTargets, graph, names, tests };
}

async function parseSkillsetTestDeclarations(
  context: SkillsetTestDeclarationContext
): Promise<readonly SkillsetTestDeclaration[]> {
  const declarations: SkillsetTestDeclaration[] = [];
  for (const name of context.names) {
    const declaration = context.tests[name];
    if (declaration === undefined) continue;
    declarations.push(
      await readTestObject(
        context.graph,
        declaration.record,
        declaration.label,
        name,
        context.defaultTargets
      )
    );
  }
  return declarations;
}

export interface SkillsetTestDeclarationRecord {
  readonly label: string;
  readonly record: JsonRecord;
}

async function readSkillsetTestDeclarations(
  graph: BuildGraph
): Promise<Record<string, SkillsetTestDeclarationRecord>> {
  const declarations: Record<string, SkillsetTestDeclarationRecord> = {};
  const aggregatePath = resolveInside(
    graph.rootPath,
    join(graph.sourceRoot, "tests.yaml")
  );
  if (await pathExists(aggregatePath)) {
    const aggregate = parseYamlRecord(
      await readFile(aggregatePath, "utf8"),
      aggregatePath
    );
    for (const name of Object.keys(aggregate).sort(compareStrings)) {
      const value = aggregate[name];
      if (!isJsonRecord(value))
        throw new Error(
          `skillset: expected ${relative(graph.rootPath, aggregatePath)}.${name} to be an object`
        );
      addSkillsetTestDeclaration(declarations, name, {
        label: `${relative(graph.rootPath, aggregatePath)}.${name}`,
        record: value,
      });
    }
  }

  const testsDir = resolveInside(
    graph.rootPath,
    join(graph.sourceRoot, "tests")
  );
  if (await pathExists(testsDir)) {
    const entries = (await readdir(testsDir, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          (extname(entry.name) === ".yaml" || extname(entry.name) === ".yml")
      )
      .map((entry) => entry.name)
      .sort(compareStrings);
    for (const entry of entries) {
      const testPath = join(testsDir, entry);
      const record = parseYamlRecord(
        await readFile(testPath, "utf8"),
        testPath
      );
      addSkillsetTestDeclaration(declarations, entry.replace(/\.ya?ml$/u, ""), {
        label: relative(graph.rootPath, testPath),
        record,
      });
    }
  }
  return declarations;
}

function addSkillsetTestDeclaration(
  declarations: Record<string, SkillsetTestDeclarationRecord>,
  name: string,
  declaration: SkillsetTestDeclarationRecord
): void {
  if (
    name === "list" ||
    name === "status" ||
    name === "tail" ||
    name === "worker"
  ) {
    throw new Error(
      `skillset: test name ${name} is reserved for the retained-run lifecycle`
    );
  }
  const existing = declarations[name];
  if (existing !== undefined) {
    throw new Error(
      `skillset: duplicate test ${name} in ${existing.label} and ${declaration.label}`
    );
  }
  declarations[name] = declaration;
}

function testDeclarationRoot(graph: BuildGraph): string {
  return relative(graph.rootPath, graph.sourceRootPath);
}

function testDeclarationRootForSourceDir(sourceDir: string): string {
  return sourceDir;
}

async function readTestObject(
  graph: BuildGraph,
  record: JsonRecord,
  label: string,
  name: string,
  defaultTargets: readonly TargetName[]
): Promise<SkillsetTestDeclaration> {
  if (usesDeclaredRuntimeContract(record)) {
    const diagnostic = validateTestDeclaration(record).diagnostics[0];
    if (diagnostic !== undefined)
      throw new Error(`skillset: ${label}: ${diagnostic.message}`);
  }
  for (const key of Object.keys(record)) {
    if (key === "assertions" || key === "assert") {
      throw new Error(
        `skillset: ${label}.${key} is retired; use ${label}.checks`
      );
    }
    if (key === "source") {
      throw new Error(
        `skillset: ${label}.source is retired; use ${label}.select`
      );
    }
    if (
      key !== "activation" &&
      key !== "checks" &&
      key !== "select" &&
      key !== "targets"
    ) {
      throw new Error(`skillset: unsupported test key ${key} in ${label}`);
    }
  }

  const targets = readTargets(
    record.targets,
    `${label}.targets`,
    defaultTargets
  );
  const selection = readSelection(graph, record.select, `${label}.select`);
  const checks = readChecks(record.checks, `${label}.checks`, selection);
  const activationProbes = await readSkillsetActivationProbes(
    graph,
    record.activation,
    `${label}.activation`,
    targets
  );
  validateSkillsetActivationProbeNames(activationProbes, targets);
  return { activationProbes, checks, name, selection, targets };
}

function usesDeclaredRuntimeContract(record: JsonRecord): boolean {
  if (!Array.isArray(record.activation)) return false;
  return record.activation.some(
    (probe) =>
      isJsonRecord(probe) &&
      (probe.runtime !== undefined || probe.promptFile !== undefined)
  );
}

function readTargets(
  value: JsonValue | undefined,
  label: string,
  defaultTargets: readonly TargetName[]
): readonly TargetName[] {
  if (value === undefined) return defaultTargets;
  if (!Array.isArray(value))
    throw new Error(`skillset: expected ${label} to be a string array`);
  if (value.length === 0)
    throw new Error(
      `skillset: expected ${label} to include at least one target`
    );
  const enabled = new Set(defaultTargets);
  const seen = new Set<TargetName>();
  for (const target of value) {
    if (!isTargetName(target)) {
      throw new Error(
        `skillset: unsupported target ${JSON.stringify(target)} in ${label}; expected ${targetNames().join(", ")}`
      );
    }
    if (seen.has(target))
      throw new Error(
        `skillset: duplicate target ${JSON.stringify(target)} in ${label}`
      );
    if (!enabled.has(target))
      throw new Error(
        `skillset: test target ${target} in ${label} is not enabled by root target configuration`
      );
    seen.add(target);
  }
  return [...seen];
}

function readEffectiveTargets(
  record: JsonRecord,
  label: string
): readonly TargetName[] {
  const targets = resolveTargets(
    readCompileTargets(record, label),
    record,
    label,
    {
      allowDefaults: true,
      objectInheritsEnabled: true,
    }
  );
  return targetNames().filter((target) => targets[target].enabled);
}

function readSelection(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string
): SkillsetTestSelection {
  if (value === undefined)
    return {
      agents: [],
      filterSource: false,
      pluginSkills: [],
      plugins: [],
      primarySkills: [],
    };
  if (!isJsonRecord(value))
    throw new Error(`skillset: expected ${label} to be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "agents" && key !== "plugins" && key !== "skills") {
      throw new Error(`skillset: unsupported selector key ${key} in ${label}`);
    }
  }

  const agents = readAgentSelection(graph, value.agents, `${label}.agents`);
  const pluginIds = new Set<string>();
  const primarySkillIds = new Set<string>();
  const pluginSkillKeys = new Set<string>();
  const pluginSkills: PluginSkillSelection[] = [];

  function addPluginSkill(pluginId: string, skillId: string): void {
    const key = `${pluginId}\0${skillId}`;
    if (pluginSkillKeys.has(key)) return;
    pluginSkillKeys.add(key);
    pluginSkills.push({ pluginId, skillId });
  }

  readPluginSelection(
    graph,
    value.plugins,
    `${label}.plugins`,
    pluginIds,
    addPluginSkill
  );
  readSkillSelection(
    graph,
    value.skills,
    `${label}.skills`,
    primarySkillIds,
    addPluginSkill
  );

  const selection = {
    agents,
    filterSource: true,
    pluginSkills: pluginSkills.sort((left, right) =>
      compareStrings(
        `${left.pluginId}/${left.skillId}`,
        `${right.pluginId}/${right.skillId}`
      )
    ),
    plugins: [...pluginIds].sort(compareStrings),
    primarySkills: [...primarySkillIds].sort(compareStrings),
  };
  if (
    selection.agents.length === 0 &&
    selection.plugins.length === 0 &&
    selection.primarySkills.length === 0 &&
    selection.pluginSkills.length === 0
  ) {
    throw new Error(`skillset: ${label} must select at least one source unit`);
  }
  return selection;
}

function readAgentSelection(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string
): readonly ProjectAgentSelection[] {
  if (value === undefined) return [];
  if (value === true) {
    return graph.projectAgents
      .map((agent) => ({
        filename: agent.filename,
        outputName: agent.outputName,
      }))
      .sort((left, right) => compareStrings(left.outputName, right.outputName));
  }
  const outputNames = graph.projectAgents.map((agent) => agent.outputName);
  return readSelectorNames(outputNames, value, label, "project agent").map(
    (outputName) => {
      const agent = graph.projectAgents.find(
        (candidate) => candidate.outputName === outputName
      );
      if (agent === undefined)
        throw new Error(
          `skillset: unknown project agent ${JSON.stringify(outputName)} in ${label}`
        );
      return { filename: agent.filename, outputName: agent.outputName };
    }
  );
}

function readPluginSelection(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string,
  pluginIds: Set<string>,
  addPluginSkill: (pluginId: string, skillId: string) => void
): void {
  if (value === undefined) return;
  if (value === true) {
    for (const plugin of graph.plugins) pluginIds.add(plugin.id);
    return;
  }
  if (Array.isArray(value)) {
    for (const id of readStringArray(value, label)) {
      assertPlugin(graph, id, label);
      pluginIds.add(id);
    }
    return;
  }
  if (!isJsonRecord(value))
    throw new Error(
      `skillset: expected ${label} to be true, a string array, or an object`
    );
  if (Object.keys(value).length === 0)
    throw new Error(
      `skillset: ${label} must include include or skills; use true to select all plugins`
    );
  for (const key of Object.keys(value)) {
    if (key !== "include" && key !== "skills")
      throw new Error(`skillset: unsupported selector key ${key} in ${label}`);
  }
  const included =
    value.include === undefined
      ? graph.plugins.map((plugin) => plugin.id)
      : readSelectorNames(
          graph.plugins.map((plugin) => plugin.id),
          value.include,
          `${label}.include`,
          "plugin"
        );
  if (value.skills === undefined) {
    for (const id of included) pluginIds.add(id);
  }
  readPluginSkillSelectionForPlugins(
    graph,
    included,
    value.skills,
    `${label}.skills`,
    addPluginSkill
  );
}

function readSkillSelection(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string,
  primarySkillIds: Set<string>,
  addPluginSkill: (pluginId: string, skillId: string) => void
): void {
  if (value === undefined) return;
  if (value === true) {
    for (const skill of graph.standaloneSkills) primarySkillIds.add(skill.id);
    for (const plugin of graph.plugins)
      for (const skill of plugin.skills) addPluginSkill(plugin.id, skill.id);
    return;
  }
  if (Array.isArray(value)) {
    for (const id of readStringArray(value, label)) {
      assertPrimarySkill(graph, id, label);
      primarySkillIds.add(id);
    }
    return;
  }
  if (!isJsonRecord(value))
    throw new Error(
      `skillset: expected ${label} to be true, a string array, or an object`
    );
  if (Object.keys(value).length === 0)
    throw new Error(
      `skillset: ${label} must include primary or plugin; use true to select all skills`
    );
  for (const key of Object.keys(value)) {
    if (key !== "primary" && key !== "plugin")
      throw new Error(`skillset: unsupported selector key ${key} in ${label}`);
  }
  const primary = value.primary;
  if (primary === true) {
    for (const skill of graph.standaloneSkills) primarySkillIds.add(skill.id);
  } else if (primary !== undefined) {
    for (const id of readSelectorNames(
      graph.standaloneSkills.map((skill) => skill.id),
      primary,
      `${label}.primary`,
      "primary skill"
    )) {
      primarySkillIds.add(id);
    }
  }
  readPluginSkillSelection(
    graph,
    value.plugin,
    `${label}.plugin`,
    addPluginSkill
  );
}

function readPluginSkillSelection(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string,
  addPluginSkill: (pluginId: string, skillId: string) => void
): void {
  if (value === undefined) return;
  if (value === true) {
    for (const plugin of graph.plugins)
      for (const skill of plugin.skills) addPluginSkill(plugin.id, skill.id);
    return;
  }
  if (Array.isArray(value)) {
    for (const id of readStringArray(value, label)) {
      const matches = graph.plugins.flatMap((plugin) =>
        plugin.skills.some((skill) => skill.id === id) ? [plugin.id] : []
      );
      if (matches.length === 0)
        throw new Error(
          `skillset: unknown plugin skill ${JSON.stringify(id)} in ${label}`
        );
      if (matches.length > 1) {
        throw new Error(
          `skillset: plugin skill ${JSON.stringify(id)} in ${label} is ambiguous across plugins ${matches.sort(compareStrings).join(", ")}; use ${label}.<plugin>`
        );
      }
      addPluginSkill(matches[0]!, id);
    }
    return;
  }
  if (!isJsonRecord(value))
    throw new Error(
      `skillset: expected ${label} to be true, a string array, or an object`
    );
  if (Object.keys(value).length === 0)
    throw new Error(
      `skillset: ${label} must include at least one plugin; use true to select all plugin skills`
    );
  for (const [pluginId, raw] of Object.entries(value).sort(([left], [right]) =>
    compareStrings(left, right)
  )) {
    assertPlugin(graph, pluginId, label);
    readPluginSkillSelectionForPlugins(
      graph,
      [pluginId],
      raw,
      `${label}.${pluginId}`,
      addPluginSkill
    );
  }
}

function readPluginSkillSelectionForPlugins(
  graph: BuildGraph,
  pluginIds: readonly string[],
  value: JsonValue | undefined,
  label: string,
  addPluginSkill: (pluginId: string, skillId: string) => void
): void {
  if (value === undefined) return;
  if (value === true) {
    for (const pluginId of pluginIds) {
      const plugin = graph.plugins.find(
        (candidate) => candidate.id === pluginId
      );
      if (plugin === undefined) continue;
      for (const skill of plugin.skills) addPluginSkill(plugin.id, skill.id);
    }
    return;
  }
  if (Array.isArray(value)) {
    const ids = readStringArray(value, label);
    for (const pluginId of pluginIds) {
      const plugin = graph.plugins.find(
        (candidate) => candidate.id === pluginId
      );
      if (plugin === undefined) continue;
      for (const id of ids) {
        if (!plugin.skills.some((skill) => skill.id === id)) {
          throw new Error(
            `skillset: unknown plugin skill ${JSON.stringify(id)} for plugin ${pluginId} in ${label}`
          );
        }
        addPluginSkill(pluginId, id);
      }
    }
    return;
  }
  throw new Error(`skillset: expected ${label} to be true or a string array`);
}

function readSelectorNames(
  known: readonly string[],
  value: JsonValue,
  label: string,
  kind: string
): readonly string[] {
  if (value === true) return [...known].sort(compareStrings);
  if (!Array.isArray(value))
    throw new Error(`skillset: expected ${label} to be true or a string array`);
  const names = readStringArray(value, label);
  for (const name of names) {
    if (!known.includes(name))
      throw new Error(
        `skillset: unknown ${kind} ${JSON.stringify(name)} in ${label}`
      );
  }
  return names;
}

function assertPlugin(graph: BuildGraph, id: string, label: string): void {
  if (graph.plugins.some((plugin) => plugin.id === id)) return;
  throw new Error(`skillset: unknown plugin ${JSON.stringify(id)} in ${label}`);
}

function assertPrimarySkill(
  graph: BuildGraph,
  id: string,
  label: string
): void {
  if (graph.standaloneSkills.some((skill) => skill.id === id)) return;
  throw new Error(
    `skillset: unknown primary skill ${JSON.stringify(id)} in ${label}`
  );
}

function readStringArray(
  value: readonly JsonValue[],
  label: string
): readonly string[] {
  if (value.length === 0)
    throw new Error(`skillset: expected ${label} to include at least one item`);
  const seen = new Set<string>();
  const items: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(
        `skillset: expected ${label}[${index}] to be a non-empty string`
      );
    }
    if (seen.has(item))
      throw new Error(
        `skillset: duplicate selector ${JSON.stringify(item)} in ${label}`
      );
    seen.add(item);
    items.push(item);
  }
  return items;
}

function readChecks(
  value: JsonValue | undefined,
  label: string,
  selection: SkillsetTestSelection
): readonly SkillsetTestCheck[] {
  if (value === undefined) throw new Error(`skillset: ${label} is required`);
  const checks: SkillsetTestCheck[] = [];
  if (!isJsonRecord(value))
    throw new Error(`skillset: expected ${label} to be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "files" && key !== "pluginManifests" && key !== "projection") {
      throw new Error(`skillset: unsupported check key ${key} in ${label}`);
    }
  }
  if (readBooleanCheck(value.projection, `${label}.projection`))
    checks.push({ kind: "projection" });
  if (readBooleanCheck(value.pluginManifests, `${label}.pluginManifests`)) {
    if (selection.plugins.length === 0)
      throw new Error(
        `skillset: ${label}.pluginManifests requires select.plugins`
      );
    checks.push({ kind: "pluginManifests" });
  }
  const files = value.files;
  if (files !== undefined) {
    if (!Array.isArray(files) || files.length === 0)
      throw new Error(
        `skillset: expected ${label}.files to be a non-empty array`
      );
    for (const [index, item] of files.entries())
      checks.push(readFileCheck(item, `${label}.files[${index}]`));
  }
  if (checks.length === 0)
    throw new Error(
      `skillset: expected ${label} to include at least one check`
    );
  return checks;
}

function readBooleanCheck(
  value: JsonValue | undefined,
  label: string
): boolean {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new Error(`skillset: expected ${label} to be true or false`);
}

function readFileCheck(value: JsonValue, label: string): SkillsetTestCheck {
  if (!isJsonRecord(value))
    throw new Error(`skillset: expected ${label} to be a file check object`);
  for (const key of Object.keys(value)) {
    if (key !== "contains" && key !== "path")
      throw new Error(
        `skillset: unsupported file check key ${key} in ${label}`
      );
  }
  const path = readString(value, "path");
  if (path === undefined)
    throw new Error(`skillset: ${label}.path is required`);
  const contains = readString(value, "contains");
  if (contains !== undefined) return { kind: "contains", path, text: contains };
  return { kind: "exists", path };
}

async function readSkillsetActivationProbes(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string,
  defaultTargets: readonly TargetName[]
): Promise<readonly SkillsetActivationProbe[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error(`skillset: expected ${label} to be an array`);
  return Promise.all(
    value.map((item, index) =>
      readSkillsetActivationProbe(
        graph,
        item,
        `${label}[${index}]`,
        defaultTargets
      )
    )
  );
}

async function readSkillsetActivationProbe(
  graph: BuildGraph,
  value: JsonValue,
  label: string,
  defaultTargets: readonly TargetName[]
): Promise<SkillsetActivationProbe> {
  if (!isJsonRecord(value))
    throw new Error(`skillset: expected ${label} to be an object`);
  for (const key of Object.keys(value)) {
    if (
      key !== "expect" &&
      key !== "name" &&
      key !== "prompt" &&
      key !== "promptFile" &&
      key !== "runtime" &&
      key !== "targets"
    ) {
      throw new Error(
        `skillset: unsupported activation key ${key} in ${label}`
      );
    }
  }
  const inlinePrompt = readString(value, "prompt");
  const promptFile = readString(value, "promptFile");
  if (value.prompt !== undefined && inlinePrompt === undefined)
    throw new Error(`skillset: ${label}.prompt is required`);
  if (value.promptFile !== undefined && promptFile === undefined)
    throw new Error(`skillset: ${label}.promptFile is required`);
  if ((inlinePrompt === undefined) === (promptFile === undefined)) {
    throw new Error(
      `skillset: ${label} must name exactly one of prompt or promptFile`
    );
  }
  const promptPath =
    promptFile === undefined
      ? undefined
      : resolveInside(graph.sourceRootPath, promptFile);
  const prompt =
    inlinePrompt ??
    (await readSourcePromptFile(
      graph.sourceRootPath,
      promptPath as string,
      label
    ));
  const expect = readSkillsetActivationExpectation(
    value.expect,
    `${label}.expect`
  );
  const targets = readTargets(
    value.targets,
    `${label}.targets`,
    defaultTargets
  );
  const configuredName = readString(value, "name");
  const runtime = readSkillsetActivationRuntime(
    value.runtime,
    `${label}.runtime`
  );
  return {
    expect,
    name: configuredName ?? activationProbeName(expect),
    prompt,
    promptProvenance:
      promptFile === undefined
        ? "inline"
        : join(graph.sourceRoot, promptFile).replaceAll("\\", "/"),
    ...(runtime === undefined ? {} : { runtime }),
    targets,
  };
}

async function readSourcePromptFile(
  sourceRootPath: string,
  promptPath: string,
  label: string
): Promise<string> {
  const [sourceRootRealPath, promptRealPath] = await Promise.all([
    realpath(sourceRootPath),
    realpath(promptPath),
  ]);
  const relativePromptPath = relative(sourceRootRealPath, promptRealPath);
  if (
    relativePromptPath === "" ||
    relativePromptPath.startsWith(`..${sep}`) ||
    relativePromptPath === ".." ||
    isAbsolute(relativePromptPath)
  ) {
    throw new Error(
      `skillset: ${label}.promptFile resolves outside the source root`
    );
  }
  return readFile(promptRealPath, "utf8");
}

function readSkillsetActivationRuntime(
  value: JsonValue | undefined,
  label: string
): SkillsetActivationRuntime | undefined {
  if (value === undefined) return undefined;
  if (!isJsonRecord(value))
    throw new Error(`skillset: expected ${label} to be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "claude" && key !== "expect" && key !== "timeoutMs") {
      throw new Error(`skillset: unsupported runtime key ${key} in ${label}`);
    }
  }
  if (!isJsonRecord(value.expect))
    throw new Error(`skillset: ${label}.expect is required`);
  for (const key of Object.keys(value.expect)) {
    if (key !== "contains" && key !== "notContains") {
      throw new Error(
        `skillset: unsupported runtime expectation ${key} in ${label}.expect`
      );
    }
  }
  const contains = readString(value.expect, "contains");
  const notContains = readString(value.expect, "notContains");
  if (contains === undefined && notContains === undefined) {
    throw new Error(
      `skillset: ${label}.expect must include contains or notContains`
    );
  }
  const timeoutMs = readOptionalPositiveInteger(
    value.timeoutMs,
    `${label}.timeoutMs`
  );
  const claudeSettingSources = readRuntimeClaudeSettings(
    value.claude,
    `${label}.claude`
  );
  return {
    ...(claudeSettingSources === undefined ? {} : { claudeSettingSources }),
    ...(contains === undefined ? {} : { contains }),
    ...(notContains === undefined ? {} : { notContains }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function readRuntimeClaudeSettings(
  value: JsonValue | undefined,
  label: string
): SkillsetClaudeSettingSources | undefined {
  if (value === undefined) return undefined;
  if (!isJsonRecord(value))
    throw new Error(`skillset: expected ${label} to be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "settingSources")
      throw new Error(
        `skillset: unsupported Claude runtime key ${key} in ${label}`
      );
  }
  const settingSources = readString(value, "settingSources");
  if (settingSources === undefined) return undefined;
  if (
    settingSources === "isolated" ||
    settingSources === "local" ||
    settingSources === "project" ||
    settingSources === "user"
  ) {
    return settingSources;
  }
  throw new Error(
    `skillset: expected ${label}.settingSources to be isolated, user, project, or local`
  );
}

function readOptionalPositiveInteger(
  value: JsonValue | undefined,
  label: string
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`skillset: expected ${label} to be a positive integer`);
  }
  return value;
}

function readSkillsetActivationExpectation(
  value: JsonValue | undefined,
  label: string
): SkillsetActivationExpectation {
  if (!isJsonRecord(value))
    throw new Error(`skillset: expected ${label} to be an object`);
  const entries = (["agent", "plugin", "skill"] as const)
    .map((kind) => ({ kind, name: readString(value, kind) }))
    .filter(
      (entry): entry is SkillsetActivationExpectation =>
        entry.name !== undefined
    );
  if (entries.length !== 1) {
    throw new Error(
      `skillset: ${label} must name exactly one of agent, plugin, or skill`
    );
  }
  const [entry] = entries;
  if (entry === undefined)
    throw new Error(
      `skillset: ${label} must name exactly one of agent, plugin, or skill`
    );
  return entry;
}

function activationProbeName(expect: SkillsetActivationExpectation): string {
  return `${expect.kind}-${expect.name}`;
}

function validateSkillsetActivationProbeNames(
  probes: readonly SkillsetActivationProbe[],
  targets: readonly TargetName[]
): void {
  for (const target of targets) {
    const names = new Set<string>();
    for (const probe of probes.filter((candidate) =>
      candidate.targets.includes(target)
    )) {
      const name = slugifySkillsetTestProbeName(probe.name);
      if (names.has(name)) {
        throw new Error(
          `skillset: duplicate activation probe output name ${JSON.stringify(name)} for target ${target}`
        );
      }
      names.add(name);
    }
  }
}

export async function loadSkillsetTestDeclarations(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly SkillsetTestDeclaration[]> {
  const context = await loadSkillsetTestEvaluationContext(rootPath, options);
  const declarations = context.declarations;
  if (declarations.length === 0) {
    throw new Error(
      `skillset: ${testDeclarationRoot(context.graph)} must include tests.yaml or tests/*.yaml for skillset test`
    );
  }
  return declarations;
}

export async function loadSkillsetTestDeclaration(
  rootPath: string,
  requestedName: string | undefined,
  options: SkillsetOptions = {}
): Promise<{
  readonly declaration: SkillsetTestDeclaration;
  readonly graph: BuildGraph;
}> {
  const context = await loadSkillsetTestDeclarationContext(rootPath, options);
  const name = selectTestName(context.graph, context.names, requestedName);
  const source = context.tests[name];
  if (source === undefined)
    throw new Error(`skillset: test ${name} is not configured`);
  return {
    declaration: await readTestObject(
      context.graph,
      source.record,
      source.label,
      name,
      context.defaultTargets
    ),
    graph: context.graph,
  };
}

export async function listSkillsetTestDeclarations(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<
  readonly { readonly name: string; readonly targets: readonly TargetName[] }[]
> {
  const { declarations } = await loadSkillsetTestEvaluationContext(
    rootPath,
    options
  );
  return declarations.map((declaration) => ({
    name: declaration.name,
    targets: declaration.targets,
  }));
}

export async function listEnabledSkillsetTestTargets(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly TargetName[]> {
  const graph = await loadBuildGraph(rootPath, options);
  return targetNames().filter((target) => graph.root.targets[target].enabled);
}

export function slugifySkillsetTestProbeName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? "probe" : slug;
}

export function skillsetTestSelectionRecord(
  selection: SkillsetTestSelection
): SkillsetTestSelectionReport {
  return {
    agents: selection.agents.map((agent) => agent.outputName),
    filterSource: selection.filterSource,
    pluginSkills: selection.pluginSkills.map(
      (skill) => `${skill.pluginId}/${skill.skillId}`
    ),
    plugins: [...selection.plugins],
    primarySkills: [...selection.primarySkills],
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
