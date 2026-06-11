import type { TransformEntry } from "./types";

/**
 * Explicit entry registry keyed by intent; no implicit discovery. Built-in
 * entries register on package import (see ./entries). Registration order is
 * the deterministic tiebreak the engine uses for equal-length overlaps.
 */
export const transformEntries = new Map<string, TransformEntry>();

export const registerTransformEntry = (entry: TransformEntry): void => {
  if (transformEntries.has(entry.intent)) {
    throw new Error(`transform entry already registered: ${entry.intent}`);
  }
  if (entry.evidence.length === 0) {
    throw new Error(`transform entry has no evidence: ${entry.intent}`);
  }
  if (entry.lowering === "none" && entry.reason === undefined) {
    throw new Error(`transform entry with lowering "none" needs a reason: ${entry.intent}`);
  }
  for (const [dialect, form] of Object.entries(entry.forms)) {
    if (!(form.pattern.flags.includes("g") && form.pattern.flags.includes("u"))) {
      throw new Error(
        `transform pattern for ${entry.intent} (${dialect}) must carry g and u flags`
      );
    }
  }
  transformEntries.set(entry.intent, entry);
};

export const listTransformEntries = (): readonly TransformEntry[] => [
  ...transformEntries.values(),
];
