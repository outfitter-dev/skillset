#!/usr/bin/env bun
/* oxlint-disable max-statements, complexity, no-plusplus, no-lonely-if, prefer-destructuring, require-hook -- CLI command implementations */
/**
 * ADR management script for the Skillset project.
 *
 * Commands:
 *   create   — scaffold a new draft ADR
 *   promote  — move a draft to numbered ADR
 *   demote   — move a numbered ADR back to drafts
 *   update   — change title, slug, status, or number of an ADR
 *   check    — validate ADR format and consistency
 *   fix      — auto-fix common issues (number padding, cross-refs)
 *   map      — regenerate decision maps and draft index
 *
 * Usage:
 *   bun scripts/adr.ts create --title "My Decision" --slug my-decision
 *   bun scripts/adr.ts promote 20260401-my-decision
 *   bun scripts/adr.ts demote 0014-my-decision
 *   bun scripts/adr.ts check
 *   bun scripts/adr.ts map
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseArgs, shouldApply, previewBanner, printHelp } from './lib/cli.ts';
import type { Args } from './lib/cli.ts';
import { writeDecisionMap } from './lib/decision-map.ts';
import {
  listNumberedAdrs,
  listDrafts,
  nextAdrNumber,
  padNumber,
  parseAdrNumber,
  resolveAdr,
  today,
  todayCompact,
} from './lib/discovery.ts';
import { extractTitle, serializeFrontmatter } from './lib/frontmatter.ts';
import type { AdrFile, Frontmatter } from './lib/frontmatter.ts';
import { gitMove } from './lib/git.ts';
import { rebuildIndex } from './lib/index.ts';
import { ADR_DIR, DRAFTS_DIR, INDEX_PATH, MAP_PATH } from './lib/paths.ts';
import {
  fixCrossReferences,
  rewriteDraftLinks,
  rewriteFrontmatterSlugRefs,
} from './lib/references.ts';
import { validateAmendments } from './lib/amendments.ts';

const assertValidAmendments = (
  numbered: AdrFile[],
  drafts: AdrFile[]
): void => {
  const amendmentIssues = validateAmendments(numbered, drafts);
  if (amendmentIssues.length === 0) {
    return;
  }
  for (const issue of amendmentIssues) {
    console.error(`Error: ${issue.file}: ${issue.message}`);
  }
  process.exit(1);
};

const replaceAdr = (
  adrs: AdrFile[],
  current: AdrFile,
  candidate: AdrFile
): AdrFile[] =>
  adrs.map((entry) => (entry.path === current.path ? candidate : entry));

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const cmdCreate = (args: Args): void => {
  const { title } = args;
  const slug =
    args.slug ??
    title
      ?.toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '');
  const created = args.created ?? today();

  if (!title) {
    console.error('Error: --title is required');
    process.exit(1);
  }
  if (!slug) {
    console.error('Error: --slug is required (or derived from --title)');
    process.exit(1);
  }

  mkdirSync(DRAFTS_DIR, { recursive: true });

  const filename = `${todayCompact()}-${slug}.md`;
  const path = join(DRAFTS_DIR, filename);

  if (existsSync(path)) {
    console.error(`Error: ${path} already exists`);
    process.exit(1);
  }

  const frontmatter = serializeFrontmatter({
    created,
    owners: ['[galligan](https://github.com/galligan)'],
    slug,
    status: 'draft',
    title,
    updated: created,
  });

  const content = `${frontmatter}

# ADR: ${title}

## Context

## Decision

## Consequences

## References
`;

  writeFileSync(path, content, 'utf8');
  console.log(`Created ${path}`);

  writeDecisionMap();
};

const cmdPromote = (args: Args): void => {
  const ref = args._[1];
  if (!ref) {
    console.error('Error: provide a slug, path, or filename to promote');
    process.exit(1);
  }

  const adr = resolveAdr(ref);
  if (!adr) {
    console.error(`Error: could not find ADR "${ref}"`);
    process.exit(1);
  }

  if (!adr.path.includes('/drafts/')) {
    console.error(`Error: ${adr.filename} is not a draft`);
    process.exit(1);
  }

  const numbered = listNumberedAdrs();
  const drafts = listDrafts();
  assertValidAmendments(numbered, drafts);

  const apply = shouldApply(args);
  previewBanner(args);

  const status = args.status ?? 'accepted';
  const num = nextAdrNumber();
  const padded = padNumber(num);
  const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
  const newFilename = `${padded}-${slug}.md`;
  const newPath = join(ADR_DIR, newFilename);
  const supersededAdr = args.supersedes
    ? resolveAdr(args.supersedes)
    : undefined;

  if (supersededAdr?.path.includes('/drafts/')) {
    console.error(
      `Error: ${supersededAdr.filename} is a draft and cannot be superseded — promote it first`
    );
    process.exit(1);
  }

  console.log(`Promote: ${adr.filename} → ${newFilename} (${status})`);

  if (args.supersedes) {
    if (supersededAdr) {
      console.log(
        `Supersede: ${supersededAdr.filename} → superseded by ${padded}`
      );
    } else {
      console.warn(
        `Warning: could not find ADR "${args.supersedes}" to supersede`
      );
    }
  }

  const cleanTitle =
    adr.frontmatter.title ??
    extractTitle(adr.body)
      .replace(/^ADR(?:-\d+)?:\s*/, '')
      .trim();

  const updatedFm = {
    ...adr.frontmatter,
    id: num,
    slug,
    status,
    title: cleanTitle,
    updated: today(),
  };

  const updatedBody = adr.body.replace(/^#\s+ADR:\s*/m, `# ADR-${padded}: `);
  const content = `${serializeFrontmatter(updatedFm as Frontmatter)}\n${updatedBody}`;
  const promoted: AdrFile = {
    ...adr,
    body: updatedBody,
    filename: newFilename,
    frontmatter: updatedFm,
    path: newPath,
    raw: content,
    title: cleanTitle,
  };
  let candidateNumbered = [...numbered, promoted];
  if (supersededAdr) {
    const superseded: AdrFile = {
      ...supersededAdr,
      frontmatter: {
        ...supersededAdr.frontmatter,
        status: 'superseded',
        superseded_by: [String(num)],
        updated: today(),
      },
    };
    candidateNumbered = replaceAdr(
      candidateNumbered,
      supersededAdr,
      superseded
    );
  }
  assertValidAmendments(
    candidateNumbered,
    drafts.filter((entry) => entry.path !== adr.path)
  );

  if (!apply) {
    return;
  }

  writeFileSync(adr.path, content, 'utf8');

  gitMove(adr.path, newPath);

  // Rewrite all references from draft filename to new numbered filename
  console.log('Rewriting draft references...');
  rewriteDraftLinks(adr.filename, newFilename);

  // Rewrite frontmatter depends_on/superseded_by references in peer drafts
  // from the promoted slug to the new numeric id, so the decision map keeps
  // resolving the dependency after promotion.
  console.log('Rewriting peer draft frontmatter references...');
  rewriteFrontmatterSlugRefs(slug, num);

  if (supersededAdr) {
    const oldFm = {
      ...supersededAdr.frontmatter,
      status: 'superseded',
      superseded_by: [String(num)],
      updated: today(),
    };
    const oldContent = `${serializeFrontmatter(oldFm as Frontmatter)}\n${supersededAdr.body}`;
    writeFileSync(supersededAdr.path, oldContent, 'utf8');
  }

  rebuildIndex();
  writeDecisionMap();
};

const cmdDemote = (args: Args): void => {
  const ref = args._[1];
  if (!ref) {
    console.error('Error: provide a slug, path, number, or filename to demote');
    process.exit(1);
  }

  const adr = resolveAdr(ref);
  if (!adr) {
    console.error(`Error: could not find ADR "${ref}"`);
    process.exit(1);
  }

  if (adr.path.includes('/drafts/')) {
    console.error(`Error: ${adr.filename} is already a draft`);
    process.exit(1);
  }

  const apply = shouldApply(args);
  previewBanner(args);

  const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
  const newFilename = `${todayCompact()}-${slug}.md`;

  console.log(`Demote: ${adr.filename} → drafts/${newFilename}`);

  if (!apply) {
    return;
  }

  mkdirSync(DRAFTS_DIR, { recursive: true });
  const newPath = join(DRAFTS_DIR, newFilename);

  const updatedFm = {
    ...adr.frontmatter,
    id: undefined,
    status: 'draft',
    updated: today(),
  };

  const updatedBody = adr.body.replace(/^#\s+ADR-\d+:\s*/m, '# ADR: ');
  const content = `${serializeFrontmatter(updatedFm as Frontmatter)}\n${updatedBody}`;
  writeFileSync(adr.path, content, 'utf8');

  gitMove(adr.path, newPath);

  rebuildIndex();
  writeDecisionMap();
};

const cmdCheck = (args: Args): void => {
  let errors = 0;
  let warnings = 0;
  let fixes = 0;
  const fix = args.yes === true;

  const report = (level: 'error' | 'warn', file: string, msg: string) => {
    const prefix = level === 'error' ? '✗' : '⚠';
    console.log(`  ${prefix} ${file}: ${msg}`);
    if (level === 'error') {
      errors++;
    } else {
      warnings++;
    }
  };

  const checkAdr = (
    adr: {
      filename: string;
      path: string;
      frontmatter: Frontmatter;
      title: string;
      body: string;
    },
    isDraft: boolean
  ) => {
    const fm = adr.frontmatter;

    if (!fm.status) {
      report('error', adr.filename, 'missing status in frontmatter');
    }
    if (!fm.created) {
      report('error', adr.filename, 'missing created date');
    }
    if (!fm.updated) {
      report('error', adr.filename, 'missing updated date');
    }
    if (!fm.owners || (fm.owners as string[]).length === 0) {
      report('warn', adr.filename, 'missing owners');
    }

    if (isDraft) {
      if (/^ADR-\d+:/.test(adr.title)) {
        report(
          'warn',
          adr.filename,
          'draft has a numbered title — should be "ADR: Title"'
        );
      }
    } else {
      if (!/^ADR-\d+:/.test(adr.title)) {
        report(
          'error',
          adr.filename,
          'numbered ADR missing "ADR-NNNN:" prefix in title'
        );
      }
    }

    const requiredSections = [
      '## Context',
      '## Decision',
      '## Consequences',
      '## References',
    ];
    for (const section of requiredSections) {
      if (!adr.body.includes(section)) {
        report('error', adr.filename, `missing required section: ${section}`);
      }
    }

    if (isDraft && fm.status !== 'draft') {
      report(
        'warn',
        adr.filename,
        `file in drafts/ but status is "${fm.status}"`
      );
    }
    if (!isDraft && fm.status === 'draft') {
      report(
        'error',
        adr.filename,
        'numbered ADR has status "draft" — should be proposed/accepted/rejected/superseded'
      );
    }

    // --- Alignment checks for id/slug/title ---
    const h1Clean = adr.title.replace(/^ADR(?:-\d+)?:\s*/, '').trim();
    const fileSlug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    const fileNum = parseAdrNumber(adr.filename);

    // fm.title vs H1
    if (fm.title) {
      if (fm.title !== h1Clean) {
        report(
          'warn',
          adr.filename,
          `fm.title "${fm.title}" does not match H1 "${h1Clean}"`
        );
        if (fix) {
          const num = parseAdrNumber(adr.filename);
          const prefix = isDraft ? 'ADR:' : `ADR-${padNumber(num ?? 0)}:`;
          const newBody = adr.body.replace(
            /^#\s+ADR(?:-\d+)?:\s*.+$/m,
            `# ${prefix} ${fm.title}`
          );
          const content = `${serializeFrontmatter(fm as Frontmatter)}\n${newBody}`;
          writeFileSync(adr.path, content, 'utf8');
          console.log(`    fixed: rewrote H1 from fm.title`);
          fixes++;
        }
      }
    } else {
      report(
        'warn',
        adr.filename,
        'missing title in frontmatter (backfill recommended)'
      );
    }

    // fm.slug vs filename slug
    if (fm.slug) {
      if (fm.slug !== fileSlug) {
        report(
          'warn',
          adr.filename,
          `fm.slug "${fm.slug}" does not match filename slug "${fileSlug}"`
        );
        if (fix) {
          const numPrefix = adr.filename.match(/^(\d+)-/)?.[1] ?? '';
          const newFilename = `${numPrefix}-${fm.slug}.md`;
          const newPath = join(dirname(adr.path), newFilename);
          gitMove(adr.path, newPath);
          console.log(`    fixed: renamed ${adr.filename} → ${newFilename}`);
          fixes++;
        }
      }
    } else {
      report(
        'warn',
        adr.filename,
        'missing slug in frontmatter (backfill recommended)'
      );
    }

    // fm.id vs filename number (numbered ADRs only)
    if (!isDraft) {
      if (fm.id === undefined) {
        report(
          'warn',
          adr.filename,
          'missing id in frontmatter — backfill recommended'
        );
      } else if (fileNum !== null && fm.id !== fileNum) {
        report(
          'warn',
          adr.filename,
          `fm.id ${fm.id} does not match filename number ${fileNum}`
        );
        if (fix) {
          const padded = padNumber(fm.id);
          const slugPart = adr.filename
            .replace(/^\d+-/, '')
            .replace(/\.md$/, '');
          const newFilename = `${padded}-${slugPart}.md`;
          const newPath = join(ADR_DIR, newFilename);
          gitMove(adr.path, newPath);
          console.log(`    fixed: renamed ${adr.filename} → ${newFilename}`);
          fixes++;
        }
      }
    }
  };

  // Sibling ADR references inside docs/adrs/*.md must be bare filenames.
  // A `../NNNN-*.md` link escapes docs/adrs/ and then re-enters its parent,
  // which 404s on the website and is strictly wrong. Draft references
  // (`drafts/*.md`) and tenets references (`../tenets.md`) stay permitted.
  const checkAdrSiblingLinks = (adr: { filename: string; body: string }) => {
    const siblingLink = /\]\(\.\.\/(\d{4}-[a-z0-9-]+\.md(?:#[^)]*)?)\)/g;
    for (const match of adr.body.matchAll(siblingLink)) {
      report(
        'error',
        adr.filename,
        `sibling ADR reference must be a bare filename, not "../${match[1]}"`
      );
    }

    const tenetsLink = /\]\(\.\.\/\.\.\/tenets\.md((?:#[^)]*)?)\)/g;
    for (const match of adr.body.matchAll(tenetsLink)) {
      report(
        'error',
        adr.filename,
        `tenets reference must be "../tenets.md${match[1] ?? ''}", not "../../tenets.md${match[1] ?? ''}"`
      );
    }
  };

  console.log('Checking numbered ADRs...');
  for (const adr of listNumberedAdrs()) {
    checkAdr(adr, false);
    checkAdrSiblingLinks(adr);
  }

  console.log('Checking drafts...');
  for (const adr of listDrafts()) {
    checkAdr(adr, true);
  }

  console.log('Checking amendment metadata...');
  for (const issue of validateAmendments(listNumberedAdrs(), listDrafts())) {
    report('error', issue.file, issue.message);
  }

  console.log('Checking index...');
  if (existsSync(INDEX_PATH)) {
    const indexContent = readFileSync(INDEX_PATH, 'utf8');
    for (const adr of listNumberedAdrs()) {
      if (!indexContent.includes(adr.filename)) {
        report(
          'error',
          'README.md',
          `numbered ADR ${adr.filename} missing from index`
        );
      }
    }
  } else {
    report('error', 'README.md', 'index file does not exist');
  }

  console.log('Checking decision map...');
  if (!existsSync(MAP_PATH)) {
    report(
      'warn',
      'decision-map.json',
      'decision map does not exist — run "adr map" to generate'
    );
  }

  if (fix && fixes > 0) {
    console.log(`\nApplied ${fixes} fixes. Rebuilding index and map...`);
    rebuildIndex();
    writeDecisionMap();
  }

  console.log(`\n${errors} errors, ${warnings} warnings`);
  if (errors > 0) {
    process.exit(1);
  }
};

const cmdMap = (): void => {
  writeDecisionMap();
};

const cmdUpdate = (args: Args): void => {
  const ref = args._[1];
  if (!ref) {
    console.error('Error: provide a slug, path, number, or filename to update');
    process.exit(1);
  }

  const adr = resolveAdr(ref);
  if (!adr) {
    console.error(`Error: could not find ADR "${ref}"`);
    process.exit(1);
  }

  const apply = shouldApply(args);
  previewBanner(args);

  const changes: string[] = [];
  const isDraft = adr.path.includes('/drafts/');
  const currentPrefix =
    adr.filename.match(/^(\d+)-/)?.[1] ??
    (isDraft ? todayCompact() : '0000');
  const currentSlug = adr.filename
    .replace(/^\d+-/, '')
    .replace(/\.md$/, '');
  let newNumber: number | undefined;

  if (args.renumber) {
    if (isDraft) {
      console.error('Error: cannot renumber a draft — promote it first');
      process.exit(1);
    }
    newNumber = Number(args.renumber);
    if (Number.isNaN(newNumber)) {
      console.error(`Error: invalid number "${args.renumber}"`);
      process.exit(1);
    }
  }

  const finalPrefix =
    newNumber === undefined ? currentPrefix : padNumber(newNumber);
  const finalSlug = args.slug ?? currentSlug;
  const changesIdentity = Boolean(args.slug || args.renumber);
  const finalFilename = changesIdentity
    ? `${finalPrefix}-${finalSlug}.md`
    : adr.filename;
  const finalPath = changesIdentity
    ? join(dirname(adr.path), finalFilename)
    : adr.path;

  if (args.title) {
    changes.push(`Title → "${args.title}"`);
  }
  if (args.slug) {
    changes.push(`Slug → "${args.slug}" (${finalFilename})`);
  }
  if (args.status) {
    changes.push(`Status → "${args.status}"`);
  }
  if (newNumber !== undefined) {
    changes.push(`Renumber → ${finalPrefix} (${finalFilename})`);
  }

  if (changes.length === 0) {
    console.error(
      'Error: no changes specified. Use --title, --slug, --status, or --renumber'
    );
    process.exit(1);
  }

  console.log(`Update: ${adr.filename}`);
  for (const change of changes) {
    console.log(`  ${change}`);
  }

  let { body } = adr;
  const fm = { ...adr.frontmatter };

  if (args.title) {
    const num = parseAdrNumber(adr.filename);
    const prefix = isDraft ? 'ADR:' : `ADR-${padNumber(num ?? 0)}:`;
    body = body.replace(
      /^#\s+ADR(?:-\d+)?:\s*.+$/m,
      `# ${prefix} ${args.title}`
    );
    fm.title = args.title;
    fm.updated = today();
  }

  if (args.slug) {
    fm.slug = args.slug;
  }

  if (args.status) {
    fm.status = args.status;
    fm.updated = today();
  }

  if (newNumber !== undefined) {
    body = body.replace(/^#\s+ADR-\d+:/m, `# ADR-${finalPrefix}:`);
    fm.id = newNumber;
    fm.updated = today();
  }

  const content = `${serializeFrontmatter(fm as Frontmatter)}\n${body}`;
  if (args.slug || args.status || args.renumber) {
    const candidate: AdrFile = {
      ...adr,
      body,
      filename: finalFilename,
      frontmatter: fm,
      path: finalPath,
      raw: content,
    };
    assertValidAmendments(
      replaceAdr(listNumberedAdrs(), adr, candidate),
      replaceAdr(listDrafts(), adr, candidate)
    );
  }

  if (!apply) {
    return;
  }

  writeFileSync(adr.path, content, 'utf8');

  if (finalPath !== adr.path) {
    gitMove(adr.path, finalPath);
  }

  rebuildIndex();
  writeDecisionMap();
};

const cmdFix = (args: Args): void => {
  const apply = shouldApply(args);
  previewBanner(args);
  let fixes = 0;

  console.log('Checking number padding...');
  for (const adr of listNumberedAdrs()) {
    const match = adr.filename.match(/^(\d+)-(.+)$/);
    if (!match) {
      continue;
    }
    const [, numStr, rest] = match;
    if (!numStr || !rest) {
      continue;
    }
    const num = Number(numStr);
    const padded = padNumber(num);

    if (numStr !== padded) {
      const newFilename = `${padded}-${rest}`;
      const newPath = join(ADR_DIR, newFilename);
      console.log(`  ${adr.filename} → ${newFilename}`);

      if (apply) {
        let { body } = adr;
        body = body.replace(
          new RegExp(`^#\\s+ADR-${numStr}:`, 'm'),
          `# ADR-${padded}:`
        );
        const fm = { ...adr.frontmatter, updated: today() };
        const content = `${serializeFrontmatter(fm as Frontmatter)}\n${body}`;
        writeFileSync(adr.path, content, 'utf8');

        gitMove(adr.path, newPath);
      }
      fixes++;
    }
  }

  if (apply && fixes > 0) {
    console.log('Updating cross-references...');
    fixCrossReferences();
    rebuildIndex();
    writeDecisionMap();
  }

  console.log(`\n${fixes} fixes ${apply ? '' : 'would be '}applied`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args._.length === 0) {
    printHelp();
    process.exit(0);
  }

  const command = args._[0];

  switch (command) {
    case 'create': {
      cmdCreate(args);
      break;
    }
    case 'promote': {
      cmdPromote(args);
      break;
    }
    case 'demote': {
      cmdDemote(args);
      break;
    }
    case 'update': {
      cmdUpdate(args);
      break;
    }
    case 'fix': {
      cmdFix(args);
      break;
    }
    case 'check': {
      cmdCheck(args);
      break;
    }
    case 'map': {
      cmdMap();
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
  }
};

main();
