import { collectFiles } from "./render-support";
import path from "node:path";
import { readFile, realpath } from "./workspace-fs";
import { isPreprocessDisabled, preprocessText, resolveOpaqueMarkedPathReferences, type ResolvedPreprocessPathReference } from "./preprocess";
import { createEffectiveSkillResourcePlanner, rewriteResourceLinks } from "./resources";
import { parseMarkdown } from "./yaml";
import type { BuildGraph, JsonRecord, SourcePlugin, SourceResource, TargetName } from "./types";

/** One resource inventory and active traversal shared by an emitted unit. */
export function createResourceContentPlan(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  declaredResources: readonly SourceResource[],
  label: string,
  target?: TargetName,
  options: {
    readonly resourcePrefix?: string;
    readonly validateReference?: (reference: ResolvedPreprocessPathReference) => Promise<void>;
  } = {}
) {
  const resourcePrefix = options.resourcePrefix ?? "";
  const preprocessDependencies = new Set<string>();
  const planner = createEffectiveSkillResourcePlanner(declaredResources, {
    label,
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
  async function renderReference(reference: ResolvedPreprocessPathReference, output: string, renderPath?: (destination: string) => string) {
    await options.validateReference?.(reference);
    const destination = path.posix.join(resourcePrefix, await planner.resolveReference(reference.specifier));
    await processFile(reference.resolvedPath, destination, reference.includeChain);
    return renderPath?.(destination) ?? path.posix.relative(path.posix.dirname(output), destination);
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
    const processed = await processBody(parsed.body, parsed.frontmatter, source, output, chain);
    pending.push({ output, source, prefix: markdownPrefix(text, bom.length), body: processed });
  }
  async function processBody(body: string, frontmatter: JsonRecord, source: string, output: string, chain?: readonly string[], referenceOptions: {
    readonly markedLinksOnly?: boolean;
    readonly validateMarkedReference?: (offset: number) => void;
    readonly renderPath?: (destination: string) => string;
  } = {}) {
    const bodyContext = {
      ...context, frontmatter, sourcePath: source,
      includeChain: chain ?? [await realpath(source)],
      renderPathReference: (reference: ResolvedPreprocessPathReference) => renderReference(reference, output, referenceOptions.renderPath),
    };
    return referenceOptions.markedLinksOnly
      ? resolveOpaqueMarkedPathReferences(body, bodyContext, referenceOptions.validateMarkedReference)
      : preprocessText(body, bodyContext);
  }
  async function finish() {
    // Declared resources can be unlinked or directories; each is also a root.
    // Linked traversal is intentionally repeated with its active path so a short
    // first visit cannot conceal a later cycle or over-depth route.
    for (const resource of declaredResources) {
      const files = resource.kind === "file" ? [resource.sourcePath] : await collectFiles(resource.sourcePath);
      for (const source of files) {
        const output = resource.kind === "file" ? resource.targetPath : path.posix.join(
          resource.targetPath, path.relative(resource.sourcePath, source).replaceAll("\\", "/")
        );
        await processFile(source, path.posix.join(resourcePrefix, output));
      }
    }
    const resources = planner.resources().map(resource => ({ ...resource, targetPath: path.posix.join(resourcePrefix, resource.targetPath) }));
    const documents = new Map<string, { readonly body: string; readonly source: string }>();
    for (const file of pending) {
      const body = rewriteResourceLinks(file.body, resources, file.source, file.output);
      nestedFiles.set(file.output, Buffer.from(file.prefix + body));
      documents.set(file.output, { body, source: file.source });
    }
    return { nestedFiles, preprocessDependencies, resources, documents };
  }
  return { processBody, processFile, finish };
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
