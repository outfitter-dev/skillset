import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { runHookEvent } from "../runtime-hooks/run";

async function fixture() {
  const root = await createTestFixtureRoot("codex-pre-tool-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n  session_start_hook: off\n");
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Managed skill.\n---\nBody.\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  return root;
}
const managed = ".agents/skills/demo/SKILL.md";
const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
async function run(root: string, command: string, policy = "block", cwd = root) {
  return runHookEvent("pre-tool-use", {
    rootPath: root,
    env: { SKILLSET_PROVIDER: "codex", SKILLSET_GENERATED_EDIT_POLICY: policy },
    stdinText: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "apply_patch", cwd, tool_input: { command } }),
    sourceGate: async () => { throw new Error("must not inspect Git"); },
    commandRunner: async () => { throw new Error("must not execute commands"); },
  });
}

test("Codex denies verified managed add, update and delete paths", async () => {
  const root = await fixture();
  const before = await Bun.file(join(root, managed)).text();
  for (const command of [
    patch("*** Add File: " + managed, "+replacement"),
    patch("*** Update File: " + managed, "@@", "-Body.", "+replacement"),
    patch("*** Delete File: " + managed),
  ]) {
    const result = await run(root, command);
    expect(result.exitCode).toBe(0);
    expect(result.ranCommands).toEqual([]);
    expect(JSON.parse(result.output).hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    expect(result.output).toContain(".skillset/skills/demo/SKILL.md");
  }
  expect(await Bun.file(join(root, managed)).text()).toBe(before);
});

test("Codex checks every patch section and both move endpoints", async () => {
  const root = await fixture();
  for (const command of [
    patch("*** Add File: authored.md", "+authored", "*** Delete File: " + managed),
    patch("*** Update File: authored.md", "*** Move to: " + managed, "@@", "-old", "+new"),
    patch("*** Update File: " + managed, "*** Move to: authored.md", "@@", "-old", "+new"),
  ]) {
    expect(JSON.parse((await run(root, command)).output).hookSpecificOutput.permissionDecision).toBe("deny");
  }
  const warning = await run(root, patch("*** Delete File: " + managed), "warn");
  expect(JSON.parse(warning.output).hookSpecificOutput.additionalContext).toContain(".skillset/skills/demo/SKILL.md");
  expect(warning.output).not.toContain("permissionDecision");
});

test("Codex resolves patch paths relative to event cwd, not the invocation root", async () => {
  const root = await fixture();
  const result = await run(root, patch("*** Delete File: ../SKILL.md"), "block", join(root, ".agents/skills/demo/references"));
  expect(JSON.parse(result.output).hookSpecificOutput.permissionDecision).toBe("deny");
  expect((await run(root, patch("*** Delete File: " + managed), "block", "relative")).output).toBe("");
});

test("Codex leaves unknown, malformed, remote and illustrative patch inputs undecided", async () => {
  const root = await fixture();
  for (const command of [
    "not a patch",
    patch("*** Update File: " + managed),
    patch("*** Delete File: " + managed, "unknown trailing operation"),
    patch("*** Environment ID: remote", "*** Delete File: " + managed),
    patch("*** Add File: authored.md", "+*** Delete File: " + managed),
    patch("*** Update File: authored.md", "@@", " *** Delete File: " + managed, "+new"),
    patch("*** Delete File: authored.md"),
    patch("*** Delete File: " + managed).replace("*** End Patch", ""),
  ]) {
    expect((await run(root, command)).output).toBe("");
  }
});

test("Codex accepts context markers, EOF, empty additions, CRLF and documented heredoc framing", async () => {
  const root = await fixture();
  for (const command of [
    patch("*** Add File: " + managed),
    patch("  *** Delete File: " + managed + "  "),
    patch("*** Update File: " + managed, "@@", "+one", "*** End of File", "", "@@ section", "-old", "+new"),
    patch("*** Update File: " + managed, "@@ section", " context", "", "-old", "+new", "*** End of File", ""),
    patch("*** Delete File: " + managed).replaceAll("\n", "\r\n"),
    "<<'EOF'\n" + patch("*** Delete File: " + managed) + "\nEOF",
  ]) {
    expect(JSON.parse((await run(root, command)).output).hookSpecificOutput.permissionDecision).toBe("deny");
  }
  for (const command of [
    patch("*** Update File: " + managed, "@@", "*** End of File"),
    patch("*** Update File: " + managed, "@@", "@@", "+new"),
    patch("*** Update File: " + managed, "@@", "+new", "*** End of File", "+trailing"),
    patch("*** Delete File: " + managed, "*** Add File: ssh://host/path", "+remote"),
  ]) expect((await run(root, command)).output).toBe("");
});

test("Codex CLI emits only the native decision and never applies the patch", async () => {
  const root = await fixture();
  const before = await Bun.file(join(root, managed)).text();
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli.ts"), "hooks", "run", "pre-tool-use", "--root", root], {
    env: { ...process.env, SKILLSET_PROVIDER: "codex", SKILLSET_GENERATED_EDIT_POLICY: "block" },
    stdin: new Blob([JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "apply_patch", cwd: root, tool_input: { command: patch("*** Delete File: " + managed) } })]),
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  expect(await Bun.file(join(root, managed)).text()).toBe(before);
});

test("Codex warn mode reports every managed patch path without duplicate mappings", async () => {
  const root = await fixture();
  await Bun.write(join(root, ".skillset/skills/second/SKILL.md"), "---\nname: second\ndescription: Another managed skill.\n---\nBody.\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const second = ".agents/skills/second/SKILL.md";
  const command = patch("*** Delete File: authored.md", "*** Delete File: " + managed, "*** Delete File: ./" + managed, "*** Delete File: " + second);
  const result = await run(root, command, "warn");
  const context = JSON.parse(result.output).hookSpecificOutput.additionalContext;
  expect(context).toContain(".skillset/skills/demo/SKILL.md");
  expect(context).toContain(".skillset/skills/second/SKILL.md");
  expect(context.match(/Skillset manages/gu)).toHaveLength(2);
  expect(result.output).not.toContain("permissionDecision");
  expect(result.ranCommands).toEqual([]);
  expect(JSON.parse((await run(root, command)).output).hookSpecificOutput.permissionDecision).toBe("deny");
});
