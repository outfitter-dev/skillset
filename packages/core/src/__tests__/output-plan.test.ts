/* eslint-disable func-style, no-use-before-define -- Fixture builders follow the scenarios they support. */

import { describe, expect, test } from "bun:test";

import {
  mapPlannedOutputPaths,
  planRenderedFiles,
  stalePlannedOutputPaths,
} from "../output-plan";
import type { LogicalRenderedFile } from "../output-plan";

const encoder = new TextEncoder();

describe("physical output planning", () => {
  test("coalesces a standard baseline and provider delta into one standard-owned write", () => {
    const planned = planRenderedFiles([
      providerFile("AGENTS.md", "rules:root", "codex", "instructions\n"),
      standardFile(
        "AGENTS.md",
        "rules:root",
        "agent-instructions",
        "instructions\n"
      ),
    ]);

    expect(planned).toHaveLength(1);
    expect(planned[0]?.outputPlan).toEqual({
      consumers: [
        {
          phase: "baseline",
          standardProfile: "agent-instructions",
        },
        { phase: "delta", target: "codex" },
      ],
      owner: {
        standardProfile: "agent-instructions",
      },
      ownership: "managed",
      sourceUnit: "rules:root",
    });
  });

  test("assigns an unshared path to its sole provider consumer", () => {
    const [planned] = planRenderedFiles([
      providerFile("AGENTS.md", "rules:root", "codex", "instructions\n"),
    ]);

    expect(planned?.outputPlan).toEqual({
      consumers: [{ phase: "delta", target: "codex" }],
      owner: { target: "codex" },
      ownership: "managed",
      sourceUnit: "rules:root",
    });
  });

  test.each([
    {
      change: { content: encoder.encode("different\n") },
      expected: "requires incompatible bytes",
      label: "bytes",
    },
    {
      change: { mode: 0o755 as const },
      expected: "requires incompatible modes",
      label: "mode",
    },
    {
      change: {
        outputProjection: {
          consumer: { phase: "delta", target: "codex" } as const,
          ownership: "provider-native" as const,
          sourceUnit: "rules:root",
        },
      },
      expected: "requires incompatible ownership",
      label: "ownership",
    },
  ])("rejects incompatible $label before writing", ({ change, expected }) => {
    const provider = {
      ...providerFile("AGENTS.md", "rules:root", "codex", "instructions\n"),
      ...change,
    };

    expect(() =>
      planRenderedFiles([
        standardFile(
          "AGENTS.md",
          "rules:root",
          "agent-instructions",
          "instructions\n"
        ),
        provider,
      ])
    ).toThrow(expected);
  });

  test("rejects equal output from different source identities", () => {
    expect(() =>
      planRenderedFiles([
        standardFile(
          ".agents/skills/review/SKILL.md",
          "skill:review",
          "agent-skills",
          "review\n"
        ),
        providerFile(
          ".agents/skills/review/SKILL.md",
          "plugin:demo.skill:review",
          "codex",
          "review\n"
        ),
      ])
    ).toThrow("conflicting source identities");
  });

  test("rejects provider-only sharing because no sole physical owner exists", () => {
    expect(() =>
      planRenderedFiles([
        providerFile("shared/SKILL.md", "skill:shared", "claude", "shared\n"),
        providerFile("shared/SKILL.md", "skill:shared", "codex", "shared\n"),
      ])
    ).toThrow("has multiple provider consumers without a standard owner");
  });

  test("keeps a path while any logical consumer remains and deletes it after the last one", () => {
    const previous = planRenderedFiles([
      standardFile(
        "AGENTS.md",
        "rules:root",
        "agent-instructions",
        "instructions\n"
      ),
      providerFile("AGENTS.md", "rules:root", "codex", "instructions\n"),
    ]);
    const providerOnly = planRenderedFiles([
      providerFile("AGENTS.md", "rules:root", "codex", "instructions\n"),
    ]);

    expect(
      stalePlannedOutputPaths(
        new Set(previous.map((file) => file.path)),
        providerOnly
      )
    ).toEqual([]);
    expect(
      stalePlannedOutputPaths(new Set(previous.map((file) => file.path)), [])
    ).toEqual(["AGENTS.md"]);
  });

  test("preserves one physical plan through scope selection and isolated relocation", () => {
    const planned = planRenderedFiles([
      providerFile("AGENTS.md", "rules:root", "codex", "instructions\n"),
      standardFile(
        "AGENTS.md",
        "rules:root",
        "agent-instructions",
        "instructions\n"
      ),
      standardFile(
        ".agents/skills/review/SKILL.md",
        "skill:review",
        "agent-skills",
        "review\n"
      ),
    ]);
    const projectScope = planned.filter((file) => file.path === "AGENTS.md");
    const isolated = mapPlannedOutputPaths(
      projectScope,
      (path) => `.skillset/cache/latest/${path}`
    );

    expect(isolated).toHaveLength(1);
    expect(isolated[0]?.path).toBe(".skillset/cache/latest/AGENTS.md");
    expect(isolated[0]?.outputPlan).toEqual(projectScope[0]?.outputPlan);
  });

  test("produces deterministic plans across clean roots and input order", () => {
    const planAt = (root: string, reverse: boolean) => {
      const inputs = [
        standardFile(
          "AGENTS.md",
          "rules:root",
          "agent-instructions",
          "instructions\n",
          root
        ),
        providerFile(
          "AGENTS.md",
          "rules:root",
          "codex",
          "instructions\n",
          root
        ),
      ];
      return planRenderedFiles(reverse ? inputs.toReversed() : inputs).map(
        (file) => ({
          content: new TextDecoder().decode(file.content),
          mode: file.mode,
          outputPlan: file.outputPlan,
          path: file.path,
        })
      );
    };

    expect(planAt("/tmp/skillset-left", false)).toEqual(
      planAt("/tmp/skillset-right", true)
    );
  });
});

function standardFile(
  path: string,
  sourceUnit: string,
  standardProfile: "agent-instructions" | "agent-skills",
  content: string,
  root = "/workspace"
): LogicalRenderedFile {
  return {
    content: encoder.encode(content),
    mode: 0o644,
    outputProjection: {
      consumer: { phase: "baseline", standardProfile },
      ownership: "managed",
      sourceUnit,
    },
    path,
    sourcePath: `${root}/.skillset/source.md`,
  };
}

function providerFile(
  path: string,
  sourceUnit: string,
  target: "claude" | "codex",
  content: string,
  root = "/workspace"
): LogicalRenderedFile {
  return {
    content: encoder.encode(content),
    mode: 0o644,
    outputProjection: {
      consumer: { phase: "delta", target },
      ownership: "managed",
      sourceUnit,
    },
    path,
    sourcePath: `${root}/.skillset/source.md`,
  };
}
