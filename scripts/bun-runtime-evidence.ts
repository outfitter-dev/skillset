import { readFileSync } from "node:fs";

import workspaceManifest from "../package.json";
import {
  isStrictBunVersion,
  satisfiesSupportedBunRange,
  supportedBunRangeProblem,
} from "./bootstrap/bun";

const supportedRange = workspaceManifest.engines.bun;
const rangeProblem = supportedBunRangeProblem(supportedRange);
if (rangeProblem !== undefined) {
  throw new Error(`package.json engines.bun ${rangeProblem}`);
}
const pinnedVersion = readFileSync(
  new URL("../.bun-version", import.meta.url),
  "utf-8"
).trim();

const supportDetails = (observed: string): string =>
  `supported range ${supportedRange} (pin ${pinnedVersion}; observed ${observed})`;

const malformedVersion = (subject: string, value: unknown): Error =>
  new Error(
    `${subject} ${JSON.stringify(value)} is not a MAJOR.MINOR.PATCH[-prerelease] version`
  );

export const assertSupportedBunRuntimeVersion = (observed: string): void => {
  if (!isStrictBunVersion(observed)) {
    throw malformedVersion("Bun runtime", observed);
  }
  if (!satisfiesSupportedBunRange(observed, supportedRange)) {
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
  if (typeof recorded === "string" && !isStrictBunVersion(recorded)) {
    throw malformedVersion(`${label} Bun`, recorded);
  }
  if (
    typeof recorded !== "string" ||
    !satisfiesSupportedBunRange(recorded, supportedRange)
  ) {
    throw new Error(
      `${label} Bun ${String(recorded)} is outside ${supportDetails(observed)}`
    );
  }
};
