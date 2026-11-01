import path from "node:path";
import { createResourceContentPlan } from "./resource-content-plan";
import { assertSkillMarkdownContainment } from "./rendered-markdown-links";
import type { BuildGraph, RenderedFile, SourcePlugin, SourceSkill, TargetName } from "./types";

/** Plan all skill-owned Markdown before freezing its shared resource inventory. */
export async function planSkillContent(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  sourceFiles: readonly string[] = [],
  target?: TargetName
) {
  const plan = createResourceContentPlan(graph, plugin, skill.resources, skill.sourcePath, target);
  const body = await plan.processBody(skill.body, skill.frontmatter, skill.sourcePath, "SKILL.md");
  for (const source of sourceFiles) {
    await plan.processFile(source, path.relative(path.dirname(skill.sourcePath), source).replaceAll("\\", "/"));
  }
  const result = await plan.finish();
  for (const [output, document] of result.documents) {
    assertSkillMarkdownContainment(document.body, output, path.relative(graph.rootPath, document.source));
  }
  return { body, ...result };
}

export function withSkillContent<T extends RenderedFile>(
  file: T, targetSkillDir: string, contents: ReadonlyMap<string, Uint8Array> | undefined
): T {
  const content = contents?.get(path.relative(targetSkillDir, file.path).replaceAll("\\", "/"));
  return content === undefined ? file : { ...file, content };
}
