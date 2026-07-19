import { describe, expect, test } from "bun:test";

import {
  adaptiveHookIntentIsRenderable,
  classifyAdaptiveHookIntent,
} from "../adaptive-hook-classifier";
import { classifyNativeHookLiftDiagnostics } from "../adaptive-hook-native-lift";
import type { ResolvedAdaptiveHookAttachment } from "../adaptive-hook-attachments";
import type { AdaptiveHookScope, JsonRecord, TargetName } from "../types";

const PLUGIN_SCOPE = { kind: "plugin", pluginId: "demo" } as const satisfies AdaptiveHookScope;

describe("adaptive hook intent classifier", () => {
  test("classifies cross-provider adaptive hooks as lossless", () => {
    const claude = classifyAdaptiveHookIntent(hookItem({ event: "SessionStart" }), "claude", "plugin");
    const codex = classifyAdaptiveHookIntent(hookItem({ event: "SessionStart" }), "codex", "plugin");

    expect(claude).toEqual(expect.objectContaining({
      event: "SessionStart",
      matcherKind: "session-source",
      providerRef: "claude-hooks-overlay",
      status: "lossless-adaptive",
      target: "claude",
    }));
    expect(codex).toEqual(expect.objectContaining({
      event: "SessionStart",
      matcherKind: "session-source",
      providerRef: "codex-hook-event-schemas",
      status: "lossless-adaptive",
      target: "codex",
    }));
    expect(adaptiveHookIntentIsRenderable(claude)).toBe(true);
    expect(adaptiveHookIntentIsRenderable(codex)).toBe(true);
  });

  test("classifies provider-scoped adaptive hooks from explicit source scope", () => {
    const claudeOnly = classifyAdaptiveHookIntent(
      hookItem({ definitionProviders: ["claude"], event: "Stop" }),
      "claude",
      "plugin"
    );
    const codexOnly = classifyAdaptiveHookIntent(
      hookItem({ definitionProviders: ["codex"], event: "PreToolUse", match: "Bash" }),
      "codex",
      "plugin"
    );

    expect(claudeOnly.status).toBe("provider-scoped-adaptive");
    expect(claudeOnly.reason).toBe("Adaptive hook demo-hook is scoped to claude.");
    expect(codexOnly.status).toBe("provider-scoped-adaptive");
    expect(codexOnly.reason).toBe("Adaptive hook demo-hook is scoped to codex.");
    expect(adaptiveHookIntentIsRenderable(claudeOnly)).toBe(true);
    expect(adaptiveHookIntentIsRenderable(codexOnly)).toBe(true);
  });

  test("classifies provider-scoped adaptive hooks from provider capability asymmetry", () => {
    const claudeNotification = classifyAdaptiveHookIntent(hookItem({ event: "Notification" }), "claude", "plugin");

    expect(claudeNotification.status).toBe("provider-scoped-adaptive");
    expect(claudeNotification.reason).toBe("Codex does not support adaptive hook event Notification.");
    expect(adaptiveHookIntentIsRenderable(claudeNotification)).toBe(true);
  });

  test("classifies plugin run.env as renderable while preserving remaining field gaps", () => {
    const pluginEnv = classifyAdaptiveHookIntent(
      hookItem({ event: "Stop", frontmatter: { events: ["Stop"], run: { command: "echo ok", env: { CHECK: "1" } } } }),
      "claude",
      "plugin"
    );
    const frontmatterEnv = classifyAdaptiveHookIntent(
      hookItem({
        event: "Stop",
        frontmatter: { events: ["Stop"], run: { command: "echo ok", env: { CHECK: "1" } } },
        scope: { kind: "skill", skillId: "writer" },
      }),
      "claude",
      "frontmatter"
    );

    expect(pluginEnv.status).toBe("lossless-adaptive");
    expect(adaptiveHookIntentIsRenderable(pluginEnv)).toBe(true);
    expect(frontmatterEnv).toEqual(expect.objectContaining({
      reason: "Adaptive hook demo-hook uses run.env, but frontmatter hook rendering only supports run.command yet.",
      status: "unsupported",
    }));
    expect(adaptiveHookIntentIsRenderable(frontmatterEnv)).toBe(false);
  });

  test("classifies destination gaps as native-only", () => {
    const codexSkillHook = classifyAdaptiveHookIntent(
      hookItem({
        event: "Stop",
        scope: { kind: "skill", skillId: "writer" },
      }),
      "codex",
      "frontmatter"
    );

    expect(codexSkillHook).toEqual(expect.objectContaining({
      reason: "Codex has no faithful skill-local hook destination for adaptive hook attachments.",
      status: "native-only",
      surface: "frontmatter",
      target: "codex",
    }));
    expect(adaptiveHookIntentIsRenderable(codexSkillHook)).toBe(false);
  });

  test("classifies effective provider fields without treating the override itself as unsupported", () => {
    const claudeArgs = classifyAdaptiveHookIntent(
      hookItem({
        event: "Stop",
        frontmatter: {
          claude: { run: { args: ["--check"], command: "echo claude" } },
          codex: { match: "main" },
          events: ["Stop"],
          run: { command: "echo base" },
        },
      }),
      "claude",
      "plugin"
    );
    const codexMatcher = classifyAdaptiveHookIntent(
      hookItem({
        event: "Stop",
        frontmatter: {
          claude: { run: { args: ["--check"], command: "echo claude" } },
          codex: { match: "main" },
          events: ["Stop"],
          run: { command: "echo base" },
        },
      }),
      "codex",
      "plugin"
    );

    expect(claudeArgs.reason).toBe("Adaptive hook demo-hook uses run.args, but plugin hook rendering only supports run.command, run.script, and run.env yet.");
    expect(codexMatcher.reason).toBe("Codex ignores matchers for adaptive hook event Stop, so this attachment cannot render faithfully.");
    expect(claudeArgs.reason).not.toContain("provider overrides");
  });

  test("classifies lossy or unsupported hook shapes as unsupported", () => {
    const unsupportedEvent = classifyAdaptiveHookIntent(hookItem({ event: "Notification" }), "codex", "plugin");
    const ignoredMatcher = classifyAdaptiveHookIntent(hookItem({ event: "Stop", match: "main" }), "codex", "plugin");
    const renderFieldGap = classifyAdaptiveHookIntent(
      hookItem({ event: "Stop", frontmatter: { events: ["Stop"], run: { command: "echo ok", cwd: "scripts" } } }),
      "claude",
      "plugin"
    );

    expect(unsupportedEvent).toEqual(expect.objectContaining({
      reason: "Codex does not support adaptive hook event Notification.",
      status: "unsupported",
    }));
    expect(ignoredMatcher).toEqual(expect.objectContaining({
      reason: "Codex ignores matchers for adaptive hook event Stop, so this attachment cannot render faithfully.",
      status: "unsupported",
    }));
    expect(renderFieldGap).toEqual(expect.objectContaining({
      reason: "Adaptive hook demo-hook uses run.cwd, but plugin hook rendering only supports run.command, run.script, and run.env yet.",
      status: "unsupported",
    }));
    expect(adaptiveHookIntentIsRenderable(unsupportedEvent)).toBe(false);
    expect(adaptiveHookIntentIsRenderable(ignoredMatcher)).toBe(false);
    expect(adaptiveHookIntentIsRenderable(renderFieldGap)).toBe(false);
  });

  test("classifies native hook lift diagnostics through the adaptive classifier", () => {
    const diagnostics = classifyNativeHookLiftDiagnostics({
      parsed: {
        hooks: {
          Notification: [
            {
              hooks: [{ command: "echo notify", type: "command" }],
            },
          ],
          PreToolUse: [
            {
              hooks: [{ command: "echo tool", type: "command" }],
              matcher: "Bash",
            },
          ],
          Stop: [
            {
              hooks: [{ command: "echo stop", timeout: 5, type: "command" }],
            },
          ],
        },
      },
      scope: PLUGIN_SCOPE,
      sourcePath: ".skillset/plugins/demo/hooks/hooks.json",
      targets: ["claude", "codex"],
    });

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "native-hook-lift-candidate",
      event: "Notification",
      message: expect.stringContaining("provider-scoped-adaptive for claude"),
      status: "provider-scoped-adaptive",
      target: "claude",
    }));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "native-hook-unsupported",
      event: "Notification",
      message: "Codex does not support adaptive hook event Notification.",
      status: "unsupported",
      target: "codex",
    }));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "native-hook-lift-candidate",
      event: "PreToolUse",
      message: expect.stringContaining("lossless-adaptive for codex"),
      status: "lossless-adaptive",
      target: "codex",
    }));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "native-hook-unsupported",
      event: "Stop",
      message: "Native hook Stop group 0 command handler uses field timeout, which adaptive hook lifting does not model yet.",
      status: "unsupported",
      target: "claude",
    }));
  });
});

function hookItem(options: {
  readonly attachmentProviders?: readonly TargetName[];
  readonly definitionProviders?: readonly TargetName[];
  readonly event: string;
  readonly frontmatter?: JsonRecord;
  readonly match?: string;
  readonly scope?: AdaptiveHookScope;
}): ResolvedAdaptiveHookAttachment {
  const scope = options.scope ?? PLUGIN_SCOPE;
  return {
    attachment: {
      hook: "demo-hook",
      ...(options.match === undefined ? {} : { match: options.match }),
      ...(options.attachmentProviders === undefined ? {} : { providers: options.attachmentProviders }),
      scope,
      sourcePath: "skillset.yaml",
    },
    definition: {
      events: [options.event],
      frontmatter: options.frontmatter ?? { events: [options.event], run: { command: "echo ok" } },
      name: "demo-hook",
      ...(options.definitionProviders === undefined ? {} : { providers: options.definitionProviders }),
      scriptReferences: [],
      scope,
      sourcePath: "hooks/demo-hook.json",
    },
    event: options.event,
  };
}
