import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { EmptySourceGraphError, isEmptySourceGraphError } from "@skillset/core/internal/empty-source-graph";
import * as resolver from "@skillset/core/internal/resolver";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { seedReleaseBaselines } from "../adoption";
import { listNewAdaptiveHookAttachmentTargets } from "../new-hook";
import { initSkillset } from "../setup";

const ORIGINAL_MESSAGE = "skillset: no source plugins, skills, rules, project agents, or provider source found under .skillset/";

/** The typed condition with different wording: callers must not depend on the text. */
function reworded(): EmptySourceGraphError {
  const error = new EmptySourceGraphError(".skillset");
  error.message = "skillset: this workspace has nothing to build yet";
  return error;
}

afterEach(() => {
  mock.restore();
});

describe("empty source graph condition (SET-653)", () => {
  test("Core throws the typed condition with the existing message", async () => {
    const root = await workspace();
    const error = await resolver.loadBuildGraph(root).then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmptySourceGraphError);
    expect(error instanceof Error ? error.message : "").toBe(ORIGINAL_MESSAGE);
  });

  test("is recognized by type, not by message", () => {
    expect(isEmptySourceGraphError(reworded())).toBe(true);
    expect(isEmptySourceGraphError(new Error(ORIGINAL_MESSAGE))).toBe(false);
  });

  test("release adoption still skips an empty workspace when the message changes", async () => {
    spyOn(resolver, "loadBuildGraph").mockRejectedValue(reworded());
    expect(await seedReleaseBaselines(await workspace())).toMatchObject({
      entries: [],
      skippedReason: "no source units to adopt",
    });
  });

  test("new-hook target discovery still returns no targets when the message changes", async () => {
    spyOn(resolver, "loadBuildGraph").mockRejectedValue(reworded());
    expect(await listNewAdaptiveHookAttachmentTargets(await workspace())).toEqual([]);
  });

  test("setup still suggests creating source when the message changes", async () => {
    spyOn(resolver, "loadBuildGraph").mockRejectedValue(reworded());
    const root = await createTestFixtureRoot("skillset-empty-graph-setup-");
    const report = await initSkillset({ cwd: root, useGitRoot: false, write: true });
    expect(report.nextSteps[0]).toStartWith("skillset new skill <name>");
  });
});

async function workspace(): Promise<string> {
  const root = await createTestFixtureRoot("skillset-empty-graph-");
  await mkdir(join(root, ".skillset"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: empty\n", "utf8");
  return root;
}
