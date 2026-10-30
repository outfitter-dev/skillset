import { isDeepStrictEqual } from "node:util";
import { resolveAdaptiveHookAttachmentIdentities } from "./adaptive-hook-attachments";
import { absoluteWorkspacePath, display, remapPath } from "./source-rename-paths";
import type { SourceMutationOperation, SourceRenameMoveOperation } from "./source-rename-types";
import type { BuildGraph, SourceAdaptiveHook, SourceHookAttachment } from "./types";

interface Binding {
  readonly attachment: SourceHookAttachment;
  readonly definition?: string;
  readonly candidates: readonly string[];
}

/** A lifecycle move changes location, never the identity an attachment resolves to. */
export function assertSourceHookBindingsPreserved(
  before: BuildGraph,
  after: BuildGraph,
  operations: readonly SourceMutationOperation[],
  planError: (message: string) => Error
): void {
  const moves = operations.filter((operation): operation is SourceRenameMoveOperation => operation.kind === "move");
  if (moves.length === 0) return;
  const remap = (path: string): string => {
    const absolute = absoluteWorkspacePath(before.rootPath, path);
    for (const move of moves) {
      const mapped = remapPath(absolute, absoluteWorkspacePath(before.rootPath, move.from), absoluteWorkspacePath(before.rootPath, move.to));
      if (mapped !== absolute) return display(before.rootPath, mapped);
    }
    return display(before.rootPath, absolute);
  };
  const next = bindingsByDocument(after);
  for (const [path, bindings] of bindingsByDocument(before)) {
    const mappedPath = remap(path);
    const replacements = next.get(mappedPath);
    if (replacements === undefined || bindings.length !== replacements.length) {
      throw planError(`hook binding correspondence changed in ${path}; reconcile attachments before moving or renaming source`);
    }
    for (const [index, binding] of bindings.entries()) {
      const replacement = replacements[index]!;
      const expected = binding.definition === undefined ? undefined : remap(binding.definition);
      const sameResolvedIdentity = expected !== undefined && expected === replacement.definition;
      // Existing unresolved drafts are not newly invalidated by unrelated edits.
      // Moving one cannot prove its binding is preserved, so fail closed.
      const sameUnresolvedIdentity = expected === undefined && replacement.definition === undefined &&
        mappedPath === path && binding.attachment.hook === replacement.attachment.hook &&
        isDeepStrictEqual(binding.candidates, replacement.candidates);
      if (
        (!sameResolvedIdentity && !sameUnresolvedIdentity) ||
        !isDeepStrictEqual(attachmentPolicy(binding.attachment), attachmentPolicy(replacement.attachment))
      ) {
        throw planError(`hook binding changed in ${path} for ${binding.attachment.hook}: ${binding.definition ?? "unresolved"} -> ${replacement.definition ?? "unresolved"}; reconcile hook names and scopes before moving or renaming source`);
      }
    }
  }
}

function attachmentPolicy(attachment: SourceHookAttachment): unknown {
  return {
    event: attachment.event,
    match: attachment.match,
    providers: attachment.providers,
    status: attachment.status,
  };
}

function bindingsByDocument(graph: BuildGraph): Map<string, Binding[]> {
  const documents = new Map<string, Binding[]>();
  const add = (attachments: readonly SourceHookAttachment[], definitions: readonly SourceAdaptiveHook[]) => {
    for (const attachment of attachments) {
      const candidates = definitions.filter((definition) => definition.name === attachment.hook);
      const resolution = resolveAdaptiveHookAttachmentIdentities(candidates, [attachment]);
      const definition = resolution.issues.length === 0 ? resolution.resolved[0]?.definition : undefined;
      const relativePath = (path: string) => display(graph.rootPath, absoluteWorkspacePath(graph.rootPath, path));
      const binding: Binding = {
        attachment,
        ...(definition === undefined ? {} : { definition: relativePath(definition.sourcePath) }),
        candidates: candidates.map((candidate) => relativePath(candidate.sourcePath)).sort(),
      };
      const path = relativePath(attachment.sourcePath);
      const group = documents.get(path);
      if (group === undefined) documents.set(path, [binding]);
      else group.push(binding);
    }
  };
  add(graph.hookAttachments, graph.adaptiveHooks);
  for (const skill of graph.discoveredSkills ?? []) {
    if (skill.status !== "draft") continue;
    // Live and draft counterparts share scope IDs. Resolve each draft only
    // against its own local definitions and its visible enclosing definitions.
    const pluginId = skill.hookAttachments[0]?.scope.pluginId;
    add(skill.hookAttachments, [
      ...graph.adaptiveHooks.filter((definition) =>
        definition.scope.kind === "root" ||
        (definition.scope.kind === "plugin" && definition.scope.pluginId === pluginId)
      ),
      ...skill.adaptiveHooks,
    ]);
  }
  return documents;
}
