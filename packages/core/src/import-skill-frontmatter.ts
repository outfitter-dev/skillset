import { isDeepStrictEqual } from "node:util";
import { readRecord } from "./config";
import { updateMarkdownSourceDocument } from "./source-document";
import type { TargetName } from "./types";

/** Source attribution scopes values; it does not establish provider support or equivalence. */
export function scopeImportedSkillFrontmatter(
  source: string,
  path: string,
  providers: readonly TargetName[],
  fields: readonly string[]
): string {
  if (fields.length === 0) return source;
  if (providers.length === 0) {
    return updateMarkdownSourceDocument(source, path, (parts) => {
      const metadata = readRecord(parts.frontmatter, "skillset") ?? {};
      const existing = Array.isArray(metadata.unresolved_frontmatter) ? metadata.unresolved_frontmatter : [];
      return { ...parts, frontmatter: { ...parts.frontmatter, skillset: { ...metadata, unresolved_frontmatter: [...new Set([...existing, ...fields])].sort() } } };
    });
  }
  return updateMarkdownSourceDocument(source, path, (parts) => {
    const frontmatter = { ...parts.frontmatter };
    for (const field of fields) delete frontmatter[field];
    for (const provider of providers) {
      const target = readRecord(parts.frontmatter, provider) ?? {};
      const native = { ...(readRecord(target, "frontmatter") ?? {}) };
      for (const field of fields) {
        const value = parts.frontmatter[field];
        if (value === undefined) continue;
        if (native[field] !== undefined && !isDeepStrictEqual(native[field], value)) {
          throw new Error(`skillset: conflicting ${field} and ${provider}.frontmatter.${field} in ${path}`);
        }
        native[field] = value;
      }
      frontmatter[provider] = { ...target, frontmatter: native };
    }
    return { ...parts, frontmatter };
  });
}
