import { expect, test } from "bun:test";
import { classifyNativeHookLiftDiagnostics } from "../adaptive-hook-native-lift";
import { targetNames } from "../targets";

// Absence of a known variable is not evidence that an arbitrary program is portable.
for (const command of [
  '"$CLAUDE_PLUGIN_ROOT"/check.sh',
  '"${CLAUDE_PLUGIN_ROOT}"/check.sh',
  '"$CLAUDE_PLUGIN_ROOTED"/check.sh',
  'python3 ./provider-specific-procedure.py',
  'echo unchanged',
]) {
  test(`native command runtime remains unverified: ${command}`, () => {
    const parsed = { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } };
    const before = JSON.stringify(parsed);
    const diagnostics = classifyNativeHookLiftDiagnostics({
      parsed,
      scope: { kind: "plugin", pluginId: "demo" },
      sourcePath: ".skillset/plugins/demo/hooks/hooks.json",
      targets: targetNames(),
    });
    expect(diagnostics).toHaveLength(targetNames().length);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.code).toBe("native-hook-runtime-unverified");
      expect(diagnostic.status).toBe("unknown");
      expect(diagnostic.message).toContain("command runtime semantics have not been verified");
      expect(diagnostic.message).not.toContain("lossless");
      expect(diagnostic.providerRef).toBeDefined();
    }
    expect(JSON.stringify(parsed)).toBe(before);
  });
}

test("known structural rejection remains separate from unknown command semantics", () => {
  const diagnostics = classifyNativeHookLiftDiagnostics({
    parsed: { hooks: { Notification: [{ hooks: [{ type: "command", command: "echo notify" }] }] } },
    scope: { kind: "plugin", pluginId: "demo" },
    sourcePath: ".skillset/plugins/demo/hooks/hooks.json",
    targets: ["codex"],
  });
  expect(diagnostics[0]).toMatchObject({ code: "native-hook-unsupported", status: "unsupported" });
  expect(diagnostics[0]?.message).toContain("does not support");
});
