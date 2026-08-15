import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  doctorSkillset,
  resolveOperationalPath,
} from "@skillset/core";
import { checkSkillsetSourceReadinessWithAuthority } from "@skillset/core/internal/source-readiness";

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

test("a library output write blocks an unmanaged collision", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, ".claude/skills/demo"), { recursive: true });
    await writeFile(join(root, GENERATED_SKILL), "hand-authored\n");

    const result = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });

    expect(result.ok).toBe(false);
    expect(result.data.writePerformed).toBe(false);
    expect(result.data.remainingPaths).toContain(GENERATED_SKILL);
    expect(result.writes.paths).toEqual([]);
    expect(await readFile(join(root, GENERATED_SKILL), "utf8")).toBe("hand-authored\n");
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
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

test("a failed rebuild rolls back writes completed before the failure", async () => {
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
    expect(result.data.writePerformed).toBe(false);
    expect(result.writes.mode).toBe("read");
    expect(result.writes.paths).toEqual([]);
    expect(result.writes.writtenPaths).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-failed",
        severity: "error",
      })
    );
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.remainingPaths).toContain(GENERATED_SKILL);
    expect(result.data.remainingPaths).toContain(
      ".claude/skills/zeta/SKILL.md"
    );
    await expect(readFile(join(root, GENERATED_SKILL), "utf8")).rejects.toThrow();
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

test("a fresh neutral safety check refuses newly detected lock provenance edits", async () => {
  const root = await fixture();
  try {
    await checkSkillsetSourceReadiness(root, { write: "outputs" });
    const lockPath = join(root, ".claude/skills/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      generatedBy: string;
    };
    lock.generatedBy = "skillset@9.9.9";
    const edited = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(lockPath, edited, "utf8");

    const result = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });

    expect(result.ok).toBe(false);
    expect(result.data.checks.managedOutputs.failures).toContain(
      ".claude/skills/skillset.lock"
    );
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-readiness-output-write-blocked",
        severity: "error",
      })
    );
    expect(await readFile(lockPath, "utf8")).toBe(edited);
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(
      false
    );

    const requestedRepair = await checkSkillsetSourceReadinessWithAuthority(
      root,
      { write: "outputs" },
      [".claude/skills/skillset.lock"]
    );
    expect(requestedRepair.ok).toBe(false);
    expect(requestedRepair.data.fixedPaths).toEqual([]);
    expect(requestedRepair.data.writePerformed).toBe(false);
    expect(await readFile(lockPath, "utf8")).toBe(edited);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed lock repair approval cannot authorize a target payload edit", async () => {
  const root = await fixture();
  try {
    await checkSkillsetSourceReadiness(root, { write: "outputs" });
    const generatedPath = join(root, GENERATED_SKILL);
    const edited = `${await readFile(generatedPath, "utf8")}\nhand edit\n`;
    await writeFile(generatedPath, edited, "utf8");

    const result = await checkSkillsetSourceReadinessWithAuthority(
      root,
      { write: "outputs" },
      [GENERATED_SKILL]
    );

    expect(result.ok).toBe(false);
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    expect(result.data.checks.managedOutputs.failures).toContain(
      GENERATED_SKILL
    );
    expect(await readFile(generatedPath, "utf8")).toBe(edited);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed lock repair is revalidated at the write boundary", async () => {
  const root = await fixture();
  try {
    await checkSkillsetSourceReadiness(root, { write: "outputs" });
    const relativeLockPath = ".claude/skills/skillset.lock";
    const lockPath = join(root, relativeLockPath);
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      generatedBy: string;
      items: Array<{ sourceHash?: string }>;
    };
    lock.items[0]!.sourceHash = `sha256:${"0".repeat(64)}`;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const approvedPaths = new Proxy([relativeLockPath], {
      get(target, property, receiver) {
        if (property !== "filter") return Reflect.get(target, property, receiver);
        return (...args: Parameters<Array<string>["filter"]>) => {
          const result = Array.prototype.filter.apply(target, args);
          const changed = JSON.parse(readFileSync(lockPath, "utf8")) as {
            generatedBy: string;
          };
          changed.generatedBy = "skillset@9.9.9";
          writeFileSync(lockPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
          return result;
        };
      },
    });

    const direct = await checkSkillsetSourceReadiness(root, {
      write: "outputs",
    });
    expect(direct.ok).toBe(false);
    expect(await readFile(lockPath, "utf8")).not.toContain(
      '"generatedBy": "skillset@9.9.9"'
    );

    const result = await checkSkillsetSourceReadinessWithAuthority(
      root,
      { write: "outputs" },
      approvedPaths
    );

    expect(result.ok).toBe(false);
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-lock-repair-invalidated",
      outputPath: relativeLockPath,
      severity: "error",
    }));
    expect(result.data.outputDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "managed-lock-repair-invalidated",
        outputPath: relativeLockPath,
        severity: "error",
      })
    );
    expect(result.data.outputState).toMatchObject({
      blockers: [
        {
          code: "managed-lock-repair-invalidated",
          path: relativeLockPath,
        },
      ],
      state: "blocked",
    });
    expect(result.data.outputDiagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "managed-lock-provenance-stale",
        outputPath: relativeLockPath,
      })
    );
    expect(await readFile(lockPath, "utf8")).toContain(
      '"generatedBy": "skillset@9.9.9"'
    );
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(
      false
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("write-boundary validation refuses a newly edited managed payload", async () => {
  const root = await fixture();
  try {
    await checkSkillsetSourceReadiness(root, { write: "outputs" });
    const relativeLockPath = ".claude/skills/skillset.lock";
    const lockPath = join(root, relativeLockPath);
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      items: Array<{ sourceHash?: string }>;
    };
    lock.items[0]!.sourceHash = `sha256:${"0".repeat(64)}`;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const generatedPath = join(root, GENERATED_SKILL);
    const editedPayload = `${await readFile(generatedPath, "utf8")}\nraced edit\n`;
    const result = await checkSkillsetSourceReadinessWithAuthority(
      root,
      { write: "outputs" },
      [relativeLockPath],
      {
        beforeFinalWriteInspection: () => {
          writeFileSync(generatedPath, editedPayload, "utf8");
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    expect(result.writes).toEqual({
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    });
    expect(result.data.outputDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "managed-output-write-invalidated",
        outputPath: GENERATED_SKILL,
        severity: "error",
      })
    );
    expect(result.data.outputState).toMatchObject({
      blockers: [
        {
          code: "managed-output-write-invalidated",
          path: GENERATED_SKILL,
        },
      ],
      state: "blocked",
    });
    expect(await readFile(generatedPath, "utf8")).toBe(editedPayload);
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(
      false
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("final write validation refuses a newly appearing unmanaged collision", async () => {
  const root = await fixture();
  try {
    await checkSkillsetSourceReadiness(root, { write: "outputs" });
    await mkdir(join(root, ".skillset/skills/raced"), { recursive: true });
    await writeFile(
      join(root, ".skillset/skills/raced/SKILL.md"),
      "---\nname: raced\ndescription: Raced.\n---\n\nBody.\n",
      "utf8"
    );
    const relativeGeneratedPath = ".claude/skills/raced/SKILL.md";
    const generatedPath = join(root, relativeGeneratedPath);
    const collision = "hand-authored collision\n";

    const result = await checkSkillsetSourceReadinessWithAuthority(
      root,
      { write: "outputs" },
      [],
      {
        beforeFinalWriteInspection: () => {
          mkdirSync(join(root, ".claude/skills/raced"), { recursive: true });
          writeFileSync(generatedPath, collision, "utf8");
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    expect(result.writes).toEqual({
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    });
    expect(result.data.outputDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "unmanaged-output-collision",
        outputPath: relativeGeneratedPath,
      })
    );
    expect(result.data.outputState.state).toBe("blocked");
    expect(await readFile(generatedPath, "utf8")).toBe(collision);
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(
      false
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("write preimage validation refuses a file appearing after backup planning", async () => {
  const root = await fixture();
  try {
    await checkSkillsetSourceReadiness(root, { write: "outputs" });
    await mkdir(join(root, ".skillset/skills/raced"), { recursive: true });
    await writeFile(
      join(root, ".skillset/skills/raced/SKILL.md"),
      "---\nname: raced\ndescription: Raced.\n---\n\nBody.\n",
      "utf8"
    );
    const relativeGeneratedPath = ".claude/skills/raced/SKILL.md";
    const generatedPath = join(root, relativeGeneratedPath);
    const collision = "appeared after backup planning\n";

    const result = await checkSkillsetSourceReadinessWithAuthority(
      root,
      { write: "outputs" },
      [],
      {
        afterBackupPlanning: () => {
          mkdirSync(join(root, ".claude/skills/raced"), { recursive: true });
          writeFileSync(generatedPath, collision, "utf8");
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.data.fixedPaths).toEqual([]);
    expect(result.data.writePerformed).toBe(false);
    expect(result.writes).toEqual({
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    });
    expect(result.data.outputDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "output-write-preimage-invalidated",
        outputPath: relativeGeneratedPath,
        severity: "error",
      })
    );
    expect(result.data.outputState).toMatchObject({
      blockers: [{
        code: "output-write-preimage-invalidated",
        path: relativeGeneratedPath,
      }],
      state: "blocked",
    });
    expect(await readFile(generatedPath, "utf8")).toBe(collision);
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(
      false
    );
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

test.each([
  ["project", "plugins/skillset.lock"],
  ["plugin", "skillset.lock"],
] as const)(
  "doctor preserves a valid %s baseline when another requested scope is corrupt",
  async (_validScope, corruptLockPath) => {
    const root = await fixture();
    try {
      await mkdir(join(root, ".skillset/plugins/alpha/skills/plugin-skill"), {
        recursive: true,
      });
      await writeFile(
        join(root, ".skillset/plugins/alpha/skillset.yaml"),
        "skillset:\n  name: alpha\n"
      );
      await writeFile(
        join(root, ".skillset/plugins/alpha/skills/plugin-skill/SKILL.md"),
        "---\nname: plugin-skill\ndescription: Plugin skill.\n---\n\nPlugin body.\n"
      );
      expect(
        (await checkSkillsetSourceReadiness(root, { write: "outputs" })).ok
      ).toBe(true);

      const corruptLock = "{ not valid json";
      await writeFile(join(root, corruptLockPath), corruptLock, "utf8");

      const result = await doctorSkillset(root);

      expect(result.ok).toBe(false);
      expect(result.buildError).toContain("cannot guard generated state");
      expect(result.outputState).toMatchObject({
        blockers: [{ code: "output-derivation-failed" }],
        hasBaseline: true,
        state: "blocked",
      });
      expect(await readFile(join(root, corruptLockPath), "utf8")).toBe(
        corruptLock
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
);

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
