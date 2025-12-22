# Roadmap: Browse Command

## Status: Deferred

Deferred from Phase 8 (CLI Redesign). This feature provides an interactive TUI for exploring and managing skills.

## Feature Overview

```bash
skillset browse                  # Launch interactive browser
skillset browse --source project # Start filtered by source
skillset browse --preview        # Enable live preview
```

## Interface Mockup

```text
┌─ Skillset Browser ──────────────────────────────────────────────────────┐
│                                                                          │
│  Filter: [debug________]                      Source: [All ▼]           │
│                                                                          │
│  ┌─ Skills (4 matching) ────────────────────┐  ┌─ Preview ─────────────┐│
│  │                                          │  │                       ││
│  │  ▸ project:systematic-debugging          │  │  # Systematic Debug   ││
│  │    "Evidence-based debugging workflow"   │  │                       ││
│  │                                          │  │  Phase 1: Investigate ││
│  │    plugin:baselayer:debug                │  │  - Reproduce the bug  ││
│  │    "Baselayer debugging skill"           │  │  - Gather evidence    ││
│  │                                          │  │  - Check logs         ││
│  │    user:quick-debug                      │  │                       ││
│  │    "Fast debug checklist"                │  │  Phase 2: Analyze     ││
│  │                                          │  │  - Form hypotheses    ││
│  │    project:debug-frontend                │  │  - Test assumptions   ││
│  │    "Frontend debugging techniques"       │  │  ...                  ││
│  │                                          │  │                       ││
│  └──────────────────────────────────────────┘  └───────────────────────┘│
│                                                                          │
│  [Enter] Load  [a] Alias  [c] Copy ref  [o] Open file  [q] Quit         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Features

### Navigation

| Key | Action |
| --- | ------ |
| `↑/↓` or `j/k` | Move selection |
| `Enter` | Load selected skill (outputs content) |
| `a` | Create alias for selected skill |
| `c` | Copy skill ref to clipboard |
| `o` | Open SKILL.md in `$EDITOR` |
| `/` | Focus filter input |
| `Tab` | Switch between panels |
| `q` or `Esc` | Quit |

### Filtering

- **Text filter**: Type to filter by name/description
- **Source filter**: Dropdown to filter by source (project/user/plugin)
- **Tag filter**: Filter by skill tags (future)

### Preview Panel

- Live preview of selected skill content
- Syntax highlighting for markdown
- Scrollable for long skills

### Actions

- **Load**: Output skill content to stdout (for piping)
- **Alias**: Create alias with interactive prompt
- **Copy**: Copy `$<skillref>` to clipboard
- **Open**: Open in editor (respects `$EDITOR`)

## Implementation

### TUI Framework

Use `ink` (React for CLI) or `blessed`/`blessed-contrib`:

```typescript
// apps/cli/src/commands/browse/App.tsx (using ink)
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { SkillList } from "./SkillList";
import { Preview } from "./Preview";
import { FilterBar } from "./FilterBar";

export function App() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    loadSkills().then(setSkills);
  }, []);

  const filtered = skills.filter(s => {
    if (source && !s.skillRef.startsWith(source)) return false;
    if (filter && !s.name.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setSelected(Math.max(0, selected - 1));
    } else if (key.downArrow || input === "j") {
      setSelected(Math.min(filtered.length - 1, selected + 1));
    } else if (key.return) {
      loadAndOutput(filtered[selected]);
    } else if (input === "q") {
      process.exit(0);
    }
  });

  return (
    <Box flexDirection="column">
      <FilterBar filter={filter} onFilterChange={setFilter} source={source} onSourceChange={setSource} />
      <Box>
        <SkillList skills={filtered} selected={selected} />
        <Preview skill={filtered[selected]} />
      </Box>
      <StatusBar />
    </Box>
  );
}
```

### Skill List Component

```typescript
// apps/cli/src/commands/browse/SkillList.tsx
import React from "react";
import { Box, Text } from "ink";

interface Props {
  skills: Skill[];
  selected: number;
}

export function SkillList({ skills, selected }: Props) {
  return (
    <Box flexDirection="column" width="50%">
      {skills.map((skill, i) => (
        <Box key={skill.skillRef}>
          <Text color={i === selected ? "cyan" : undefined} bold={i === selected}>
            {i === selected ? "▸ " : "  "}
            {skill.skillRef}
          </Text>
          <Text dimColor>  "{skill.description}"</Text>
        </Box>
      ))}
    </Box>
  );
}
```

### Preview Component

```typescript
// apps/cli/src/commands/browse/Preview.tsx
import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { readFile } from "fs/promises";

interface Props {
  skill: Skill | undefined;
}

export function Preview({ skill }: Props) {
  const [content, setContent] = useState("");

  useEffect(() => {
    if (skill) {
      readFile(skill.path, "utf-8").then(setContent);
    }
  }, [skill?.path]);

  return (
    <Box flexDirection="column" width="50%" borderStyle="single">
      <Text>{content.slice(0, 1000)}</Text>
      {content.length > 1000 && <Text dimColor>... (scroll for more)</Text>}
    </Box>
  );
}
```

### CLI Entry

```typescript
// apps/cli/src/commands/browse/index.ts
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { App } from "./App";

export const browseCommand = new Command("browse")
  .description("Interactive skill browser")
  .option("-s, --source <ns>", "Start filtered by source")
  .option("--preview", "Enable live preview (default: true)")
  .action((options) => {
    if (!process.stdout.isTTY) {
      console.error("browse requires an interactive terminal");
      process.exit(1);
    }

    render(<App initialSource={options.source} showPreview={options.preview} />);
  });
```

## Considerations

### Terminal Compatibility

- Requires TTY (not compatible with pipes)
- Graceful fallback to `skillset list` in non-TTY
- Test on various terminal emulators

### Performance

- Lazy-load skill content for preview
- Debounce filter input
- Virtualize list for large skill sets

### Accessibility

- Keyboard-only navigation
- Screen reader support (if possible with TUI)
- High-contrast mode option

## Dependencies

- `ink` (React for CLI) - Recommended
- OR `blessed` / `blessed-contrib` - More powerful, steeper learning curve
- Optional: `clipboardy` for clipboard support
- Optional: `marked` for markdown rendering

## Checklist

- [ ] Choose TUI framework (ink vs blessed)
- [ ] Implement main App component
- [ ] Implement SkillList component
- [ ] Implement Preview component
- [ ] Implement FilterBar component
- [ ] Add keyboard navigation
- [ ] Add source filtering
- [ ] Add text filtering with debounce
- [ ] Add "Load" action (output to stdout)
- [ ] Add "Alias" action
- [ ] Add "Copy" action
- [ ] Add "Open in editor" action
- [ ] Add TTY detection with fallback
- [ ] Test on various terminals
- [ ] Document in README
