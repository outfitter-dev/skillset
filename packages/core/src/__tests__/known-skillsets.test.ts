import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  knownSkillsetsIndexPath,
  normalizeKnownSkillsetIdentity,
  readKnownSkillsetsIndex,
  recordKnownSkillsetWorkspace,
  resolveKnownSkillsetWorkspace,
  writeKnownSkillsetsIndex,
} from "../known-skillsets";

describe("known Skillsets index", () => {
  test("reads and writes the managed index under the XDG config location", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-index-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);

    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "docs-cli--local-abc123def456",
        identities: ["github:acme/docs-cli"],
        path: workspacePath,
        repository: "https://github.com/acme/docs-cli.git",
      }],
    }, options);

    expect(knownSkillsetsIndexPath(options)).toBe(join(root, "config", "skillset", "skillsets.json"));
    await expect(readKnownSkillsetsIndex(options)).resolves.toEqual({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "docs-cli--local-abc123def456",
        identities: ["github:acme/docs-cli"],
        path: workspacePath,
        repository: "https://github.com/acme/docs-cli.git",
      }],
    });
  });

  test("records a workspace without writing repo-local files", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-record-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    await writeFile(join(workspacePath, "skillset.yaml"), "workspace:\n  cacheKey: docs-cli\n");
    const before = await readdir(workspacePath);
    const canonicalWorkspacePath = await realpath(workspacePath);

    const entry = await recordKnownSkillsetWorkspace(workspacePath, {
      ...options,
      repository: "git@github.com:Acme/docs-cli.git",
    });

    expect(entry).toEqual({
      cacheKey: "docs-cli",
      identities: ["github:acme/docs-cli"],
      path: canonicalWorkspacePath,
      repository: "git@github.com:Acme/docs-cli.git",
    });
    await expect(readdir(workspacePath)).resolves.toEqual(before);
    await expect(readFile(knownSkillsetsIndexPath(options), "utf8")).resolves.toContain("github:acme/docs-cli");
  });

  test("resolves known GitHub identities and skips stale paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-resolve-"));
    const options = xdgOptions(root);
    const livePath = join(root, "live");
    await mkdir(livePath);

    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [
        {
          cacheKey: "stale",
          identities: ["github:acme/docs-cli"],
          path: join(root, "missing"),
        },
        {
          cacheKey: "live",
          identities: ["github:acme/docs-cli"],
          path: livePath,
        },
      ],
    }, options);

    await expect(resolveKnownSkillsetWorkspace("https://github.com/Acme/docs-cli.git", options)).resolves.toEqual({
      cacheKey: "live",
      identities: ["github:acme/docs-cli"],
      path: livePath,
    });
    await expect(resolveKnownSkillsetWorkspace("github:acme/unknown", options)).resolves.toBeUndefined();
  });

  test("normalizes supported repository identity spellings", () => {
    expect(normalizeKnownSkillsetIdentity("github:Acme/docs-cli")).toBe("github:acme/docs-cli");
    expect(normalizeKnownSkillsetIdentity("github.com/Acme/docs-cli.git")).toBe("github:acme/docs-cli");
    expect(normalizeKnownSkillsetIdentity("https://github.com/Acme/docs-cli.git")).toBe("github:acme/docs-cli");
    expect(normalizeKnownSkillsetIdentity("ssh://git@github.com/Acme/docs-cli.git")).toBe("github:acme/docs-cli");
    expect(normalizeKnownSkillsetIdentity("git@github.com:Acme/docs-cli.git")).toBe("github:acme/docs-cli");
  });
});

function xdgOptions(root: string): { env: Record<string, string>; homeDir: string } {
  return {
    env: {
      XDG_CONFIG_HOME: join(root, "config"),
    },
    homeDir: join(root, "home"),
  };
}
