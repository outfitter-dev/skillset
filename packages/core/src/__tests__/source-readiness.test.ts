import { expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkSkillsetSourceReadiness,
  createOperationalPathContext,
  resolveOperationalPath,
} from "@skillset/core";

const GENERATED_SKILL = ".claude/skills/demo/SKILL.md";

test("source readiness returns deterministic read-only facts without Git", async () => {
  const root = await fixture();
  try {
    const result = await checkSkillsetSourceReadiness(root);

    expect(result.operation).toBe("check");
    expect(result.ok).toBe(false);
    expect(result.writes).toEqual({
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    });
    expect(result.data.checks.graph).toEqual({ checkedFiles: 1, failures: [] });
    expect(result.data.checks.lint).toMatchObject({
      checkedSkills: 1,
      issues: [],
    });
    expect(result.data.checks.managedOutputs).toEqual({
      checkedFiles: 0,
      failures: [],
    });
    expect(result.data.stalePaths).toContain(GENERATED_SKILL);
    expect(result.data.stalePaths).toEqual(
      [...new Set(result.data.stalePaths)].toSorted()
    );
    expect(result.data.remainingPaths).toEqual(result.data.stalePaths);
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    await expect(
      readFile(join(root, GENERATED_SKILL), "utf8")
    ).rejects.toThrow();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("an explicit write rechecks lint errors and refuses output mutation", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, ".skillset/skills/demo/SKILL.md"),
      `---\nname: demo\ndescription: ${"x".repeat(1030)}\n---\n\nBody.\n`
    );

    const result = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });

    expect(result.ok).toBe(false);
    expect(result.data.checks.lint.issues).toContainEqual(
      expect.objectContaining({
        code: "skill-description-length",
        severity: "error",
      })
    );
    expect(result.data.writePerformed).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-output-write-blocked",
        severity: "error",
      })
    );
    await expect(
      readFile(join(root, GENERATED_SKILL), "utf8")
    ).rejects.toThrow();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("read-only isolated readiness keeps output in the XDG mirror", async () => {
  const root = await fixture();
  const xdgCache = join(root, "xdg-cache");
  try {
    const result = await checkSkillsetSourceReadiness(root, {
      isolated: true,
      xdg: { env: { XDG_CACHE_HOME: xdgCache } },
    });

    const mirroredSkill = join(
      ".skillset/cache/latest",
      GENERATED_SKILL
    ).replaceAll("\\", "/");
    expect(result.data.stalePaths).toContain(mirroredSkill);
    expect(result.data.writePerformed).toBe(false);
    expect(result.writes.mode).toBe("read");
    const generatedPath = resolveOperationalPath(
      createOperationalPathContext(root, {
        env: { XDG_CACHE_HOME: xdgCache },
      }),
      mirroredSkill
    );
    await expect(readFile(generatedPath, "utf8")).rejects.toThrow();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a library output write backs up an unmanaged collision", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, ".claude/skills/demo"), { recursive: true });
    await writeFile(join(root, GENERATED_SKILL), "hand-authored\n");

    const result = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });

    expect(result.ok).toBe(true);
    expect(result.data.writePerformed).toBe(true);
    expect(result.data.remainingPaths).toEqual([]);
    expect(result.writes.backupRecords).toContainEqual(
      expect.objectContaining({
        reason: "unmanaged-collision",
        targetPath: GENERATED_SKILL,
      })
    );
    expect(await readFile(join(root, GENERATED_SKILL), "utf8")).toContain(
      "Demo body."
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("an explicit output write rebuilds stale paths and rediffs", async () => {
  const root = await fixture();
  try {
    const result = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });

    expect(result.ok).toBe(true);
    expect(result.data.stalePaths).toContain(GENERATED_SKILL);
    expect(result.data.fixedPaths).toEqual(result.data.stalePaths);
    expect(result.data.remainingPaths).toEqual([]);
    expect(result.data.drift).toEqual({
      added: [],
      changed: [],
      missing: [],
      removed: [],
    });
    expect(result.data.writePerformed).toBe(true);
    expect(result.writes.mode).toBe("write");
    expect(await readFile(join(root, GENERATED_SKILL), "utf8")).toContain(
      "Demo body."
    );

    const current = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });
    expect(current.ok).toBe(true);
    expect(current.data.writePerformed).toBe(false);
    expect(current.writes.mode).toBe("read");
    expect(current.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-output-current",
        severity: "info",
      })
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a rebuild failure records the invocation without claiming unknown writes", async () => {
  const root = await fixture();
  const blockedDirectory = join(root, ".claude/skills/zeta");
  try {
    await mkdir(join(root, ".skillset/skills/zeta"), { recursive: true });
    await writeFile(
      join(root, ".skillset/skills/zeta/SKILL.md"),
      "---\nname: zeta\ndescription: Blocked write fixture.\n---\n\nZeta body.\n"
    );
    await mkdir(blockedDirectory, { recursive: true });
    await chmod(blockedDirectory, 0o555);

    const result = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });

    expect(result.ok).toBe(false);
    expect(result.data.writePerformed).toBe(true);
    expect(result.writes).toEqual({
      deletedPaths: [],
      mode: "write",
      paths: [],
      writtenPaths: [],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-failed",
        severity: "error",
      })
    );
    expect(result.data.fixedPaths).toContain(GENERATED_SKILL);
    expect(result.data.remainingPaths).not.toContain(GENERATED_SKILL);
    expect(result.data.remainingPaths).toContain(
      ".claude/skills/zeta/SKILL.md"
    );
    expect(await readFile(join(root, GENERATED_SKILL), "utf8")).toContain(
      "Demo body."
    );
    await expect(
      readFile(join(blockedDirectory, "SKILL.md"), "utf8")
    ).rejects.toThrow();

    const actual = await checkSkillsetSourceReadiness(root);
    expect(result.data.drift).toEqual(actual.data.drift);
    expect(result.data.remainingPaths).toEqual(actual.data.stalePaths);
  } finally {
    await chmod(blockedDirectory, 0o755).catch(() => undefined);
    await rm(root, { force: true, recursive: true });
  }
});

test("a fresh neutral safety check refuses managed target edits", async () => {
  const root = await fixture();
  try {
    await checkSkillsetSourceReadiness(root, { write: "outputs" });
    const generatedPath = join(root, GENERATED_SKILL);
    await writeFile(
      generatedPath,
      `${await readFile(generatedPath, "utf8")}\nhand edit\n`
    );

    const result = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });

    expect(result.ok).toBe(false);
    expect(result.data.checks.managedOutputs.failures).toContain(
      GENERATED_SKILL
    );
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-output-write-blocked",
        severity: "error",
      })
    );
    expect(await readFile(generatedPath, "utf8")).toContain("hand edit");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a scoped check ignores managed edits outside its drift set", async () => {
  const root = await fixture();
  try {
    await checkSkillsetSourceReadiness(root, { write: "outputs" });
    const generatedPath = join(root, GENERATED_SKILL);
    await writeFile(
      generatedPath,
      `${await readFile(generatedPath, "utf8")}\nhand edit\n`
    );

    const result = await checkSkillsetSourceReadiness(root, {
      scopes: ["project"],
      write: "outputs",
    });

    expect(result.ok).toBe(true);
    expect(result.data.stalePaths).toEqual([]);
    expect(result.data.checks.managedOutputs.failures).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-output-current",
        severity: "info",
      })
    );
    expect(await readFile(generatedPath, "utf8")).toContain("hand edit");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("graph failures are returned as structured operation diagnostics", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, "skillset.yaml"),
      "skillset:\n  name: broken\ncompile:\n  build: bogus\n"
    );

    const result = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });

    expect(result.ok).toBe(false);
    expect(result.data.writePerformed).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-failed",
        severity: "error",
      })
    );
    expect(result.writes.mode).toBe("read");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("diff failures preserve completed lint facts and structured diagnostics", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, ".skillset/skills/demo/SKILL.md"),
      "---\nname: demo\ndescription: Demo readiness fixture.\n---\n\nSee [Guide](shared:references/guide.md).\n"
    );

    const result = await checkSkillsetSourceReadiness(root);

    expect(result.ok).toBe(false);
    expect(result.data.checks.graph).toEqual({
      checkedFiles: 1,
      failures: [],
    });
    expect(result.data.checks.lint.issues).toContainEqual(
      expect.objectContaining({
        code: "resource-undeclared-link",
        severity: "error",
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "resource-undeclared-link",
        severity: "error",
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-failed",
        severity: "error",
      })
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-source-readiness-"));
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: readiness-fixture\nclaude: true\ncodex: false\ncursor: false\n"
  );
  await writeFile(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo readiness fixture.\n---\n\nDemo body.\n"
  );
  return root;
}
