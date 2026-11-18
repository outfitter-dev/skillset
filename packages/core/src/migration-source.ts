import type { MigrationState } from "@skillset/schema";
import { inspectMigrationMarkers } from "./migration-markers";
import { parseMarkdown } from "./yaml";
import type { MarkdownParts } from "./types";

export interface MigrationMarkdownParts extends MarkdownParts {
  readonly semanticSourceContent?: string;
  /** Semantic body line to one-based authored document line. */
  readonly bodySourceLines?: readonly number[];
}
export interface MigrationSourceReader {
  read(content: string, path: string): MigrationMarkdownParts;
  finish(): void;
}

/** The resolver supplies the complete adaptive-source inventory, including drafts. */
export function createMigrationSourceReader(state: MigrationState): MigrationSourceReader {
  const readPaths = new Set<string>();
  const inlinePaths = new Set(state.flags.filter((flag) => flag.placement.kind === "inline").map((flag) => flag.source.path));
  return {
    read(content, path) {
      readPaths.add(path);
      const original = parseMarkdown(content, path);
      if (!inlinePaths.has(path) && !content.includes("<!-- skillset:")) return original;
      const result = inspectMigrationMarkers({ content, path, state });
      if (result.diagnostics.length > 0) {
        throw new Error(`skillset: ${result.diagnostics.map((item) => `${item.path}:${item.line}: ${item.code}: ${item.message}`).join("; ")}`);
      }
      if (result.markers.length === 0) return original;
      const parts = parseMarkdown(result.content, path);
      const documentLines = result.content.split(/\r\n|\n|\r/u).length;
      const bodyLines = parts.body.split("\n").length;
      return { ...parts, semanticSourceContent: result.content, bodySourceLines: result.sourceLines.slice(documentLines - bodyLines) };
    },
    finish() {
      for (const path of inlinePaths) {
        if (!readPaths.has(path)) throw new Error(`skillset: migration/missing-anchor: ${path}: inline migration anchors require a loaded adaptive rule, skill or project agent; use sidecar placement for other material.`);
      }
    },
  };
}
