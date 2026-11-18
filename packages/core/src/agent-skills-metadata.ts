import type { JsonRecord } from "./types";

/** Agent Skills destination constraint; canonical Skillset metadata is broader. */
export function incompatibleAgentSkillsMetadataKeys(metadata: JsonRecord): readonly string[] {
  return Object.keys(metadata).filter((key) => typeof metadata[key] !== "string");
}
