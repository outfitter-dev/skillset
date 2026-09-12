import { expect, test } from "bun:test";

import { withLockProvenance } from "../lock-provenance";
import { collectActivationProofLockItems } from "../runtime-readiness";
import type { RenderedFile } from "../types";

const renderedLock = (value: unknown): RenderedFile => ({
  content: new TextEncoder().encode(JSON.stringify(value)),
  mode: 0o644,
  path: "skillset.lock",
});

test("activation proof derives identity only from validated current lock facts", () => {
  const lock = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [
      {
        fileModes: { "plugins/demo/plugin.json": "0644" },
        files: ["plugins/demo/plugin.json"],
        outputHash: "sha256:output",
        renderInputsHash: "sha256:inputs",
        sourceHash: "sha256:source",
      },
    ],
    outputRoot: ".",
    schemaVersion: 3,
    selectedStandards: [],
    selectedTargets: ["codex"],
    target: "workspace",
  });

  expect(collectActivationProofLockItems([renderedLock(lock)])).toEqual([
    {
      outputHash: "sha256:output",
      outputPaths: ["plugins/demo/plugin.json"],
      renderInputsHash: "sha256:inputs",
      sourceHash: "sha256:source",
    },
  ]);
  expect(() =>
    collectActivationProofLockItems([
      renderedLock({ ...lock, selectedTargets: [] }),
    ])
  ).toThrow("invalid provenanceHash");
});

test("activation proof does not derive identity from rebuild-only state", () => {
  expect(() =>
    collectActivationProofLockItems([
      renderedLock({ schemaVersion: 2 }),
    ])
  ).toThrow("uses pre-v3 schema 2; this generated state is rebuild-only");
});
