export function normalizeTokenSegment(input: string): string {
  const withSeparators = input
    .replace(/[_\s]+/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z0-9])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9-]/g, "-");
  return withSeparators.replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function normalizeTokenRef(input: string): string {
  return input
    .split(":")
    .map((segment) =>
      segment
        .split("/")
        .map((part) => normalizeTokenSegment(part))
        .filter(Boolean)
        .join("/")
    )
    .filter(Boolean)
    .join(":");
}
