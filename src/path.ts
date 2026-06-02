import { relative, resolve, sep } from "node:path";

export function resolveInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, candidate);
  const relativePath = relative(resolvedRoot, resolved);

  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    relativePath.includes(`..${sep}`)
  ) {
    throw new Error(`skillset: refusing to operate outside repo root: ${candidate}`);
  }

  return resolved;
}

export function validateSlug(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(
      `skillset: expected ${label} to be a lowercase slug, received ${JSON.stringify(value)}`
    );
  }

  return value;
}
