/**
 * Parse markdown content and extract heading structure.
 * Only used for SKILL.md files.
 */

export interface HeadingNode {
  level: number;
  text: string;
  children: HeadingNode[];
}

/**
 * Parse markdown content into a heading tree structure.
 * Only captures ## and ### headings (ignores # as that's usually the title).
 */
export function parseMarkdownHeadings(content: string): HeadingNode[] {
  const lines = content.split("\n");
  const headings: { level: number; text: string }[] = [];

  let inCodeBlock = false;

  for (const line of lines) {
    // Track code blocks to skip headings inside them
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    // Match ## and ### headings
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match?.[1] && match[2]) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
      });
    }
  }

  return buildHeadingTree(headings);
}

/**
 * Build a tree from flat heading list based on levels.
 */
function buildHeadingTree(
  headings: { level: number; text: string }[]
): HeadingNode[] {
  const root: HeadingNode[] = [];
  const stack: { node: HeadingNode; level: number }[] = [];

  for (const { level, text } of headings) {
    const node: HeadingNode = { level, text, children: [] };

    // Pop stack until we find a parent with lower level
    while (stack.length > 0) {
      const last = stack[stack.length - 1];
      if (last && last.level < level) break;
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      const parent = stack[stack.length - 1];
      parent?.node.children.push(node);
    }

    stack.push({ node, level });
  }

  return root;
}

/**
 * Convert heading tree to object-treeify compatible format.
 */
export function headingsToTreeObject(
  headings: HeadingNode[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const heading of headings) {
    const prefix = "#".repeat(heading.level);
    const key = `${prefix} ${heading.text}`;

    if (heading.children.length > 0) {
      result[key] = headingsToTreeObject(heading.children);
    } else {
      result[key] = null;
    }
  }

  return result;
}
