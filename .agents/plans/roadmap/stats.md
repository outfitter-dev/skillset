# Roadmap: Stats Command (v2)

## Status: Deferred

Deferred from Phase 8 (CLI Redesign). Basic usage logging is implemented in v1; this document covers the full stats command for aggregation and analysis.

## Prerequisite

- Phase 8 must complete first (implements `usage.jsonl` logging)

## Feature Overview

```bash
skillset stats                    # Summary of all usage
skillset stats --top 10           # Top 10 skills by usage count
skillset stats --since 2025-12-01 # Filter by date range
skillset stats --until 2025-12-31
skillset stats --source project   # Filter by source
skillset stats --json             # JSON output for scripting
```

## Output Examples

### Default Summary

```bash
$ skillset stats

Usage Statistics (last 30 days)
═══════════════════════════════

Total loads: 847
Unique skills: 23

Top skills:
  1. project:debug           (156 loads)
  2. user:code-review        (134 loads)
  3. plugin:baselayer:tdd    (98 loads)
  4. project:frontend-design (87 loads)
  5. user:ship               (72 loads)

By source:
  project: 412 (48.6%)
  user: 298 (35.2%)
  plugin: 137 (16.2%)
```

### Top N

```bash
$ skillset stats --top 3

Top 3 Skills (last 30 days)
═══════════════════════════

  1. project:debug       156 loads  ████████████████████
  2. user:code-review    134 loads  █████████████████
  3. plugin:baselayer:tdd 98 loads  ████████████
```

### JSON Output

```bash
$ skillset stats --json

{
  "period": {
    "start": "2025-11-22T00:00:00Z",
    "end": "2025-12-22T23:59:59Z"
  },
  "total_loads": 847,
  "unique_skills": 23,
  "by_skill": [
    { "skill": "project:debug", "count": 156 },
    { "skill": "user:code-review", "count": 134 }
  ],
  "by_source": {
    "project": 412,
    "user": 298,
    "plugin": 137
  }
}
```

## Implementation

### Log Aggregation

```typescript
// packages/core/src/stats/aggregate.ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { getSkillsetPaths } from "@skillset/shared";

interface StatsOptions {
  since?: Date;
  until?: Date;
  source?: string;
  top?: number;
}

interface StatsResult {
  totalLoads: number;
  uniqueSkills: number;
  bySkill: Map<string, number>;
  bySource: Map<string, number>;
}

export async function aggregateStats(options: StatsOptions): Promise<StatsResult> {
  const paths = getSkillsetPaths();
  const logFile = join(paths.logs, "usage.jsonl");

  const bySkill = new Map<string, number>();
  const bySource = new Map<string, number>();

  const rl = createInterface({
    input: createReadStream(logFile),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const entry = JSON.parse(line);
    const timestamp = new Date(entry.timestamp);

    // Apply date filters
    if (options.since && timestamp < options.since) continue;
    if (options.until && timestamp > options.until) continue;

    // Apply source filter
    const source = entry.skill.split(":")[0];
    if (options.source && source !== options.source) continue;

    // Aggregate
    bySkill.set(entry.skill, (bySkill.get(entry.skill) ?? 0) + 1);
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
  }

  return {
    totalLoads: [...bySkill.values()].reduce((a, b) => a + b, 0),
    uniqueSkills: bySkill.size,
    bySkill,
    bySource,
  };
}
```

### CLI Command

```typescript
// apps/cli/src/commands/stats.ts
import { Command } from "commander";
import { aggregateStats } from "@skillset/core";

export const statsCommand = new Command("stats")
  .description("Show usage statistics")
  .option("--top <n>", "Show top N skills", parseInt)
  .option("--since <date>", "Start date (YYYY-MM-DD)")
  .option("--until <date>", "End date (YYYY-MM-DD)")
  .option("-s, --source <ns>", "Filter by source")
  .option("--json", "JSON output")
  .action(async (options) => {
    const stats = await aggregateStats({
      since: options.since ? new Date(options.since) : undefined,
      until: options.until ? new Date(options.until) : undefined,
      source: options.source,
      top: options.top,
    });

    if (options.json) {
      console.log(JSON.stringify(formatStatsJson(stats), null, 2));
    } else {
      console.log(formatStatsText(stats, options.top));
    }
  });
```

## Considerations

### Performance

- For large log files, consider:
  - Streaming aggregation (implemented above)
  - Periodic summary file generation
  - Log rotation with `--rotate` flag

### Privacy

- Stats are local-only (no telemetry)
- User can delete `usage.jsonl` at any time
- Add `--clear` flag to reset stats

## Dependencies

- None beyond what's in Phase 8

## Checklist

- [ ] Implement `aggregateStats()` in `@skillset/core`
- [ ] Add `stats` command to CLI
- [ ] Add date range filtering (`--since`, `--until`)
- [ ] Add source filtering (`--source`)
- [ ] Add top N display (`--top`)
- [ ] Add JSON output (`--json`)
- [ ] Add progress bar for large files
- [ ] Add `--clear` flag to reset stats
- [ ] Document in README
