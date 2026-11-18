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

for (const parsed of [true, { hooks: "invalid" }, { hooks: { SessionStart: "invalid" } }]) {
  test(`malformed native structures do not disappear from classification: ${JSON.stringify(parsed)}`, () => {
    const diagnostics = classifyNativeHookLiftDiagnostics({ parsed, scope: { kind: "plugin" }, sourcePath: "hooks/hooks.json", targets: ["claude"] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "native-hook-unsupported", status: "unsupported" });
  });
}

test("native hook evidence uses escaped JSON pointers for the actual document shape", () => {
  for (const wrapped of [false, true]) {
    const events = { "Custom/~Event": [{ hooks: [{ type: "command", command: "echo native" }] }] };
    const diagnostics = classifyNativeHookLiftDiagnostics({ parsed: wrapped ? { hooks: events } : events, scope: { kind: "plugin" }, sourcePath: "hooks/hooks.json", targets: ["claude"] });
    expect(diagnostics[0]?.path).toBe(`hooks/hooks.json#${wrapped ? "/hooks" : ""}/Custom~1~0Event/0`);
  }
  const badRoot = classifyNativeHookLiftDiagnostics({ parsed: true, scope: { kind: "plugin" }, sourcePath: "hooks/hooks.json", targets: ["claude"] });
  expect(badRoot[0]?.path).toBe("hooks/hooks.json#");
  const badEvents = classifyNativeHookLiftDiagnostics({ parsed: { hooks: "bad" }, scope: { kind: "plugin" }, sourcePath: "hooks/hooks.json", targets: ["claude"] });
  expect(badEvents[0]?.path).toBe("hooks/hooks.json#/hooks");
});
