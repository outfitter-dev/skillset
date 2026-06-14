const textDecoder = new TextDecoder();

export type HostLeakKind =
  | "forbidden-substring"
  | "home-path"
  | "posix-host-path"
  | "repo-path"
  | "temp-path"
  | "windows-host-path"
  | "workspace-path";

export interface HostLeakDetectionOptions {
  readonly forbiddenSubstrings?: readonly string[];
  readonly homePath?: string;
  readonly repoRootPath?: string;
  readonly tempRootPath?: string;
  readonly workspacePaths?: readonly string[];
}

export interface HostLeakMatch {
  readonly kind: HostLeakKind;
  readonly redacted: string;
}

export interface HostLeakIssue {
  readonly kind: HostLeakKind;
  readonly path: string;
  readonly redacted: string;
}

export function detectHostLeaksInBytes(
  path: string,
  bytes: Uint8Array,
  options: HostLeakDetectionOptions = {}
): readonly HostLeakIssue[] {
  return detectHostLeaks(path, textDecoder.decode(bytes), options);
}

export function detectHostLeaks(
  path: string,
  text: string,
  options: HostLeakDetectionOptions = {}
): readonly HostLeakIssue[] {
  const matches: HostLeakMatch[] = [
    ...explicitPathMatches(text, options),
    ...patternMatches(text),
  ];
  return dedupeMatches(matches).map((match) => ({
    kind: match.kind,
    path,
    redacted: match.redacted,
  }));
}

export function assertNoHostLeaks(
  path: string,
  bytes: Uint8Array,
  options: HostLeakDetectionOptions = {}
): void {
  const [first] = detectHostLeaksInBytes(path, bytes, options);
  if (first === undefined) return;
  throw new Error(
    `skillset: ${path} contains ${first.kind} leak (${first.redacted})`
  );
}

function explicitPathMatches(
  text: string,
  options: HostLeakDetectionOptions
): readonly HostLeakMatch[] {
  const matches: HostLeakMatch[] = [];
  for (const value of options.forbiddenSubstrings ?? []) {
    pushExplicitMatch(matches, text, value, "forbidden-substring");
  }
  pushExplicitMatch(matches, text, options.repoRootPath, "repo-path");
  pushExplicitMatch(matches, text, options.tempRootPath, "temp-path");
  pushExplicitMatch(matches, text, options.homePath, "home-path");
  for (const workspacePath of options.workspacePaths ?? []) {
    pushExplicitMatch(matches, text, workspacePath, "workspace-path");
  }
  return matches;
}

function pushExplicitMatch(
  matches: HostLeakMatch[],
  text: string,
  value: string | undefined,
  kind: HostLeakKind
): void {
  if (value === undefined || value.length === 0 || !text.includes(value)) return;
  matches.push({ kind, redacted: kind === "forbidden-substring" ? redactForbiddenSubstring(value) : redactHostPath(value) });
}

function patternMatches(text: string): readonly HostLeakMatch[] {
  const matches: HostLeakMatch[] = [];
  for (const match of text.matchAll(POSIX_HOST_PATH_PATTERN)) {
    const value = match[1];
    if (value === undefined) continue;
    matches.push({ kind: "posix-host-path", redacted: redactHostPath(value) });
  }
  for (const match of text.matchAll(WINDOWS_HOST_PATH_PATTERN)) {
    const value = match[1];
    if (value === undefined) continue;
    matches.push({ kind: "windows-host-path", redacted: redactHostPath(value) });
  }
  return matches;
}

const POSIX_HOST_PATH_PATTERN = /(?:^|[\s"'=:(])((?:\/(?:Users|home|tmp|private\/tmp|private\/var\/folders|var\/folders)\/)[^\s"'<>)`]+)/gu;
const WINDOWS_HOST_PATH_PATTERN = /(?:^|[\s"'=:(])([A-Za-z]:[\\/](?:Users|Temp|tmp)[^\s"'<>)`]+)/gu;

function dedupeMatches(matches: readonly HostLeakMatch[]): readonly HostLeakMatch[] {
  const seen = new Set<string>();
  const unique: HostLeakMatch[] = [];
  for (const match of matches) {
    const key = `${match.kind}\0${match.redacted}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }
  return unique;
}

function redactHostPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (/^[A-Za-z]:/u.test(parts[0] ?? "")) {
    const drive = parts[0];
    const tail = parts.at(-1);
    return tail === undefined ? `${drive}/...` : `${drive}/.../${tail}`;
  }
  const root = normalized.startsWith("/") ? "/" : "";
  const first = parts[0];
  const tail = parts.at(-1);
  if (first === undefined) return path;
  if (tail === undefined || tail === first) return `${root}${first}/...`;
  return `${root}${first}/.../${tail}`;
}

function redactForbiddenSubstring(value: string): string {
  return isPathShaped(value) ? redactHostPath(value) : "[redacted]";
}

function isPathShaped(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.includes("/") || value.includes("\\");
}
