import { readRecord, readString } from "./config";
import type { JsonValue, SourcePlugin } from "./types";

/** Retains the final native value, including invalid values for the owning validator. */
export function nativePluginManifestName(
  plugin: SourcePlugin,
  target: "claude" | "cursor"
): JsonValue {
  const native = readRecord(plugin.targets[target].options, "manifest")?.name;
  if (native !== undefined) return native;
  return readString(readRecord(plugin.metadata, "manifest") ?? {}, "name") ?? plugin.id;
}
