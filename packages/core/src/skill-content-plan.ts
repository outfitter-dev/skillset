import path from "node:path";
import { readFile } from "./workspace-fs";
import { isPreprocessDisabled, preprocessText } from "./preprocess";
import { createEffectiveSkillResourcePlanner, rewriteResourceLinks } from "./resources";
import { parseMarkdown } from "./yaml";
import type { BuildGraph, RenderedFile, SourcePlugin, SourceSkill, TargetName } from "./types";

/** Plan all skill-owned Markdown before freezing its shared resource inventory. */
export async function planSkillContent(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  sourceFiles: readonly string[] = [],
  target?: TargetName
) {
  const preprocessDependencies = new Set<string>();
  const planner = createEffectiveSkillResourcePlanner(skill.resources, {
    label: skill.sourcePath,
    ...(plugin === undefined ? {} : { pluginSharedPath: path.join(plugin.path, "shared") }),
    sharedPath: path.join(graph.sourceRootPath, "shared"),
    sourceRootPath: graph.sourceRootPath,
  });
  const context = {
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourceRoot: graph.sourceRoot,
    promptArguments: graph.root.compile.features.promptArguments,
    ...(target === undefined ? {} : { target }),
    ...(plugin === undefined ? {} : { pluginPath: plugin.path }),
  };
  const body = await preprocessText(skill.body, {
    ...context, frontmatter: skill.frontmatter, sourcePath: skill.sourcePath,
    renderPathReference: (reference) => planner.resolveReference(reference.specifier),
  });
  const nestedFiles = new Map<string, Uint8Array>();
  const pending: { output: string; source: string; prefix: string; body: string }[] = [];
  for (const source of sourceFiles) {
    if (!source.endsWith(".md")) continue;
    const output = path.relative(path.dirname(skill.sourcePath), source).replaceAll("\\", "/");
    const bytes = await readFile(source);
    const text = bytes.toString("utf8");
    const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
    const parsed = parseMarkdown(text.slice(bom.length), source);
    if (isPreprocessDisabled(parsed.frontmatter)) {
      nestedFiles.set(output, bytes);
      continue;
    }
    const processed = await preprocessText(parsed.body, {
      ...context, frontmatter: parsed.frontmatter, sourcePath: source,
      renderPathReference: async (reference) => path.posix.relative(
        path.posix.dirname(output), await planner.resolveReference(reference.specifier)
      ),
    });
    pending.push({ output, source, prefix: markdownPrefix(text, bom.length), body: processed });
  }
  const resources = planner.resources();
  for (const file of pending) {
    nestedFiles.set(file.output, Buffer.from(file.prefix + rewriteResourceLinks(file.body, resources, file.source, file.output)));
  }
  return { body, nestedFiles, preprocessDependencies, resources };
}

// Preserve authored frontmatter bytes, including BOM and line endings.
function markdownPrefix(text: string, start: number): string {
  const lines = text.slice(start).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  if (lines[0]?.replace(/[\r\n]+$/, "") !== "---") return text.slice(0, start);
  let end = start + lines[0].length;
  for (const line of lines.slice(1)) {
    end += line.length;
    if (line.replace(/[\r\n]+$/, "") === "---") return text.slice(0, end);
  }
  return text.slice(0, start);
}

export function withSkillContent<T extends RenderedFile>(
  file: T, targetSkillDir: string, contents: ReadonlyMap<string, Uint8Array> | undefined
): T {
  const content = contents?.get(path.relative(targetSkillDir, file.path).replaceAll("\\", "/"));
  return content === undefined ? file : { ...file, content };
}
