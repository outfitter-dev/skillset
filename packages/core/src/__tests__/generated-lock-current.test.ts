import { expect, test } from "bun:test";

import {
  parseCurrentGeneratedLock,
  parseGeneratedLock,
} from "@skillset/core";

import { withLockProvenance } from "../lock-provenance";

test("reads provenance-valid v3 lock identity and logical consumers", () => {
  const lock = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [
      {
        consumers: [
          { phase: "baseline", standardProfile: "agent-skills" },
          { phase: "delta", target: "codex" },
        ],
        fileModes: { "demo/SKILL.md": "0644" },
        files: ["demo/SKILL.md"],
        outputHash: "sha256:output",
        owner: { standardProfile: "agent-skills" },
        renderInputsHash: "sha256:inputs",
        sourceHash: "sha256:source",
        version: "1.2.3",
      },
    ],
    outputRoot: ".agents/skills",
    schemaVersion: 3,
    selectedStandards: ["agent-skills"],
    selectedTargets: ["codex"],
    sourceInventory: {
      hashSchema: "skillset-source-unit-v3",
      units: [
        {
          hash: "sha256:unit",
          id: "skill:demo",
          kind: "standalone-skill",
          sourcePath: ".skillset/skills/demo/SKILL.md",
        },
      ],
    },
    target: "workspace",
  });

  expect(parseCurrentGeneratedLock(lock)).toMatchObject({
    items: [
      {
        consumers: [
          { phase: "baseline", standardProfile: "agent-skills" },
          { phase: "delta", target: "codex" },
        ],
        owner: { standardProfile: "agent-skills" },
        renderInputsHash: "sha256:inputs",
        sourceHash: "sha256:source",
        version: "1.2.3",
      },
    ],
    sourceInventory: {
      hashSchema: "skillset-source-unit-v3",
      units: [{ id: "skill:demo" }],
    },
  });
  expect(() => parseGeneratedLock({ ...lock, selectedTargets: [] })).toThrow(
    "invalid provenanceHash"
  );
});

test.each([1, 2] as const)(
  "treats pre-v3 schema %s as rebuild-only current state",
  (schemaVersion) => {
    expect(() =>
      parseCurrentGeneratedLock({ schemaVersion }, "workspace lock skillset.lock")
    ).toThrow(
      `workspace lock skillset.lock uses pre-v3 schema ${schemaVersion}; this generated state is rebuild-only`
    );
  }
);

test("rejects future schemas and paths outside a current lock root", () => {
  expect(() => parseCurrentGeneratedLock({ schemaVersion: 4 })).toThrow(
    "unsupported schemaVersion 4"
  );

  const escapingRoot = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [],
    outputRoot: "../outside",
    schemaVersion: 3,
    selectedStandards: [],
    selectedTargets: [],
    target: "workspace",
  });
  expect(() => parseCurrentGeneratedLock(escapingRoot)).toThrow(
    "outputRoot must stay inside its output root"
  );

  const escapingFile = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [
      {
        fileModes: { "../outside": "0644" },
        files: ["../outside"],
      },
    ],
    outputRoot: ".agents/skills",
    schemaVersion: 3,
    selectedStandards: [],
    selectedTargets: ["codex"],
    target: "codex",
  });
  expect(() => parseCurrentGeneratedLock(escapingFile)).toThrow(
    "must stay inside its output root"
  );
});

test("rejects invalid current owner and consumer relationships", () => {
  const lock = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [
      {
        consumers: [{ phase: "delta", target: "codex" }],
        fileModes: { "demo/SKILL.md": "0644" },
        files: ["demo/SKILL.md"],
        owner: { target: "claude" },
      },
    ],
    outputRoot: ".agents/skills",
    schemaVersion: 3,
    selectedStandards: [],
    selectedTargets: ["codex"],
    target: "workspace",
  });

  expect(() => parseCurrentGeneratedLock(lock)).toThrow(
    "owner must match a logical consumer"
  );
});
