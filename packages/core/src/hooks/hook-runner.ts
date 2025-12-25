import { logUsage } from "@skillset/shared";
import { loadCaches } from "../cache";
import { loadConfig } from "../config";
import { formatOutcome } from "../format";
import { indexSkills } from "../indexer";
import { normalizeTokenRef } from "../normalize";
import { resolveTokens } from "../resolver";
import { tokenizePrompt } from "../tokenizer";

export async function runUserPromptSubmitHook(stdin: string): Promise<string> {
  const payload = safeParse(stdin);
  let promptValue = stdin;
  if (typeof payload?.prompt === "string") {
    promptValue = payload.prompt;
  } else if (typeof payload?.inputText === "string") {
    promptValue = payload.inputText;
  }

  // Refresh cache lazily if empty
  let cache = await loadCaches();
  if (Object.keys(cache.skills).length === 0) {
    await indexSkills();
    cache = await loadCaches(); // Reload after indexing
  }

  // Extract $<ref> (kebab-case, optional namespace) tokens from prompt
  const tokens = tokenizePrompt(promptValue);

  // If no tokens found, return empty response
  if (tokens.length === 0) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "",
      },
    });
  }

  // Resolve tokens to skills and format for injection
  const config = await loadConfig();
  const startTime = Date.now();
  const results = await resolveTokens(tokens, config, cache);
  const outcome = await formatOutcome(results, config, cache);

  // Log usage for each resolved skill
  const duration_ms = Date.now() - startTime;
  const injected = collectInjectedSkills(results, cache);
  await Promise.all(
    injected.map((skill) =>
      logUsage({
        action: "inject",
        skill: skill.skillRef,
        source: "hook",
        duration_ms,
      })
    )
  );

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: outcome.context,
    },
  });
}

function collectInjectedSkills(
  results: Awaited<ReturnType<typeof resolveTokens>>,
  cache: Awaited<ReturnType<typeof loadCaches>>
) {
  const injected = new Map<string, (typeof cache.skills)[string]>();
  for (const result of results) {
    if (result.skill) {
      injected.set(result.skill.skillRef, result.skill);
    }
    if (result.set) {
      for (const ref of result.set.skillRefs) {
        const normalized = normalizeTokenRef(ref);
        const skill = cache.skills[ref] ?? cache.skills[normalized];
        if (skill) {
          injected.set(skill.skillRef, skill);
        }
      }
    }
  }
  return Array.from(injected.values());
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
