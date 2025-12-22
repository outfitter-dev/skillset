import { loadCaches } from "../cache";
import { loadConfig } from "../config";
import { formatOutcome } from "../format";
import { indexSkills } from "../indexer";
import { logResults } from "../logger";
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

  // Extract w/<alias> tokens from prompt
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
  const results = resolveTokens(tokens, config, cache);
  logResults(results);
  const outcome = formatOutcome(results, config);

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
