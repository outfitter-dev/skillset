import { STANDARD_PROFILE_IDS } from "@skillset/registry";
import type { StandardProfileId } from "@skillset/registry";

import {
  runStandardsConformance,
  verifyAdoptedStandardsConformance,
} from "./standards/run";

const [command, profileValue, receiptPath] = process.argv.slice(2);

if (!STANDARD_PROFILE_IDS.includes(profileValue as StandardProfileId)) {
  throw new Error(
    `skillset: expected a standard profile: ${STANDARD_PROFILE_IDS.join(", ")}`
  );
}
const profile = profileValue as StandardProfileId;

if (command === "run" && receiptPath === undefined) {
  const result = await runStandardsConformance(profile);
  console.log(
    JSON.stringify(
      {
        artifactCount: result.receipt.artifacts.length,
        path: result.path,
        profile,
        receiptHash: result.receiptHash,
        rendererCommit: result.receipt.renderer.commit,
      },
      null,
      2
    )
  );
} else if (command === "verify-adopted" && receiptPath !== undefined) {
  const result = await verifyAdoptedStandardsConformance(profile, receiptPath);
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error(
    "skillset: usage: standards.ts run <profile> | verify-adopted <profile> <receipt>"
  );
}
