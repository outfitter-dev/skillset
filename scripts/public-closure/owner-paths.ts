import { posix } from "node:path";

import { normalizeShellToken } from "./shell-tokens";

/**
 * Owner matching for a single path-shaped operand. Every command grammar in
 * this directory reduces its operands to this one predicate, so "does this path
 * reach a protected owner?" has a single answer regardless of which tool
 * produced the operand.
 */

export function collapseRepeatedPathSeparators(text: string): string {
  return text.replace(/\/{2,}/gu, "/");
}

/**
 * Reports whether a glob operand can expand into the owner, by matching the
 * owner's segments against the operand's literal segments.
 */
export function globContainsOwner(
  operand: string,
  normalizedOwner: string
): boolean {
  if (!/(?:\*|\?|\[)/u.test(operand)) return false;
  const segments = operand.split("/");
  const ownerSegments = normalizedOwner.split("/");
  return segments.some((_, index) =>
    ownerSegments.every(
      (ownerSegment, offset) => segments[index + offset] === ownerSegment
    )
  );
}

/**
 * Reports whether a command operand names a path under the protected owner.
 * `allowDirectOwner` is false for owners whose bare name is also public plugin
 * vocabulary, where only a parent-relative or repository-absolute spelling
 * proves the operand leaves the plugin.
 */
export function pathMatchesOwner(
  operand: string,
  normalizedOwner: string,
  repoRoot?: string,
  allowDirectOwner = true
): boolean {
  const normalizedPath = posix
    .normalize(
      collapseRepeatedPathSeparators(
        normalizeShellToken(operand.replaceAll("\\", "/"))
      )
    )
    .toLowerCase();
  const normalizedRoot = repoRoot
    ?.replaceAll("\\", "/")
    .replace(/\/+$/u, "")
    .toLowerCase();
  const absoluteOwner = normalizedRoot
    ? posix.normalize(`${normalizedRoot}/${normalizedOwner}`)
    : undefined;
  if (posix.isAbsolute(normalizedPath)) {
    if (!normalizedRoot) return false;
    if (
      absoluteOwner &&
      (normalizedPath === absoluteOwner ||
        normalizedPath.startsWith(`${absoluteOwner}/`))
    ) {
      return true;
    }
    if (!normalizedPath.startsWith(`${normalizedRoot}/`)) return false;
    return globContainsOwner(
      normalizedPath.slice(normalizedRoot.length + 1),
      normalizedOwner
    );
  }
  const repositoryRelative = normalizedPath.replace(/^(?:\.\.\/)+/u, "");
  const isParentRelative = repositoryRelative !== normalizedPath;
  return (
    ((allowDirectOwner || isParentRelative) &&
      (repositoryRelative === normalizedOwner ||
        repositoryRelative.startsWith(`${normalizedOwner}/`))) ||
    (allowDirectOwner && globContainsOwner(repositoryRelative, normalizedOwner))
  );
}
