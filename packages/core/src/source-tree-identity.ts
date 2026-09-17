/* eslint-disable no-await-in-loop -- Source identities must be folded in deterministic path order. */

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import nodePath from "node:path";

import { normalizeGeneratedFileMode } from "./generated-file-mode";
import { compareStrings } from "./path";

export const collectSourceFiles = async (
  root: string
): Promise<readonly string[]> => {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) =>
    compareStrings(left.name, right.name)
  )) {
    const path = nodePath.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`unsupported source entry in draft lifecycle: ${path}`);
    }
    files.push(path);
  }
  return files;
};

export const hashSkillDirectory = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  hash.update("skillset-draft-fork-v1\0");
  const files = await collectSourceFiles(path);
  for (const file of files) {
    const filePath = nodePath.relative(path, file).replaceAll("\\", "/");
    const stats = await lstat(file);
    hash.update(filePath);
    hash.update("\0");
    hash.update(normalizeGeneratedFileMode(stats.mode).toString(8));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
};
