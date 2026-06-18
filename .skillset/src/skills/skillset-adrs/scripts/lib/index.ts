import { writeFileSync } from 'node:fs';
import { INDEX_PATH } from './paths.ts';
import { listNumberedAdrs, parseAdrNumber, padNumber } from './discovery.ts';

const formatStatus = (status: string, amended: unknown): string => {
  const capitalStatus = status.charAt(0).toUpperCase() + status.slice(1);
  if (typeof amended !== 'string' || amended.length === 0) {
    return capitalStatus;
  }
  return `${capitalStatus} (amended ${amended})`;
};

export const rebuildIndex = (): void => {
  const adrs = listNumberedAdrs();
  const rows = adrs.map((adr) => {
    const num = parseAdrNumber(adr.filename);
    const displayNum = num === null ? '????' : padNumber(num);
    const title = adr.title.replace(/^ADR-\d+:\s*/, '');
    const status = String(adr.frontmatter.status ?? 'unknown');
    const displayStatus = formatStatus(status, adr.frontmatter.amended);
    return `| [${displayNum}](${adr.filename}) | ${title} | ${displayStatus} |`;
  });

  const content = `# Architecture Decision Records

ADRs document the significant design decisions behind Skillset: choices that, if reversed, would change the source contract, target rendering model, compiler promises, or authoring workflow. They capture the context, the decision, the consequences, and the alternatives considered.

## Conventions

- Numbered ADRs live at \`docs/adrs/NNNN-slug.md\`.
- Draft ADRs live at \`docs/adrs/drafts/YYYYMMDD-slug.md\`.
- New ADRs should start from [template.md](template.md).
- Owners use \`['[galligan](https://github.com/galligan)']\` until a decision changes repository ownership metadata.
- Use \`bun scripts/adr.ts check\` before handoff and \`bun scripts/adr.ts map\` after ADR lifecycle changes.

## Index

| ADR | Title | Status |
| --- | --- | --- |
${rows.join('\n')}
`;

  writeFileSync(INDEX_PATH, content, 'utf8');
  console.log(`Updated ${INDEX_PATH}`);
};
