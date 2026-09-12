import { readFile } from "node:fs/promises";
import path from "node:path";

import { mergeRecords } from "./config";
import { formatPreprocessDependency, preprocessText } from "./preprocess";
import { exists, GENERATED_BY, textFile } from "./render-support";
import { resolveDeclaredResourceReference } from "./resources";
import {
  readAllowedTools,
  readImplicitInvocation,
  readToolsPolicyMetadata,
} from "./skill-policy";
import { renderValidatedYaml } from "./structured-output";
import { toolsMetadataSidecarTargets } from "./tools-realization";
import type {
  BuildGraph,
  JsonRecord,
  RenderedFile,
  SourcePlugin,
  SourceSkill,
  TargetName,
} from "./types";
import { parseYamlRecord } from "./yaml";

export interface RenderedSkillAuxiliaryFile {
  readonly file: RenderedFile;
  readonly preprocessDependencies: readonly string[];
}

export async function renderCodexSkillAgentFile(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  target: TargetName,
  sourceDir: string,
  targetSkillDir: string
): Promise<RenderedSkillAuxiliaryFile | undefined> {
  if (target !== "codex") return undefined;

  const label = path.relative(graph.rootPath, skill.sourcePath);
  const generated = renderCodexSkillAgentConfig(skill, label);
  const sourceOpenAiPath = path.join(sourceDir, "agents/openai.yaml");
  const hasSourceOpenAi = await exists(sourceOpenAiPath);
  if (!hasSourceOpenAi && Object.keys(generated).length === 0) return undefined;

  const preprocessDependencies = new Set<string>();
  const source = hasSourceOpenAi
    ? parseYamlRecord(
        await preprocessText(await readFile(sourceOpenAiPath, "utf8"), {
          frontmatter: skill.frontmatter,
          preprocessDependencies,
          rootPath: graph.rootPath,
          sourcePath: sourceOpenAiPath,
          sourceRoot: graph.sourceRoot,
          target,
          promptArguments: graph.root.compile.features.promptArguments,
          renderPathReference: (reference) =>
            reference.scheme === undefined
              ? reference.specifier.replaceAll("\\", "/")
              : resolveDeclaredResourceReference(
                  reference.specifier,
                  skill.resources,
                  skill.sourcePath
                ),
          ...(plugin === undefined ? {} : { pluginPath: plugin.path }),
        }),
        sourceOpenAiPath
      )
    : {};
  const merged = mergeRecords(source, generated);
  return {
    file: textFile(
      path.join(targetSkillDir, "agents/openai.yaml"),
      renderValidatedYaml(
        merged,
        `${path.relative(graph.rootPath, sourceOpenAiPath)} -> ${path.join(targetSkillDir, "agents/openai.yaml")}`
      ),
      path.relative(graph.rootPath, sourceOpenAiPath)
    ),
    preprocessDependencies: [...preprocessDependencies]
      .map((dependency) =>
        formatPreprocessDependency(graph.rootPath, dependency)
      )
      .sort(),
  };
}

export function renderSkillToolsMetadataFile(
  graph: BuildGraph,
  skill: SourceSkill,
  target: TargetName,
  targetSkillDir: string
): RenderedFile | undefined {
  if (!toolsMetadataSidecarTargets().includes(target)) return undefined;

  const label = path.relative(graph.rootPath, skill.sourcePath);
  const tools = readToolsPolicyMetadata(
    skill.frontmatter,
    skill.targets[target].options,
    target,
    label
  );
  if (Object.keys(tools).length === 0) return undefined;

  return textFile(
    path.join(targetSkillDir, ".skillset.tools.yaml"),
    renderValidatedYaml(
      {
        generated: GENERATED_BY,
        schema_version: 1,
        target,
        tools,
      },
      `${label} -> ${path.join(targetSkillDir, ".skillset.tools.yaml")}`
    ),
    label
  );
}

function renderCodexSkillAgentConfig(
  skill: SourceSkill,
  label: string
): JsonRecord {
  const implicitInvocation = readImplicitInvocation(
    skill.frontmatter,
    "codex",
    label
  );
  const allowedTools = readAllowedTools(skill.frontmatter, "codex", label);
  if (allowedTools !== undefined && allowedTools !== false) {
    throw new Error(
      `skillset: ${label} allowed_tools has no Codex skill-local lowering; ` +
        "set allowed_tools.codex: false or move Codex tool dependencies into agents/openai.yaml"
    );
  }
  if (implicitInvocation === undefined) return {};
  return { policy: { allow_implicit_invocation: implicitInvocation } };
}
