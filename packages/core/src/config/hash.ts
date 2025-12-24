import { createHash } from "node:crypto";
import stableStringify from "json-stable-stringify";

export function hashValue(value: unknown): string {
  const canonical = stableStringify(value) ?? "undefined";
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}
