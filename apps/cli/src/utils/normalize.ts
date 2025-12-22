import { normalizeTokenRef } from "@skillset/core";

export type InvocationKind = "skill" | "set";

export interface NormalizedInvocation {
  raw: string;
  alias: string;
  namespace: string | undefined;
  kind?: InvocationKind;
}

export function normalizeInvocation(
  input: string,
  kindOverride?: InvocationKind
): NormalizedInvocation {
  const trimmed = input.trim();
  const hasDollar = trimmed.startsWith("$");
  const hasLegacy = trimmed.startsWith("w/");
  let cleaned = hasDollar ? trimmed.slice(1) : trimmed;
  if (hasLegacy) {
    cleaned = trimmed.slice(2);
  }

  let kind: InvocationKind | undefined;
  const kindMatch = cleaned.match(/^(skill|set):/i);
  if (kindMatch?.[1]) {
    kind = kindMatch[1].toLowerCase() as InvocationKind;
    cleaned = cleaned.slice(kindMatch[0].length);
  }

  const normalizedRef = normalizeTokenRef(cleaned);
  const parts = normalizedRef.split(":").filter(Boolean);
  const namespace = parts.length > 1 ? parts[0] : undefined;
  const alias = parts.length > 1 ? parts.slice(1).join(":") : parts[0] ?? "";

  const raw = hasDollar
    ? trimmed
    : hasLegacy
      ? `$${trimmed.slice(2)}`
      : `$${kind ? `${kind}:` : ""}${cleaned}`;

  return {
    raw,
    alias,
    namespace,
    kind: kind ?? kindOverride,
  };
}
