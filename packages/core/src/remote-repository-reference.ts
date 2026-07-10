const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export type RemoteRepositoryRevision =
  | { readonly kind: "default" }
  | { readonly kind: "ref"; readonly ref: string }
  | { readonly kind: "sha"; readonly sha: string }
  | { readonly kind: "version"; readonly version: string };

export interface ParsedRemoteRepositoryReference {
  readonly canonical: string;
  readonly fetchUrl: string;
}

export function parseRemoteRepositoryReference(value: string): ParsedRemoteRepositoryReference {
  const repository = value.trim();
  if (repository.length === 0) throw new Error("skillset: remote repository reference must be non-empty");

  const github = repository.match(/^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  if (github !== null) {
    const owner = github[1];
    const repo = github[2];
    if (owner === undefined || repo === undefined) {
      throw new Error(`skillset: unsupported remote repository reference ${repository}`);
    }
    return {
      canonical: `github:${owner.toLowerCase()}/${repo.toLowerCase()}`,
      fetchUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  if (repository.includes("://")) return parseRepositoryUrl(repository);

  const scp = repository.match(/^([^:@/\s]+)@([^:\s/]+):([^\s]+)$/u);
  if (scp !== null) {
    const user = scp[1];
    const host = scp[2];
    const rawPath = scp[3];
    const path = rawPath?.replace(/^\/+|\.git$/gu, "");
    if (user === undefined || host === undefined || path === undefined || path.length === 0 || path.includes("..")) {
      throw new Error(`skillset: unsupported remote repository reference ${repository}`);
    }
    return {
      canonical: canonicalRemote(host, path, user, "ssh", rawPath?.startsWith("/") === true),
      fetchUrl: repository,
    };
  }

  return parseRepositoryUrl(repository);
}

function parseRepositoryUrl(repository: string): ParsedRemoteRepositoryReference {
  let url: URL;
  try {
    url = new URL(repository);
  } catch {
    throw new Error(`skillset: unsupported remote repository reference ${repository}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "ssh:") {
    throw new Error(`skillset: unsupported remote repository protocol ${url.protocol.replace(/:$/u, "")}`);
  }
  if (url.password.length > 0 || (url.protocol === "https:" && url.username.length > 0)) {
    throw new Error("skillset: remote repository references must not contain credentials");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error("skillset: remote repository references must not contain query or fragment data");
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+|\.git$/gu, "");
  } catch {
    throw new Error(`skillset: unsupported remote repository reference ${repository}`);
  }
  if (url.hostname.length === 0 || path.length === 0 || path.includes("..")) {
    throw new Error(`skillset: unsupported remote repository reference ${repository}`);
  }
  return {
    canonical: canonicalRemote(
      url.host,
      path,
      url.protocol === "ssh:" ? url.username || "git" : undefined,
      url.protocol === "ssh:" ? "ssh" : "https"
    ),
    fetchUrl: repository,
  };
}

export function validateRemoteRepositoryRevision(revision: RemoteRepositoryRevision): void {
  if (revision.kind === "sha" && !FULL_SHA_PATTERN.test(revision.sha)) {
    throw new Error("skillset: remote repository sha must be a full lowercase 40-character commit");
  }
  if (revision.kind === "version" && !SEMVER_PATTERN.test(revision.version)) {
    throw new Error("skillset: remote repository version must be a semantic version");
  }
  if (revision.kind === "ref" && !isSafeRemoteRepositoryRef(revision.ref)) {
    throw new Error(`skillset: unsupported remote repository ref ${revision.ref}`);
  }
}

export function isSafeRemoteRepositoryRef(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !value.endsWith(".") &&
    !value.endsWith("/") &&
    !value.endsWith(".lock");
}

export function isFullRemoteRepositorySha(value: string): boolean {
  return FULL_SHA_PATTERN.test(value);
}

export function isRemoteRepositoryVersion(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

function canonicalRemote(
  host: string,
  path: string,
  user?: string,
  protocol: "https" | "ssh" = "ssh",
  absolutePath = true
): string {
  const normalizedHost = host.toLowerCase();
  const normalizedPath = path.replace(/^\/+|\.git$/gu, "");
  if (normalizedHost === "github.com") {
    const [owner, repo, ...rest] = normalizedPath.split("/");
    if (owner !== undefined && repo !== undefined && rest.length === 0) {
      return `github:${owner.toLowerCase()}/${repo.toLowerCase()}`;
    }
  }
  if (protocol === "https") return `https://${normalizedHost}/${normalizedPath}`;
  return `ssh:${user === undefined ? "" : `${user}@`}${normalizedHost}${absolutePath ? ":/" : ":"}${normalizedPath}`;
}
