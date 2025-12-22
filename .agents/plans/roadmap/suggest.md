# Roadmap: Suggest Command

## Status: Deferred

Deferred from Phase 8 (CLI Redesign). This feature suggests relevant skills based on context.

## Feature Overview

```bash
skillset suggest                         # Suggest based on current directory
skillset suggest --prompt "fix auth bug" # Suggest based on prompt text
skillset suggest --file src/auth.ts      # Suggest based on file content
skillset suggest --git                   # Suggest based on git diff/status
```

## Output Examples

### Directory-Based Suggestions

```bash
$ cd ~/projects/react-app
$ skillset suggest

Based on your project structure, you might find these skills useful:

  Recommended:
    project:frontend-design     "React component patterns"
    user:typescript-strict      "Strict TypeScript configuration"
    plugin:baselayer:tdd        "Test-driven development"

  Also consider:
    user:code-review            "Code review checklist"
    project:accessibility       "A11y best practices"

  Tip: Use `skillset show <skill>` to learn more
```

### Prompt-Based Suggestions

```bash
$ skillset suggest --prompt "fix authentication bug in login flow"

Skills that might help with "fix authentication bug in login flow":

  High relevance:
    project:systematic-debugging  "Evidence-based debugging"
    user:security-audit           "Security review checklist"

  Medium relevance:
    project:frontend-design       "UI component patterns"
    plugin:baselayer:debug        "Debugging workflow"

  Load with: skillset load <skill>
```

### Git-Based Suggestions

```bash
$ skillset suggest --git

Based on your uncommitted changes (5 files modified):

  Modified: src/components/*.tsx
    → project:frontend-design    "React component patterns"
    → user:typescript-strict     "Type safety checks"

  Modified: src/api/*.ts
    → project:api-design         "REST API patterns"
    → user:error-handling        "Error handling best practices"

  Run `skillset load <skill>` to apply
```

## Implementation

### Context Analysis

```typescript
// packages/core/src/suggest/context.ts
interface ProjectContext {
  languages: string[];        // Detected languages
  frameworks: string[];       // Detected frameworks
  tools: string[];            // Build tools, testing frameworks
  patterns: string[];         // Architecture patterns detected
}

export async function analyzeProjectContext(cwd: string): Promise<ProjectContext> {
  const files = await glob("**/*", { cwd, ignore: ["node_modules/**"] });

  const context: ProjectContext = {
    languages: [],
    frameworks: [],
    tools: [],
    patterns: [],
  };

  // Detect by file extensions
  if (files.some(f => f.endsWith(".tsx") || f.endsWith(".jsx"))) {
    context.frameworks.push("react");
  }
  if (files.some(f => f.endsWith(".ts"))) {
    context.languages.push("typescript");
  }

  // Detect by config files
  if (files.includes("package.json")) {
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8"));
    if (pkg.dependencies?.next) context.frameworks.push("nextjs");
    if (pkg.devDependencies?.vitest) context.tools.push("vitest");
    if (pkg.devDependencies?.jest) context.tools.push("jest");
  }

  return context;
}
```

### Skill Matching

```typescript
// packages/core/src/suggest/match.ts
interface SkillRelevance {
  skill: Skill;
  score: number;
  reasons: string[];
}

export function matchSkillsToContext(
  skills: Skill[],
  context: ProjectContext
): SkillRelevance[] {
  const results: SkillRelevance[] = [];

  for (const skill of skills) {
    const relevance = calculateRelevance(skill, context);
    if (relevance.score > 0) {
      results.push(relevance);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

function calculateRelevance(skill: Skill, context: ProjectContext): SkillRelevance {
  let score = 0;
  const reasons: string[] = [];

  // Check skill tags/keywords against context
  const skillText = `${skill.name} ${skill.description}`.toLowerCase();

  for (const framework of context.frameworks) {
    if (skillText.includes(framework)) {
      score += 10;
      reasons.push(`Matches framework: ${framework}`);
    }
  }

  for (const lang of context.languages) {
    if (skillText.includes(lang)) {
      score += 5;
      reasons.push(`Matches language: ${lang}`);
    }
  }

  return { skill, score, reasons };
}
```

### Prompt Analysis

```typescript
// packages/core/src/suggest/prompt.ts
interface PromptContext {
  keywords: string[];
  intent: "debug" | "feature" | "refactor" | "review" | "unknown";
}

export function analyzePrompt(prompt: string): PromptContext {
  const lower = prompt.toLowerCase();

  // Detect intent
  let intent: PromptContext["intent"] = "unknown";
  if (lower.includes("fix") || lower.includes("bug") || lower.includes("debug")) {
    intent = "debug";
  } else if (lower.includes("add") || lower.includes("implement") || lower.includes("create")) {
    intent = "feature";
  } else if (lower.includes("refactor") || lower.includes("clean") || lower.includes("improve")) {
    intent = "refactor";
  } else if (lower.includes("review") || lower.includes("check")) {
    intent = "review";
  }

  // Extract keywords
  const keywords = prompt
    .split(/\s+/)
    .filter(w => w.length > 3)
    .map(w => w.toLowerCase());

  return { keywords, intent };
}
```

### CLI Command

```typescript
// apps/cli/src/commands/suggest.ts
import { Command } from "commander";
import { analyzeProjectContext, matchSkillsToContext, analyzePrompt } from "@skillset/core";

export const suggestCommand = new Command("suggest")
  .description("Suggest relevant skills based on context")
  .option("--prompt <text>", "Suggest based on prompt text")
  .option("--file <path>", "Suggest based on file content")
  .option("--git", "Suggest based on git changes")
  .option("--json", "JSON output")
  .action(async (options) => {
    let context;

    if (options.prompt) {
      context = analyzePrompt(options.prompt);
    } else if (options.git) {
      context = await analyzeGitChanges();
    } else {
      context = await analyzeProjectContext(process.cwd());
    }

    const skills = await loadSkillsFromCache();
    const suggestions = matchSkillsToContext(skills, context);

    if (options.json) {
      console.log(JSON.stringify(suggestions, null, 2));
    } else {
      formatSuggestions(suggestions);
    }
  });
```

## Considerations

### Intelligence Levels

1. **Basic** (v1): Keyword matching, file extension detection
2. **Intermediate** (v2): Content analysis, usage patterns
3. **Advanced** (v3): ML-based semantic matching

### Privacy

- All analysis is local (no external API calls)
- File content is analyzed but not stored
- Usage history influences suggestions (optional)

## Dependencies

- Optional: `simple-git` for git integration
- Optional: ML library for advanced matching

## Checklist

- [ ] Implement `analyzeProjectContext()`
- [ ] Implement `matchSkillsToContext()`
- [ ] Implement `analyzePrompt()`
- [ ] Add `suggest` command to CLI
- [ ] Add `--prompt` flag
- [ ] Add `--file` flag
- [ ] Add `--git` flag
- [ ] Add `--json` output
- [ ] Integrate with usage stats for personalization
- [ ] Document in README
