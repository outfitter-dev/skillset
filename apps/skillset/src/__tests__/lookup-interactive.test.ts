import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import { runLookupRoute, type LookupRouteRequest } from "../inspect-cli";
import { createInteractiveSession } from "../interactive-session";
import {
  lookupRequestNeedsPrompts,
  resolveInteractiveLookup,
} from "../lookup-interactive";
import { ScriptedPromptAdapter } from "../prompt-adapter";

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const ttyOutput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });

function request(
  overrides: Partial<LookupRouteRequest> = {}
): LookupRouteRequest {
  return {
    jsonOutput: false,
    lookupAspects: [],
    lookupField: undefined,
    lookupSubject: undefined,
    lookupTargets: [],
    lookupViews: [],
    ...overrides,
  };
}

function scriptedSession(
  answers: ConstructorParameters<typeof ScriptedPromptAdapter>[0]
) {
  const adapter = new ScriptedPromptAdapter(answers);
  const session = createInteractiveSession({
    adapter,
    env: { CI: "false" },
    input: ttyInput(),
    output: ttyOutput(),
  });
  if (session === undefined) throw new Error("expected interactive session");
  return { adapter, session };
}

describe("SET-296 derived interactive lookup", () => {
  test("navigates from report-owned subjects and views to a nested schema field", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "search", value: "workspace" },
      { kind: "select", value: "values" },
      { kind: "search", value: "compile.targets" },
    ]);

    await expect(resolveInteractiveLookup(request(), session)).resolves.toEqual(
      {
        jsonOutput: false,
        lookupAspects: [],
        lookupField: "compile.targets",
        lookupSubject: "workspace",
        lookupTargets: [],
        lookupViews: ["values"],
      }
    );
    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "search",
      "select",
      "search",
    ]);

    const subjectPrompt = adapter.prompts[0];
    if (subjectPrompt?.kind !== "search") {
      throw new Error("expected subject search");
    }
    expect(
      subjectPrompt.prompt
        .source("work", { signal: new AbortController().signal })
        .map((choice) => choice.value)
    ).toEqual(["workspace"]);

    const fieldPrompt = adapter.prompts[2];
    if (fieldPrompt?.kind !== "search") {
      throw new Error("expected field search");
    }
    expect(
      fieldPrompt.prompt
        .source("compile.targets", {
          signal: new AbortController().signal,
        })
        .map((choice) => choice.value)
    ).toEqual(["compile.targets"]);
  });

  test("derives target lenses for event and compatibility views", async () => {
    const events = scriptedSession([
      { kind: "select", value: "events" },
      { kind: "checkbox", value: ["codex"] },
    ]);
    await expect(
      resolveInteractiveLookup(
        request({ lookupSubject: "hooks" }),
        events.session
      )
    ).resolves.toMatchObject({
      lookupSubject: "hooks",
      lookupTargets: ["codex"],
      lookupViews: ["events"],
    });
    events.adapter.assertComplete();

    const targetsPrompt = events.adapter.prompts[1];
    if (targetsPrompt?.kind !== "checkbox") {
      throw new Error("expected target checkbox");
    }
    expect(
      targetsPrompt.prompt.choices.map((choice) => [
        choice.value,
        choice.checked,
      ])
    ).toEqual([
      ["claude", true],
      ["codex", true],
      ["cursor", true],
    ]);

    const compatibility = scriptedSession([
      { kind: "select", value: "compat" },
      { kind: "checkbox", value: ["claude", "codex", "cursor"] },
    ]);
    await expect(
      resolveInteractiveLookup(
        request({ lookupSubject: "plugin" }),
        compatibility.session
      )
    ).resolves.toMatchObject({
      lookupTargets: ["claude", "codex", "cursor"],
      lookupViews: ["compat"],
    });
    compatibility.adapter.assertComplete();
  });

  test("all-fields preserves the canonical top-level report", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "fields" },
      { kind: "search", value: "__all_lookup_fields__" },
    ]);

    await expect(
      resolveInteractiveLookup(request({ lookupSubject: "skill" }), session)
    ).resolves.toMatchObject({
      lookupField: undefined,
      lookupViews: ["fields"],
    });
    adapter.assertComplete();
  });

  test("filters subject search through Core-owned partial-request applicability", async () => {
    const cases = [
      {
        answer: "skill",
        choices: ["skill", "agent", "instruction"],
        overrides: { lookupViews: ["frontmatter"] },
      },
      {
        answer: "workspace",
        choices: ["skill", "agent", "instruction", "workspace", "hooks"],
        overrides: { lookupViews: ["fields"] },
      },
      {
        answer: "hooks",
        choices: ["hooks"],
        overrides: { lookupViews: ["events"] },
      },
      {
        answer: "workspace",
        choices: ["workspace"],
        overrides: { lookupField: "compile.targets" },
      },
      {
        answer: "workspace",
        choices: ["workspace"],
        overrides: { lookupField: " compile.targets " },
      },
      {
        answer: "skill",
        choices: ["skill", "agent", "instruction", "workspace", "hooks"],
        overrides: { lookupField: "does.not.exist" },
      },
    ] as const;

    for (const item of cases) {
      const { adapter, session } = scriptedSession([
        { kind: "search", value: item.answer },
      ]);
      await expect(
        resolveInteractiveLookup(request(item.overrides), session)
      ).resolves.toMatchObject({
        lookupSubject: item.answer,
      });
      adapter.assertComplete();

      const subjectPrompt = adapter.prompts[0];
      if (subjectPrompt?.kind !== "search") {
        throw new Error("expected subject search");
      }
      expect(
        subjectPrompt.prompt
          .source(undefined, { signal: new AbortController().signal })
          .map((choice) => choice.value)
      ).toEqual([...item.choices]);
    }
  });

  test("explicit and machine selections bypass prompt-owned decisions", () => {
    expect(
      lookupRequestNeedsPrompts(
        request({
          lookupSubject: "hooks",
          lookupTargets: [],
          lookupViews: ["compat"],
        })
      )
    ).toBe(false);
    expect(
      lookupRequestNeedsPrompts(
        request({
          jsonOutput: true,
        })
      )
    ).toBe(false);
    expect(
      lookupRequestNeedsPrompts(
        request({
          lookupAspects: ["tools"],
          lookupSubject: "skill",
        })
      )
    ).toBe(false);
    expect(
      lookupRequestNeedsPrompts(
        request({
          lookupSubject: "workspace",
        })
      )
    ).toBe(true);
  });

  test("the route renders once after prompting and bypasses explicit requests", async () => {
    const guided = scriptedSession([
      { kind: "search", value: "workspace" },
      { kind: "select", value: "schema" },
    ]);
    await runLookupRoute(request(), {
      interactiveSession: guided.session,
    });
    guided.adapter.assertComplete();
    expect(guided.adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "search",
      "select",
    ]);

    const explicit = scriptedSession([]);
    await runLookupRoute(
      request({
        lookupSubject: "hooks",
        lookupTargets: [],
        lookupViews: ["compat"],
      }),
      { interactiveSession: explicit.session }
    );
    explicit.adapter.assertComplete();
    expect(explicit.adapter.prompts).toEqual([]);
  });
});
