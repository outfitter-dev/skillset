import { describe, expect, test } from "bun:test";

import {
  validateSourceMetadata,
  validateWorkspaceConfig,
} from "@skillset/schema";

import {
  isRemoteRepositoryVersion,
  validateRemoteRepositoryRevision,
} from "../remote-repository-reference";
import { validateVersionField } from "../versioning";

const CASES = [
  ["0.0.0", true],
  ["1.2.3", true],
  ["1.0.0-alpha.1+build.7", true],
  ["1.0.0+build.01", true],
  ["1", false],
  ["1.2", false],
  ["01.2.3", false],
  ["1.0.0-01", false],
  ["1.0.0-alpha..1", false],
  [" 1.2.3 ", false],
] as const;

describe("semantic version consumer parity", () => {
  test.each(CASES)("%s acceptance is identical", (version, accepted) => {
    expect(validateSourceMetadata({ version }).ok).toBe(accepted);
    expect(validateWorkspaceConfig({
      marketplaces: {
        test: {
          plugins: [{ plugin: "demo", repo: "github:acme/demo", version }],
        },
      },
    }).ok).toBe(accepted);
    expect(coreVersionAccepted(version)).toBe(accepted);
    expect(isRemoteRepositoryVersion(version)).toBe(accepted);
    expect(remoteRevisionAccepted(version)).toBe(accepted);
  });
});

function coreVersionAccepted(version: string): boolean {
  try {
    validateVersionField({ version }, "test.version");
    return true;
  } catch {
    return false;
  }
}

function remoteRevisionAccepted(version: string): boolean {
  try {
    validateRemoteRepositoryRevision({ kind: "version", version });
    return true;
  } catch {
    return false;
  }
}
