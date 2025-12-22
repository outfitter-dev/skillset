import { logUsage } from "@skillset/shared";
import { loadCaches } from "../cache";
import { loadConfig } from "../config";
import { formatOutcome } from "../format";
import { indexSkills } from "../indexer";
import { resolveTokens } from "../resolver";
import { tokenizePrompt } from "../tokenizer";

export async function runUserPromptSubmitHook(stdin: string): Promise<string> {
  const payload = safeParse(stdin);
  const promptValue =
    typeof payload?.prompt === "string"
      ? payload.prompt
      : typeof payload?.inputText === "string"
        ? payload.inputText
        : stdin;

  // Refresh cache lazily if empty
  let cache = loadCaches();
  if (Object.keys(cache.skills).length === 0) {
    indexSkills();
    cache = loadCaches(); // Reload after indexing
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
  const config = loadConfig();
  const startTime = Date.now();
  const results = resolveTokens(tokens, config, cache);
  const outcome = formatOutcome(results, config);

  // Log usage for each resolved skill
  const duration_ms = Date.now() - startTime;
  for (const result of results) {
    if (result.skill) {
      logUsage({
        action: "inject",
        skill: result.skill.skillRef,
        source: "hook",
        duration_ms,
      });
    }
  }

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: outcome.context,
    },
  });
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
