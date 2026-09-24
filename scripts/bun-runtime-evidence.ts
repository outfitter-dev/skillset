import { readFileSync } from "node:fs";

import workspaceManifest from "../package.json";

const supportedRange = workspaceManifest.engines.bun;
const pinnedVersion = readFileSync(
  new URL("../.bun-version", import.meta.url),
  "utf-8"
).trim();

const supportDetails = (observed: string): string =>
  `supported range ${supportedRange} (pin ${pinnedVersion}; observed ${observed})`;

export const assertSupportedBunRuntimeVersion = (observed: string): void => {
  if (!Bun.semver.satisfies(observed, supportedRange)) {
    throw new Error(
      `Bun runtime ${observed} is outside ${supportDetails(observed)}`
    );
  }
};

export const assertSupportedBunEvidenceVersion = (
  label: string,
  recorded: unknown,
  observed: string
): void => {
  assertSupportedBunRuntimeVersion(observed);
  if (
    typeof recorded !== "string" ||
    !Bun.semver.satisfies(recorded, supportedRange)
  ) {
    throw new Error(
      `${label} Bun ${String(recorded)} is outside ${supportDetails(observed)}`
    );
  }
};
