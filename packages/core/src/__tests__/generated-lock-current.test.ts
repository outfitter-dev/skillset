import { expect, test } from "bun:test";

import {
  parseCurrentGeneratedLock,
  parseGeneratedLock,
} from "@skillset/core";

import { collectLockItems } from "../authoring";
import { withLockProvenance } from "../lock-provenance";

const textEncoder = new TextEncoder();
const AGENT_SKILLS_RECEIPT_HASH = `sha256:${"a".repeat(64)}`;

test("reads provenance-valid v4 lock identity, role, and logical consumers", () => {
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
        origin: "local",
        outputHash: "sha256:output",
        owner: { standardProfile: "agent-skills" },
        role: "standard",
        renderInputsHash: "sha256:inputs",
        sourceHash: "sha256:source",
        sourceOrigin: {
          path: ".skillset/skills/demo",
          ref: "main",
          repo: "outfitter-dev/example",
        },
        sourcePointer: ".skillset/skills/demo/SKILL.md",
        version: "1.2.3",
      },
    ],
    outputRoot: ".agents/skills",
    schemaVersion: 4,
    standardProfileEvidence: {
      "agent-skills": AGENT_SKILLS_RECEIPT_HASH,
    },
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
        role: "standard",
        origin: "local",
        renderInputsHash: "sha256:inputs",
        sourceHash: "sha256:source",
        sourceOrigin: {
          path: ".skillset/skills/demo",
          ref: "main",
          repo: "outfitter-dev/example",
        },
        sourcePointer: ".skillset/skills/demo/SKILL.md",
        version: "1.2.3",
      },
    ],
    sourceInventory: {
      hashSchema: "skillset-source-unit-v3",
      units: [{ id: "skill:demo" }],
    },
    standardProfileEvidence: {
      "agent-skills": AGENT_SKILLS_RECEIPT_HASH,
    },
  });
  expect(() => parseGeneratedLock({ ...lock, selectedTargets: [] })).toThrow(
    "invalid provenanceHash"
  );
});

test("parses settings-entry field ownership and requires its selector", () => {
  const lock = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [{
      consumers: [{ phase: "delta", target: "claude" }],
      fileModes: { ".claude/settings.local.json": "0644" },
      files: [".claude/settings.local.json"],
      kind: "settings-entry",
      name: "session-start:claude",
      owner: { target: "claude" },
      ownedEntries: [{
        commandHash: "sha256:command",
        file: ".claude/settings.local.json",
        keyPath: "hooks.SessionStart[*].hooks[*].command",
      }],
      outputHash: "sha256:output",
      outputPath: ".claude/settings.local.json",
      role: "bundle",
      sourceHash: "sha256:source",
      sourcePath: "skillset.yaml",
    }],
    outputRoot: ".",
    schemaVersion: 4,
    standardProfileEvidence: {},
    selectedStandards: [],
    selectedTargets: ["claude"],
    target: "workspace",
  });
  expect(parseCurrentGeneratedLock(lock).items[0]?.ownedEntries).toEqual([{
    commandHash: "sha256:command",
    file: ".claude/settings.local.json",
    keyPath: "hooks.SessionStart[*].hooks[*].command",
  }]);
  expect(() => parseCurrentGeneratedLock(withLockProvenance({
    ...lock,
    items: [{
      ...((lock.items as unknown[])[0] as Record<string, unknown>),
      ownedEntries: undefined,
    }],
  }))).toThrow("settings-entry items require ownedEntries");
});

test("keeps sparse lock items matchable through their files", () => {
  const lock = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [
      {
        consumers: [{ phase: "delta", target: "codex" }],
        fileModes: { "demo/SKILL.md": "0644" },
        files: ["demo/SKILL.md"],
        owner: { target: "codex" },
        role: "bundle",
      },
    ],
    outputRoot: ".agents/skills",
    schemaVersion: 4,
    standardProfileEvidence: {},
    selectedStandards: [],
    selectedTargets: ["codex"],
    target: "codex",
  });

  const [match] = collectLockItems([
    {
      content: textEncoder.encode(`${JSON.stringify(lock)}\n`),
      mode: 0o644,
      path: ".agents/skills/skillset.lock",
    },
  ]);
  expect(match).toMatchObject({
    entry: {
      consumers: [{ phase: "delta", target: "codex" }],
      files: [".agents/skills/demo/SKILL.md"],
      outputPath: "",
      role: "bundle",
      sourcePath: "",
    },
    files: ["demo/SKILL.md"],
    outputPath: "",
    sourcePath: "",
  });
});

test.each([1, 2, 3] as const)(
  "treats pre-v4 schema %s as rebuild-only current state",
  (schemaVersion) => {
    expect(() =>
      parseCurrentGeneratedLock({ schemaVersion }, "workspace lock skillset.lock")
    ).toThrow(
      `workspace lock skillset.lock uses pre-v4 schema ${schemaVersion}; this generated state is rebuild-only`
    );
  }
);

test("rejects future schemas and paths outside a current lock root", () => {
  expect(() => parseCurrentGeneratedLock({ schemaVersion: 5 })).toThrow(
    "unsupported schemaVersion 5"
  );

  const escapingRoot = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [],
    outputRoot: "../outside",
    schemaVersion: 4,
    standardProfileEvidence: {},
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
        role: "bundle",
      },
    ],
    outputRoot: ".agents/skills",
    schemaVersion: 4,
    standardProfileEvidence: {},
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
        role: "bundle",
      },
    ],
    outputRoot: ".agents/skills",
    schemaVersion: 4,
    standardProfileEvidence: {},
    selectedStandards: [],
    selectedTargets: ["codex"],
    target: "workspace",
  });

  expect(() => parseCurrentGeneratedLock(lock)).toThrow(
    "owner must match a logical consumer"
  );
});

test("requires exact standard profile receipt evidence in current locks", () => {
  const base = {
    generatedBy: "skillset@0.1.0",
    items: [],
    outputRoot: ".",
    schemaVersion: 4,
    selectedStandards: ["agent-skills"],
    selectedTargets: [],
    target: "workspace",
  };

  expect(() => parseCurrentGeneratedLock(withLockProvenance(base))).toThrow(
    "current standardProfileEvidence must be an object"
  );
  expect(
    parseCurrentGeneratedLock(
      withLockProvenance({
        ...base,
        selectedStandards: [],
      })
    ).standardProfileEvidence
  ).toEqual({});
  expect(() =>
    parseCurrentGeneratedLock(
      withLockProvenance({ ...base, standardProfileEvidence: {} })
    )
  ).toThrow(
    "standardProfileEvidence must contain exactly the selectedStandards profiles"
  );
  expect(() =>
    parseCurrentGeneratedLock(
      withLockProvenance({
        ...base,
        standardProfileEvidence: { "agent-skills": "sha256:invalid" },
      })
    )
  ).toThrow(
    "standardProfileEvidence.agent-skills must be a sha256 content hash"
  );
  expect(() =>
    parseCurrentGeneratedLock(
      withLockProvenance({
        ...base,
        standardProfileEvidence: {
          "agent-skills": AGENT_SKILLS_RECEIPT_HASH,
          "agent-plugins-1.0": `sha256:${"b".repeat(64)}`,
        },
      })
    )
  ).toThrow(
    "standardProfileEvidence must contain exactly the selectedStandards profiles"
  );
  expect(() =>
    parseCurrentGeneratedLock(
      withLockProvenance({
        ...base,
        standardProfileEvidence: {
          "future-standard": `sha256:${"b".repeat(64)}`,
        },
      })
    )
  ).toThrow("standardProfile must be a standard profile id");
});

test("requires a supported role with matching current ownership", () => {
  const current = (role?: string, projectUseOwner = false) =>
    withLockProvenance({
      generatedBy: "skillset@0.1.0",
      items: [
        {
          fileModes: { "demo/SKILL.md": "0644" },
          files: ["demo/SKILL.md"],
          ...(projectUseOwner
            ? {
                consumers: [{ phase: "delta", target: "codex" }],
                owner: { target: "codex" },
              }
            : {}),
          ...(role === undefined ? {} : { role }),
        },
      ],
      outputRoot: ".agents/skills",
      schemaVersion: 4,
      standardProfileEvidence: {},
      selectedStandards: [],
      selectedTargets: [],
      target: "workspace",
    });

  expect(() => parseCurrentGeneratedLock(current())).toThrow(
    "role must be bundle, project-use, or standard"
  );
  expect(() => parseCurrentGeneratedLock(current("legacy"))).toThrow(
    "role must be bundle, project-use, or standard"
  );
  expect(() => parseCurrentGeneratedLock(current("standard"))).toThrow(
    "standard role requires a standardProfile owner"
  );
  expect(() => parseCurrentGeneratedLock(current("project-use"))).toThrow(
    "project-use role requires a target owner"
  );
  expect(
    parseCurrentGeneratedLock(current("project-use", true)).items[0]?.role
  ).toBe("project-use");
});

test("parses project-draft provenance fields in current v4 locks", () => {
  const item = {
    consumers: [{ phase: "delta" as const, target: "codex" as const }],
    draftOrigin: "_drafts",
    effectiveName: "draft-demo",
    fileModes: { "draft-demo/SKILL.md": "0644" },
    files: ["draft-demo/SKILL.md"],
    owner: { target: "codex" as const },
    role: "project-use",
    selectionRule:
      "plugins.internal_use.drafts.demo: omitted (side-by-side)",
    shippedSibling: "plugin.demo.skill:demo",
    sourceUnit: "plugin.demo.skill:demo",
  };
  const lock = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [item],
    outputRoot: ".agents/skills",
    schemaVersion: 4,
    standardProfileEvidence: {},
    selectedStandards: [],
    selectedTargets: ["codex"],
    target: "codex",
  });

  expect(parseCurrentGeneratedLock(lock).items[0]).toMatchObject({
    draftOrigin: "_drafts",
    effectiveName: "draft-demo",
    owner: { target: "codex" },
    role: "project-use",
    selectionRule:
      "plugins.internal_use.drafts.demo: omitted (side-by-side)",
    shippedSibling: "plugin.demo.skill:demo",
    sourceUnit: "plugin.demo.skill:demo",
  });
  expect(() =>
    parseCurrentGeneratedLock(
      withLockProvenance({
        ...lock,
        items: [{ ...item, draftOrigin: "other" }],
      })
    )
  ).toThrow("draftOrigin must be _drafts, config, or status");
  expect(
    parseCurrentGeneratedLock(
      withLockProvenance({
        ...lock,
        items: [{ ...item, draftPolicy: "override" }],
      })
    ).items[0]
  ).toMatchObject({ draftPolicy: "override" });
  expect(() =>
    parseCurrentGeneratedLock(
      withLockProvenance({
        ...lock,
        items: [{ ...item, draftPolicy: "replace" }],
      })
    )
  ).toThrow("draftPolicy must be only or override");
});
