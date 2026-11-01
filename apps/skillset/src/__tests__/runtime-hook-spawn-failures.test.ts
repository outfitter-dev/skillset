import { expect, spyOn, test } from "bun:test";
import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { runSkillsetCommand } from "../runtime-hooks/commands";

const missingInputs = ["executable", "cwd", "both"] as const;

test.each(missingInputs)("hook ENOENT does not blame the executable when missing input is %s [SET-678]", async (missing) => {
  const root = await createTestFixtureRoot("hook-spawn-missing-");
  const executable = missing === "cwd" ? process.execPath : join(root, "absent-executable");
  const cwd = missing === "executable" ? root : join(root, "absent-cwd");
  let output = "";
  const stderr = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    for (const allowFailure of [false, true]) {
      output = "";
      const exitCode = await runSkillsetCommand(["-e", "process.exit(0)"], {
        allowFailure,
        env: { SKILLSET_HOOK_COMMAND: `"${executable}"` },
        rootPath: cwd,
      });
      expect(exitCode).toBe(allowFailure ? 0 : 127);
      expect(output).toContain("hook could not start: executable, interpreter, or working directory may be missing");
      expect(output).not.toContain("hook command not found");
    }
  } finally {
    stderr.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("missing shebang interpreter uses the same non-specific hook spawn diagnosis", async () => {
  const root = await createTestFixtureRoot("hook-spawn-interpreter-");
  const executable = join(root, "runner");
  await Bun.write(executable, `#!${join(root, "absent-interpreter")}\n`);
  await chmod(executable, 0o755);
  let output = "";
  const stderr = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    await expect(runSkillsetCommand([], {
      allowFailure: false,
      env: { SKILLSET_HOOK_COMMAND: `"${executable}"` },
      rootPath: root,
    })).resolves.toBe(127);
    expect(output).toContain("executable, interpreter, or working directory may be missing");
    expect(output).not.toContain("hook command not found");
  } finally {
    stderr.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
