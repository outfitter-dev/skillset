import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { ProjectIdStrategy } from "@skillset/types";

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function findGitRoot(startPath: string): string {
  let current = realpathSync(startPath);
  let prev = "";

  while (current !== prev) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    prev = current;
    current = dirname(current);
  }

  return realpathSync(startPath);
}

export function getGitRemoteUrl(repoRoot: string): string | undefined {
  try {
    const output = execFileSync("git", [
      "config",
      "--get",
      "remote.origin.url",
    ], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const value = output.toString().trim();
    return value.length ? value : undefined;
  } catch {
    return undefined;
  }
}

export function getProjectId(
  projectPath: string,
  strategy: ProjectIdStrategy = "path"
): string {
  const repoRoot = findGitRoot(projectPath);
  const realPath = realpathSync(repoRoot);

  if (strategy === "remote") {
    const remoteUrl = getGitRemoteUrl(realPath);
    if (remoteUrl) {
      return hashString(remoteUrl);
    }
  }

  return hashString(realPath);
}
