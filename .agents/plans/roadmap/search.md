# Roadmap: Search Command

## Status: Deferred

Deferred from Phase 8 (CLI Redesign). This feature enables full-text search across skill content.

## Feature Overview

```bash
skillset search "debugging"              # Search skill names and descriptions
skillset search "typescript" --content   # Search within SKILL.md content
skillset search "api" -s plugin          # Filter by source
skillset search "react" --json           # JSON output
```

## Output Examples

### Default Search (names/descriptions)

```bash
$ skillset search "debug"

Found 4 skills matching "debug":

  project:systematic-debugging
    "Evidence-based debugging with root cause analysis"
    Path: .claude/skills/systematic-debugging/SKILL.md

  plugin:baselayer:debug
    "Baselayer debugging workflow"
    Path: ~/.claude/plugins/baselayer/skills/debug/SKILL.md

  user:quick-debug
    "Fast debugging checklist for common issues"
    Path: ~/.claude/skills/quick-debug/SKILL.md

  project:debug-frontend
    "Frontend-specific debugging techniques"
    Path: .claude/skills/debug-frontend/SKILL.md
```

### Content Search

```bash
$ skillset search "console.log" --content

Found 2 skills with content matching "console.log":

  project:debug-frontend
    Line 45: "Use `console.log` strategically..."
    Line 67: "Remove all `console.log` before..."

  user:quick-debug
    Line 12: "Start with `console.log(variable)`..."
```

### JSON Output

```bash
$ skillset search "debug" --json

{
  "query": "debug",
  "results": [
    {
      "skill": "project:systematic-debugging",
      "description": "Evidence-based debugging with root cause analysis",
      "path": ".claude/skills/systematic-debugging/SKILL.md",
      "matches": {
        "name": true,
        "description": true,
        "content": false
      }
    }
  ]
}
```

## Implementation

### Search Index

For fast searching, maintain a search index in cache:

```typescript
// packages/core/src/search/index.ts
interface SearchIndex {
  skills: SkillSearchEntry[];
  lastUpdated: string;
}

interface SkillSearchEntry {
  ref: string;
  name: string;
  description: string;
  content: string;  // Full SKILL.md content (for --content searches)
  path: string;
}

export function buildSearchIndex(skills: Skill[]): SearchIndex {
  return {
    skills: skills.map((skill) => ({
      ref: skill.skillRef,
      name: skill.name,
      description: skill.description ?? "",
      content: readFileSync(skill.path, "utf-8"),
      path: skill.path,
    })),
    lastUpdated: new Date().toISOString(),
  };
}
```

### Search Function

```typescript
// packages/core/src/search/search.ts
interface SearchOptions {
  content?: boolean;  // Search within SKILL.md content
  source?: string;    // Filter by source namespace
  limit?: number;     // Max results
}

interface SearchResult {
  skill: string;
  description: string;
  path: string;
  matches: {
    name: boolean;
    description: boolean;
    content: boolean;
    lines?: { line: number; text: string }[];
  };
  score: number;
}

export function searchSkills(
  query: string,
  index: SearchIndex,
  options: SearchOptions = {}
): SearchResult[] {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const entry of index.skills) {
    // Apply source filter
    if (options.source && !entry.ref.startsWith(options.source)) {
      continue;
    }

    const nameMatch = entry.name.toLowerCase().includes(queryLower);
    const descMatch = entry.description.toLowerCase().includes(queryLower);
    let contentMatch = false;
    let contentLines: { line: number; text: string }[] = [];

    if (options.content) {
      const lines = entry.content.split("\n");
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(queryLower)) {
          contentMatch = true;
          contentLines.push({ line: i + 1, text: line.trim() });
        }
      });
    }

    if (nameMatch || descMatch || contentMatch) {
      results.push({
        skill: entry.ref,
        description: entry.description,
        path: entry.path,
        matches: {
          name: nameMatch,
          description: descMatch,
          content: contentMatch,
          lines: contentLines.length > 0 ? contentLines : undefined,
        },
        score: calculateScore(nameMatch, descMatch, contentMatch),
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 20);
}

function calculateScore(name: boolean, desc: boolean, content: boolean): number {
  let score = 0;
  if (name) score += 10;
  if (desc) score += 5;
  if (content) score += 1;
  return score;
}
```

### CLI Command

```typescript
// apps/cli/src/commands/search.ts
import { Command } from "commander";
import { searchSkills, loadSearchIndex } from "@skillset/core";

export const searchCommand = new Command("search")
  .description("Search skills by name, description, or content")
  .argument("<query>", "Search query")
  .option("--content", "Search within SKILL.md content")
  .option("-s, --source <ns>", "Filter by source namespace")
  .option("--limit <n>", "Max results", parseInt, 20)
  .option("--json", "JSON output")
  .action(async (query, options) => {
    const index = await loadSearchIndex();
    const results = searchSkills(query, index, options);

    if (options.json) {
      console.log(JSON.stringify({ query, results }, null, 2));
    } else {
      formatSearchResults(results, options.content);
    }
  });
```

## Considerations

### Performance

- Index is rebuilt on `skillset index`
- Content search can be slow for large skill sets
- Consider fuzzy matching with libraries like `fuse.js`

### Future Enhancements

- Regex support: `skillset search --regex "debug.*error"`
- Semantic search: Use embeddings for similarity matching
- Tag search: `skillset search --tag security`

## Dependencies

- Optional: `fuse.js` for fuzzy matching

## Checklist

- [ ] Define `SearchIndex` type
- [ ] Implement `buildSearchIndex()` in indexer
- [ ] Implement `searchSkills()` function
- [ ] Add `search` command to CLI
- [ ] Add `--content` flag for content search
- [ ] Add `--source` filter
- [ ] Add `--limit` option
- [ ] Add `--json` output
- [ ] Update `skillset index` to build search index
- [ ] Document in README
