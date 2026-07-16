import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePagination,
  usePrefix,
  useState,
} from "@inquirer/core";

import type {
  PromptChoice,
  PromptContext,
  SearchCheckboxPrompt,
} from "./prompt-adapter";

const valuesMatch = (left: unknown, right: unknown): boolean =>
  Object.is(left, right);

const disabledLabel = (choice: PromptChoice<unknown>): string => {
  if (choice.disabled === true) {
    return " (disabled)";
  }
  if (typeof choice.disabled === "string") {
    return ` ${choice.disabled}`;
  }
  return "";
};

const renderChoice = (
  choice: PromptChoice<unknown>,
  isActive: boolean,
  selected: readonly unknown[]
): string => {
  const cursor = isActive ? "❯" : " ";
  const checked = selected.some((value) => valuesMatch(value, choice.value));
  const marker = checked ? "◉" : "◯";
  return `${cursor}${marker} ${choice.name}${disabledLabel(choice)}`;
};

const searchCheckboxPrompt = createPrompt<
  readonly unknown[],
  SearchCheckboxPrompt<unknown>
>((config, done) => {
  const { pageSize = 7, required = false } = config;
  const theme = makeTheme();
  const [status, setStatus] = useState<"done" | "idle">("idle");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<readonly unknown[]>(
    config.choices
      .filter((choice) => choice.checked && !choice.disabled)
      .map((choice) => choice.value)
  );
  const prefix = usePrefix({ status, theme });
  const visible = config.source(query || undefined, config.choices);
  const selectable = visible.filter((choice) => !choice.disabled);
  const activeIndex = selectable.length === 0 ? -1 : active % selectable.length;
  const activeChoice = selectable[activeIndex];
  const activeVisibleIndex =
    activeChoice === undefined ? -1 : visible.indexOf(activeChoice);

  useKeypress((key, readline) => {
    if (isEnterKey(key)) {
      if (required && selected.length === 0) {
        readline.clearLine(0);
        readline.write(query);
        setError("At least one choice must be selected");
        return;
      }
      setStatus("done");
      done(selected);
      return;
    }
    if (isUpKey(key) || isDownKey(key)) {
      readline.clearLine(0);
      readline.write(query);
      if (selectable.length > 0) {
        const offset = isUpKey(key) ? -1 : 1;
        setActive(
          (activeIndex + offset + selectable.length) % selectable.length
        );
      }
      return;
    }
    if (isSpaceKey(key)) {
      readline.clearLine(0);
      readline.write(query);
      if (activeChoice !== undefined) {
        setError(undefined);
        setSelected(
          selected.some((value) => valuesMatch(value, activeChoice.value))
            ? selected.filter(
                (value) => !valuesMatch(value, activeChoice.value)
              )
            : [...selected, activeChoice.value]
        );
      }
      return;
    }
    setActive(0);
    setError(undefined);
    setQuery(readline.line);
  });

  const message = theme.style.message(config.message, status);
  if (status === "done") {
    const names = config.choices
      .filter((choice) =>
        selected.some((value) => valuesMatch(value, choice.value))
      )
      .map((choice) => choice.name);
    return [prefix, message, theme.style.answer(names.join(", "))]
      .filter(Boolean)
      .join(" ");
  }

  const page = usePagination({
    active: Math.max(activeVisibleIndex, 0),
    items: visible,
    loop: false,
    pageSize,
    renderItem: ({ item, isActive }) => renderChoice(item, isActive, selected),
  });
  const header = [prefix, message, theme.style.highlight(query)]
    .filter(Boolean)
    .join(" ")
    .trimEnd();
  const description = activeChoice?.description;
  const body = [
    visible.length === 0 ? theme.style.error("No results found") : page,
    description === undefined ? undefined : theme.style.highlight(description),
    error === undefined ? undefined : theme.style.error(error),
    theme.style.help("Type to filter • ↑↓ navigate • space select • ⏎ submit"),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
  return [header, body];
});

export const runSearchCheckbox = <Value>(
  prompt: SearchCheckboxPrompt<Value>,
  context: PromptContext
): Promise<readonly Value[]> =>
  searchCheckboxPrompt(
    prompt as SearchCheckboxPrompt<unknown>,
    context
  ) as Promise<readonly Value[]>;
