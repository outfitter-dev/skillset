import { styleText } from "node:util";

export interface TerminalRenderOptions {
  readonly color?: boolean;
  readonly width?: number;
}

export interface TerminalRenderer {
  readonly accent: (value: string) => string;
  readonly bold: (value: string) => string;
  readonly dim: (value: string) => string;
  readonly width: number;
  readonly wrap: (value: string, indent?: number) => string;
}

export interface TerminalColorContext {
  readonly isTTY?: boolean;
  readonly noColor?: string;
  readonly term?: string;
}

const MIN_WIDTH = 32;
const DEFAULT_WIDTH = 80;

export function createTerminalRenderer(
  options: TerminalRenderOptions = {}
): TerminalRenderer {
  const color = options.color ?? terminalColorEnabled();
  const width = Math.max(
    MIN_WIDTH,
    options.width ?? process.stdout.columns ?? DEFAULT_WIDTH
  );
  const apply = (
    format: Parameters<typeof styleText>[0],
    value: string
  ): string => (color ? styleText(format, value) : value);

  return {
    accent: (value) => apply("cyan", value),
    bold: (value) => apply("bold", value),
    dim: (value) => apply("dim", value),
    width,
    wrap: (value, indent = 0) => wrapWithIndent(value, width, indent),
  };
}

export function renderDefinitionList(
  renderer: TerminalRenderer,
  entries: readonly { readonly label: string; readonly value: string }[],
  indent = 2
): string {
  if (entries.length === 0) return "";
  const available = renderer.width - indent;
  const longest = Math.max(
    ...entries.map((entry) => Bun.stringWidth(entry.label))
  );
  const labelWidth = Math.min(longest, Math.max(12, available - 26));
  const inline = available - labelWidth - 2 >= 24;
  return entries
    .map((entry) => {
      if (!inline || Bun.stringWidth(entry.label) > labelWidth) {
        return `${" ".repeat(indent)}${entry.label}\n${renderer.wrap(entry.value, indent + 2)}`;
      }
      const padding = " ".repeat(labelWidth - Bun.stringWidth(entry.label) + 2);
      const prefix = `${" ".repeat(indent)}${entry.label}${padding}`;
      const wrapped = Bun.wrapAnsi(
        entry.value,
        Math.max(8, renderer.width - Bun.stringWidth(prefix))
      );
      return `${prefix}${wrapped.replaceAll("\n", `\n${" ".repeat(Bun.stringWidth(prefix))}`)}`;
    })
    .join("\n");
}

export function terminalColorEnabled(
  context: TerminalColorContext = {
    isTTY: process.stdout.isTTY,
    ...(process.env.NO_COLOR === undefined
      ? {}
      : { noColor: process.env.NO_COLOR }),
    ...(process.env.TERM === undefined ? {} : { term: process.env.TERM }),
  }
): boolean {
  return (
    context.isTTY === true &&
    context.noColor === undefined &&
    context.term !== "dumb"
  );
}

function wrapWithIndent(value: string, width: number, indent: number): string {
  const prefix = " ".repeat(indent);
  return Bun.wrapAnsi(value, Math.max(8, width - indent))
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
