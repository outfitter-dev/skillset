import { createHash } from "node:crypto";
import { relative } from "node:path";

import { compareStrings } from "./path";
import { normalizeManagedRelativePath } from "./render-support";
import type { RenderedFile } from "./types";

export function hashRenderedFiles(outputRoot: string, files: readonly RenderedFile[]): string {
  const hash = createHash("sha256");
  hash.update("skillset-output-v2\0");
  for (const file of [...files].sort((left, right) => compareStrings(left.path, right.path))) {
    hash.update(normalizeManagedRelativePath(relative(outputRoot, file.path)));
    hash.update("\0");
    hash.update(file.mode.toString(8).padStart(4, "0"));
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
