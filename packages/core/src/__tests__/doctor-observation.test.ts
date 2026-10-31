import { expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { doctorSkillset, observeDoctorSkillset } from "../authoring";
import { buildSkillsetResult } from "../build";

async function fixture(): Promise<string> {
  const root = await createTestFixtureRoot("doctor-observation-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n");
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n\nBody.\n");
  return root;
}

test("observation preserves the existing public doctor projection", async () => {
  const root = await fixture();
  const observed = await observeDoctorSkillset(root);
  expect(observed.failure).toBeUndefined();
  expect(observed.report).toEqual(await doctorSkillset(root));
  expect(observed.report.ok).toBe(false);
  expect(observed.report.outputState.state).toBe("no-output-baseline");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const current = await observeDoctorSkillset(root);
  expect(current.failure).toBeUndefined();
  expect(current.report.ok).toBe(true);
});

for (const phase of ["graph", "output"] as const) {
  test(`observation retains exact ${phase} failure without leaking it in doctor`, async () => {
    const root = await fixture();
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const modulePath = phase === "graph" ? "resolver" : "build";
    const functionName = phase === "graph" ? "loadBuildGraph" : "diffSkillsetResult";
    const child = Bun.spawnSync([process.execPath, "--eval", `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      const original = await import("./packages/core/src/${modulePath}.ts");
      let failure;
      mock.module("./packages/core/src/${modulePath}.ts", () => ({ ...original,
        [${JSON.stringify(functionName)}]: async () => { throw failure; },
      }));
      const { doctorSkillset, observeDoctorSkillset } = await import("./packages/core/src/authoring.ts");
      for (const value of [new TypeError("internal"), Object.assign(new Error("unreadable"), { code: "EACCES" }), undefined]) {
        failure = value;
        const observation = await observeDoctorSkillset(${JSON.stringify(root)});
        assert.equal(observation.failure.phase, ${JSON.stringify(phase)});
        assert.equal(observation.failure.error, value);
        assert.equal(observation.report.ok, false);
        const report = await doctorSkillset(${JSON.stringify(root)});
        assert.deepEqual(report, observation.report);
        assert.equal(Object.hasOwn(report, "failure"), false);
      }
    `], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
    expect(new TextDecoder().decode(child.stderr)).toBe("");
    expect(child.exitCode).toBe(0);
  });
}


test("public doctor keeps an early baseline witness when a later output is unreadable", async () => {
  const root = await fixture();
  await Bun.write(join(root, ".skillset/rules/root.md"), "# Root guidance\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const child = Bun.spawnSync([process.execPath, "--eval", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    const fs = await import("node:fs/promises");
    const readFile = fs.readFile;
    mock.module("node:fs/promises", () => ({ ...fs, readFile: async (path, ...args) => {
      if (path === ${JSON.stringify(join(root, ".agents/skills/skillset.lock"))}) throw Object.assign(new Error("unreadable"), { code: "EACCES" });
      return readFile(path, ...args);
    }}));
    const resolver = await import("./packages/core/src/resolver.ts");
    mock.module("./packages/core/src/resolver.ts", () => ({ ...resolver, loadBuildGraph: async () => { throw new Error("graph unavailable"); } }));
    const { doctorSkillset } = await import("./packages/core/src/authoring.ts");
    const report = await doctorSkillset(${JSON.stringify(root)});
    assert.equal(report.outputState.hasBaseline, true);
    assert.equal(report.buildError, "graph unavailable");
  `], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  expect(new TextDecoder().decode(child.stderr)).toBe("");
  expect(child.exitCode).toBe(0);
});
