import { assertSkillMarkdownContainment } from "./rendered-markdown-links";
import { collectFiles } from "./render-support";
import path from "node:path";
import { readFile, realpath } from "./workspace-fs";
import { isPreprocessDisabled, preprocessText, type ResolvedPreprocessPathReference } from "./preprocess";
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
  const nestedFiles = new Map<string, Uint8Array>();
  const pending: { output: string; source: string; prefix: string; body: string }[] = [];
  async function renderReference(reference: ResolvedPreprocessPathReference, output: string) {
    const destination = await planner.resolveReference(reference.specifier);
    await processFile(reference.resolvedPath, destination, reference.includeChain);
    return path.posix.relative(path.posix.dirname(output), destination);
  }
  async function processFile(source: string, output: string, chain?: readonly string[]) {
    if (!source.endsWith(".md")) return;
    const bytes = await readFile(source);
    const text = bytes.toString("utf8");
    const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
    const parsed = parseMarkdown(text.slice(bom.length), source);
    if (isPreprocessDisabled(parsed.frontmatter)) {
      nestedFiles.set(output, bytes);
      return;
    }
    const processed = await preprocessText(parsed.body, {
      ...context, frontmatter: parsed.frontmatter, sourcePath: source,
      includeChain: chain ?? [await realpath(source)],
      renderPathReference: (reference) => renderReference(reference, output),
    });
    pending.push({ output, source, prefix: markdownPrefix(text, bom.length), body: processed });
  }
  const body = await preprocessText(skill.body, {
    ...context, frontmatter: skill.frontmatter, sourcePath: skill.sourcePath,
    includeChain: [await realpath(skill.sourcePath)],
    renderPathReference: (reference) => renderReference(reference, "SKILL.md"),
  });
  for (const source of sourceFiles) {
    await processFile(source, path.relative(path.dirname(skill.sourcePath), source).replaceAll("\\", "/"));
  }
  // Declared resources can be unlinked or directories; each is also a root.
  // Linked traversal is intentionally repeated with its active path so a short
  // first visit cannot conceal a later cycle or over-depth route.
  for (const resource of skill.resources) {
    const files = resource.kind === "file" ? [resource.sourcePath] : await collectFiles(resource.sourcePath);
    for (const source of files) {
      const output = resource.kind === "file" ? resource.targetPath : path.posix.join(
        resource.targetPath, path.relative(resource.sourcePath, source).replaceAll("\\", "/")
      );
      await processFile(source, output);
    }
  }
  const resources = planner.resources();
  for (const file of pending) {
    const body = rewriteResourceLinks(file.body, resources, file.source, file.output);
    assertSkillMarkdownContainment(body, file.output, path.relative(graph.rootPath, file.source));
    nestedFiles.set(file.output, Buffer.from(file.prefix + body));
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
