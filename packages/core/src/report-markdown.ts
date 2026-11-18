/** Render untrusted report text as passive CommonMark code, including embedded backticks. */
export function renderInlineCode(value: string): string {
  let longestRun = 0;
  let currentRun = 0;
  for (const character of value) {
    if (character === "`") {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  const fence = "`".repeat(longestRun + 1);
  const pad =
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value.startsWith("`") ||
    value.endsWith("`")
      ? " "
      : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}
