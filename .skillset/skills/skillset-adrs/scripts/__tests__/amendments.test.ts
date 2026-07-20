import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildAmendedBy, validateAmendments } from "../lib/amendments.ts";
import { parseFrontmatter, serializeFrontmatter } from "../lib/frontmatter.ts";
import type { AdrFile, Frontmatter } from "../lib/frontmatter.ts";

const adr = (
  filename: string,
  status: string,
  frontmatter: Partial<Frontmatter> = {}
): AdrFile => ({
  body: "",
  filename,
  frontmatter: { status, ...frontmatter },
  path: filename.includes("draft")
    ? `/repo/docs/adrs/drafts/${filename}`
    : `/repo/docs/adrs/${filename}`,
  raw: "",
  title: "",
});

const messages = (numbered: AdrFile[], drafts: AdrFile[] = []): string[] =>
  validateAmendments(numbered, drafts).map((issue) => issue.message);

const commandDocument = (
  frontmatter: string,
  heading: string
): string => `---
${frontmatter}
---

# ${heading}

## Context

Context.

## Decision

Decision.

## Consequences

Consequences.

## References
`;

const snapshotCommandFiles = async (
  root: string,
  paths: string[]
): Promise<{ files: Record<string, string>; status: string }> => {
  const files = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, await Bun.file(join(root, path)).text()])
    )
  );
  const status = new TextDecoder().decode(
    Bun.spawnSync(["git", "status", "--porcelain=v1"], {
      cwd: root,
      stdout: "pipe",
    }).stdout
  );
  return { files, status };
};

const writeGeneratedSentinels = async (root: string): Promise<string[]> => {
  const paths = [
    "docs/adrs/README.md",
    "docs/adrs/decision-map.json",
    "docs/adrs/drafts/README.md",
    "docs/adrs/drafts/decision-map.json",
  ];
  await Promise.all(
    paths.map((path) => Bun.write(join(root, path), `unchanged:${path}\n`))
  );
  return paths;
};

describe("ADR amendment frontmatter", () => {
  test("round-trips source-authored amends as normalized ADR ids", () => {
    const raw = `---
slug: narrower-contract
status: draft
amends: [1, '2']
---

# ADR: Narrower Contract
`;

    const parsed = parseFrontmatter(raw);
    expect(parsed.frontmatter.amends).toEqual(["1", "2"]);

    const serialized = serializeFrontmatter(parsed.frontmatter);
    expect(serialized).toContain("amends: [1, 2]");
    expect(
      parseFrontmatter(`${serialized}\n${parsed.body}`).frontmatter.amends
    ).toEqual(["1", "2"]);
  });

  test("parses generic empty bracket lists without phantom entries", () => {
    const raw = `---
slug: empty-relations
status: draft
owners: []
depends_on: []
amends: []
superseded_by: []
---

# ADR: Empty Relations
`;

    const parsed = parseFrontmatter(raw);
    expect(parsed.frontmatter.owners).toEqual([]);
    expect(parsed.frontmatter.depends_on).toEqual([]);
    expect(parsed.frontmatter.amends).toEqual([]);
    expect(parsed.frontmatter.superseded_by).toEqual([]);
    expect(validateAmendments([], [
      adr("20260720-empty-relations.md", "draft", parsed.frontmatter),
    ])).toEqual([]);

    const serialized = serializeFrontmatter(parsed.frontmatter);
    expect(serialized).not.toContain("amends: []");
    expect(serialized).not.toContain("depends_on: []");
  });

  test("promotion-style metadata preserves authored amends", () => {
    const draft = adr("20260720-narrower-contract.md", "draft", {
      amends: ["1"],
      slug: "narrower-contract",
    });
    const promoted: Frontmatter = {
      ...draft.frontmatter,
      id: 2,
      status: "accepted",
    };

    const reparsed = parseFrontmatter(`${serializeFrontmatter(promoted)}\n`);
    expect(reparsed.frontmatter.amends).toEqual(["1"]);
  });
});

describe("ADR amendment activation", () => {
  test("draft and proposed declarations stay prospective", () => {
    const accepted = adr("0001-base.md", "accepted");
    const proposed = adr("0002-proposal.md", "proposed", { amends: ["1"] });
    const draft = adr("20260720-draft-change.md", "draft", { amends: ["1"] });

    expect(validateAmendments([accepted, proposed], [draft])).toEqual([]);
    expect(buildAmendedBy([accepted, proposed])).toEqual(new Map());
  });

  test("accepted successors derive reciprocal amended_by without source mutation", () => {
    const base = adr("0001-base.md", "accepted");
    const successor = adr("0002-successor.md", "accepted", { amends: ["1"] });
    const before = structuredClone(base.frontmatter);

    expect(validateAmendments([base, successor], [])).toEqual([]);
    expect(buildAmendedBy([base, successor])).toEqual(new Map([[1, ["2"]]]));
    expect(base.frontmatter).toEqual(before);
  });

  test("command-style superseded_by evidence retains activated amendment edges", () => {
    const base = adr("0001-base.md", "superseded", {
      superseded_by: ["3"],
    });
    const successor = adr("0002-successor.md", "superseded", {
      amends: ["1"],
      superseded_by: ["3"],
    });
    const replacement = adr("0003-replacement.md", "accepted");

    expect(validateAmendments([base, successor, replacement], [])).toEqual([]);
    expect(buildAmendedBy([base, successor, replacement])).toEqual(
      new Map([[1, ["2"]]])
    );
  });

  test("direct superseded status neither proves acceptance nor activates", () => {
    const base = adr("0001-base.md", "accepted");
    const successor = adr("0002-successor.md", "superseded", {
      amends: ["1"],
    });

    expect(messages([base, successor])).toContain(
      "superseded ADR with amends requires accepted later superseded_by replacements as acceptance-history evidence"
    );
    expect(buildAmendedBy([base, successor])).toEqual(new Map());
  });

  test.each(["proposed", "rejected"])(
    "%s replacements do not prove superseded acceptance history",
    (replacementStatus) => {
      const base = adr("0001-base.md", "accepted");
      const successor = adr("0002-successor.md", "superseded", {
        amends: ["1"],
        superseded_by: ["3"],
      });
      const replacement = adr(
        "0003-replacement.md",
        replacementStatus
      );

      expect(messages([base, successor, replacement])).toContain(
        "superseded ADR with amends requires accepted later superseded_by replacements as acceptance-history evidence"
      );
      expect(buildAmendedBy([base, successor, replacement])).toEqual(
        new Map()
      );
    }
  );

  test("recursively accepted supersession chains preserve history", () => {
    const base = adr("0001-base.md", "accepted");
    const successor = adr("0002-successor.md", "superseded", {
      amends: ["1"],
      superseded_by: ["3"],
    });
    const replacement = adr("0003-replacement.md", "superseded", {
      superseded_by: ["4"],
    });
    const finalReplacement = adr("0004-final.md", "accepted");
    const files = [base, successor, replacement, finalReplacement];

    expect(validateAmendments(files, [])).toEqual([]);
    expect(buildAmendedBy(files)).toEqual(new Map([[1, ["2"]]]));
  });

  test("cyclic supersession claims terminate without proving history", () => {
    const base = adr("0001-base.md", "accepted");
    const successor = adr("0002-successor.md", "superseded", {
      amends: ["1"],
      superseded_by: ["3"],
    });
    const replacement = adr("0003-replacement.md", "superseded", {
      superseded_by: ["2"],
    });

    expect(messages([base, successor, replacement])).toContain(
      "superseded ADR with amends requires accepted later superseded_by replacements as acceptance-history evidence"
    );
    expect(buildAmendedBy([base, successor, replacement])).toEqual(new Map());
  });

  test("promote --supersedes writes lifecycle evidence that preserves an accepted amendment", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-adr-amendment-"));
    const numberedDir = join(root, "docs/adrs");
    const draftsDir = join(numberedDir, "drafts");
    const script = join(import.meta.dir, "../adr.ts");
    const document = (
      frontmatter: string,
      heading: string
    ): string => `---
${frontmatter}
---

# ${heading}

## Context

Context.

## Decision

Decision.

## Consequences

Consequences.

## References
`;

    try {
      await mkdir(draftsDir, { recursive: true });
      await Bun.write(
        join(numberedDir, "0001-base.md"),
        document(
          "id: 1\nslug: base\ntitle: Base\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']",
          "ADR-0001: Base"
        )
      );
      await Bun.write(
        join(numberedDir, "0002-amendment.md"),
        document(
          "id: 2\nslug: amendment\ntitle: Amendment\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']\namends: [1]",
          "ADR-0002: Amendment"
        )
      );
      await Bun.write(
        join(draftsDir, "20260720-replacement.md"),
        document(
          "slug: replacement\ntitle: Replacement\nstatus: draft\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']",
          "ADR: Replacement"
        )
      );
      Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });
      Bun.spawnSync(["git", "add", "docs"], { cwd: root });

      const promoted = Bun.spawnSync([
        process.execPath,
        script,
        "promote",
        "replacement",
        "--supersedes",
        "2",
        "--yes",
      ], { cwd: root, stderr: "pipe", stdout: "pipe" });
      expect(promoted.exitCode).toBe(0);

      const baseParsed = parseFrontmatter(
        await Bun.file(join(numberedDir, "0001-base.md")).text()
      );
      const amendmentParsed = parseFrontmatter(
        await Bun.file(join(numberedDir, "0002-amendment.md")).text()
      );
      const replacementParsed = parseFrontmatter(
        await Bun.file(join(numberedDir, "0003-replacement.md")).text()
      );
      const files = [
        adr("0001-base.md", "accepted", baseParsed.frontmatter),
        adr("0002-amendment.md", "superseded", amendmentParsed.frontmatter),
        adr("0003-replacement.md", "accepted", replacementParsed.frontmatter),
      ];

      expect(amendmentParsed.frontmatter.superseded_by).toEqual(["3"]);
      expect(validateAmendments(files, [])).toEqual([]);
      expect(buildAmendedBy(files)).toEqual(new Map([[1, ["2"]]]));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("ADR amendment validation", () => {
  const accepted = adr("0001-base.md", "accepted");

  test("rejects authored reciprocal metadata", () => {
    const source = adr("0002-source.md", "accepted", {
      amended_by: ["3"],
    });
    expect(messages([accepted, source])).toContain(
      "amended_by is generated and must not be authored"
    );
  });

  test("rejects draft slugs, missing ids, and non-accepted targets", () => {
    const proposedTarget = adr("0002-proposed.md", "proposed");
    const draftSource = adr("20260720-source-draft.md", "draft", {
      amends: ["base-draft", "9", "2"],
    });
    const result = messages([accepted, proposedTarget], [draftSource]);

    expect(result).toContain(
      'amends target "base-draft" must be an existing numbered ADR id'
    );
    expect(result).toContain(
      "amends target 9 does not exist as a numbered ADR"
    );
    expect(result).toContain(
      "amends target 2 must be accepted (historically accepted superseded ADRs remain eligible)"
    );
  });

  test("rejects duplicate, self, and later-number targets", () => {
    const later = adr("0003-later.md", "accepted");
    const source = adr("0002-source.md", "accepted", {
      amends: ["1", "01", "2", "3"],
    });
    const result = messages([accepted, source, later]);

    expect(result).toContain("duplicate amends target 1");
    expect(result).toContain("ADR 2 cannot amend itself");
    expect(result).toContain("amends target 3 must have a lower number than 2");
  });

  test("rejects amendment cycles explicitly", () => {
    const first = adr("0001-first.md", "accepted", { amends: ["2"] });
    const second = adr("0002-second.md", "accepted", { amends: ["1"] });

    expect(messages([first, second])).toContain(
      "cyclic amends relation: 1 -> 2 -> 1"
    );
  });
});

describe("ADR amendment command mutation safety", () => {
  test("invalid promote preview and apply leave the draft, indexes, maps, and git state unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-adr-promote-guard-"));
    const numberedDir = join(root, "docs/adrs");
    const draftsDir = join(numberedDir, "drafts");
    const script = join(import.meta.dir, "../adr.ts");
    const draftPath = "docs/adrs/drafts/20260720-amendment.md";

    try {
      await mkdir(draftsDir, { recursive: true });
      await Bun.write(
        join(numberedDir, "0001-base.md"),
        commandDocument(
          "id: 1\nslug: base\ntitle: Base\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']",
          "ADR-0001: Base"
        )
      );
      await Bun.write(
        join(root, draftPath),
        commandDocument(
          "slug: amendment\ntitle: Amendment\nstatus: draft\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']\namends: [1]",
          "ADR: Amendment"
        )
      );
      const generatedPaths = await writeGeneratedSentinels(root);
      Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });
      Bun.spawnSync(["git", "add", "docs"], { cwd: root });
      const paths = [draftPath, ...generatedPaths];
      const before = await snapshotCommandFiles(root, paths);

      const command = [
        process.execPath,
        script,
        "promote",
        "amendment",
        "--status",
        "superseded",
      ];
      const previewResult = Bun.spawnSync(command, {
        cwd: root,
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(previewResult.exitCode).not.toBe(0);
      expect(new TextDecoder().decode(previewResult.stderr)).toContain(
        "superseded ADR with amends requires accepted later superseded_by replacements"
      );
      expect(await snapshotCommandFiles(root, paths)).toEqual(before);

      const result = Bun.spawnSync(
        [
          ...command,
          "--yes",
        ],
        { cwd: root, stderr: "pipe", stdout: "pipe" }
      );

      expect(result.exitCode).not.toBe(0);
      expect(new TextDecoder().decode(result.stderr)).toContain(
        "superseded ADR with amends requires accepted later superseded_by replacements"
      );
      expect(await snapshotCommandFiles(root, paths)).toEqual(before);
      expect(await Bun.file(join(numberedDir, "0002-amendment.md")).exists()).toBe(
        false
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("invalid status update preview and apply leave the ADR, indexes, maps, and git state unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-adr-update-guard-"));
    const numberedDir = join(root, "docs/adrs");
    const draftsDir = join(numberedDir, "drafts");
    const script = join(import.meta.dir, "../adr.ts");
    const amendmentPath = "docs/adrs/0002-amendment.md";

    try {
      await mkdir(draftsDir, { recursive: true });
      await Bun.write(
        join(numberedDir, "0001-base.md"),
        commandDocument(
          "id: 1\nslug: base\ntitle: Base\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']",
          "ADR-0001: Base"
        )
      );
      await Bun.write(
        join(root, amendmentPath),
        commandDocument(
          "id: 2\nslug: amendment\ntitle: Amendment\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']\namends: [1]",
          "ADR-0002: Amendment"
        )
      );
      const generatedPaths = await writeGeneratedSentinels(root);
      Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });
      Bun.spawnSync(["git", "add", "docs"], { cwd: root });
      const paths = [amendmentPath, ...generatedPaths];
      const before = await snapshotCommandFiles(root, paths);

      const command = [
        process.execPath,
        script,
        "update",
        "amendment",
        "--status",
        "superseded",
      ];
      const previewResult = Bun.spawnSync(command, {
        cwd: root,
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(previewResult.exitCode).not.toBe(0);
      expect(new TextDecoder().decode(previewResult.stderr)).toContain(
        "superseded ADR with amends requires accepted later superseded_by replacements"
      );
      expect(await snapshotCommandFiles(root, paths)).toEqual(before);

      const result = Bun.spawnSync(
        [
          ...command,
          "--yes",
        ],
        { cwd: root, stderr: "pipe", stdout: "pipe" }
      );

      expect(result.exitCode).not.toBe(0);
      expect(new TextDecoder().decode(result.stderr)).toContain(
        "superseded ADR with amends requires accepted later superseded_by replacements"
      );
      expect(await snapshotCommandFiles(root, paths)).toEqual(before);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("draft predecessors are rejected before promotion mutates the ADR graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-adr-draft-predecessor-"));
    const numberedDir = join(root, "docs/adrs");
    const draftsDir = join(numberedDir, "drafts");
    const script = join(import.meta.dir, "../adr.ts");
    const predecessorPath =
      "docs/adrs/drafts/20260719-draft-predecessor.md";
    const successorPath = "docs/adrs/drafts/20260720-proposed-successor.md";

    try {
      await mkdir(draftsDir, { recursive: true });
      await Bun.write(
        join(numberedDir, "0001-base.md"),
        commandDocument(
          "id: 1\nslug: base\ntitle: Base\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']",
          "ADR-0001: Base"
        )
      );
      await Bun.write(
        join(root, predecessorPath),
        commandDocument(
          "slug: draft-predecessor\ntitle: Draft Predecessor\nstatus: draft\ncreated: 2026-07-19\nupdated: 2026-07-19\nowners: ['owner']\namends: [1]",
          "ADR: Draft Predecessor"
        )
      );
      await Bun.write(
        join(root, successorPath),
        commandDocument(
          "slug: proposed-successor\ntitle: Proposed Successor\nstatus: draft\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']",
          "ADR: Proposed Successor"
        )
      );
      const generatedPaths = await writeGeneratedSentinels(root);
      Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });
      Bun.spawnSync(["git", "add", "docs"], { cwd: root });
      const paths = [predecessorPath, successorPath, ...generatedPaths];
      const before = await snapshotCommandFiles(root, paths);

      const result = Bun.spawnSync(
        [
          process.execPath,
          script,
          "promote",
          "proposed-successor",
          "--status",
          "proposed",
          "--supersedes",
          "draft-predecessor",
          "--yes",
        ],
        { cwd: root, stderr: "pipe", stdout: "pipe" }
      );

      expect(result.exitCode).not.toBe(0);
      expect(new TextDecoder().decode(result.stderr)).toContain(
        "is a draft and cannot be superseded — promote it first"
      );
      expect(await snapshotCommandFiles(root, paths)).toEqual(before);
      expect(
        await Bun.file(join(numberedDir, "0002-proposed-successor.md")).exists()
      ).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("combined slug and renumber preview and apply use one final identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-adr-combined-update-"));
    const numberedDir = join(root, "docs/adrs");
    const draftsDir = join(numberedDir, "drafts");
    const script = join(import.meta.dir, "../adr.ts");
    const originalPath = "docs/adrs/0002-amendment.md";

    try {
      await mkdir(draftsDir, { recursive: true });
      await Bun.write(
        join(numberedDir, "0001-base.md"),
        commandDocument(
          "id: 1\nslug: base\ntitle: Base\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']",
          "ADR-0001: Base"
        )
      );
      await Bun.write(
        join(root, originalPath),
        commandDocument(
          "id: 2\nslug: amendment\ntitle: Amendment\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']\namends: [1]",
          "ADR-0002: Amendment"
        )
      );
      const generatedPaths = await writeGeneratedSentinels(root);
      Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });
      Bun.spawnSync(["git", "add", "docs"], { cwd: root });
      const paths = [originalPath, ...generatedPaths];
      const before = await snapshotCommandFiles(root, paths);
      const command = [
        process.execPath,
        script,
        "update",
        "amendment",
        "--slug",
        "narrower",
        "--renumber",
        "3",
      ];

      const previewResult = Bun.spawnSync(command, {
        cwd: root,
        stderr: "pipe",
        stdout: "pipe",
      });
      const preview = new TextDecoder().decode(previewResult.stdout);

      expect(previewResult.exitCode).toBe(0);
      expect(preview).toContain('Slug → "narrower" (0003-narrower.md)');
      expect(preview).toContain("Renumber → 0003 (0003-narrower.md)");
      expect(preview).not.toContain("0002-narrower.md");
      expect(preview).not.toContain("0003-amendment.md");
      expect(await snapshotCommandFiles(root, paths)).toEqual(before);

      const result = Bun.spawnSync([...command, "--yes"], {
        cwd: root,
        stderr: "pipe",
        stdout: "pipe",
      });
      expect(result.exitCode).toBe(0);

      const finalPath = join(numberedDir, "0003-narrower.md");
      const parsed = parseFrontmatter(await Bun.file(finalPath).text());
      expect(parsed.frontmatter.id).toBe(3);
      expect(parsed.frontmatter.slug).toBe("narrower");
      expect(parsed.body).toContain("# ADR-0003: Amendment");
      expect(await Bun.file(join(root, originalPath)).exists()).toBe(false);
      expect(
        await Bun.file(join(numberedDir, "0002-narrower.md")).exists()
      ).toBe(false);
      expect(
        await Bun.file(join(numberedDir, "0003-amendment.md")).exists()
      ).toBe(false);

      const index = await Bun.file(join(numberedDir, "README.md")).text();
      expect(index).toContain("[0003](0003-narrower.md)");
      const map = await Bun.file(join(numberedDir, "decision-map.json")).json();
      expect(map.entries).toContainEqual(
        expect.objectContaining({
          number: "0003",
          path: "docs/adrs/0003-narrower.md",
          slug: "narrower",
        })
      );
      expect(
        await Bun.file(join(draftsDir, "decision-map.json")).json()
      ).toEqual(expect.objectContaining({ entries: [] }));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("renumber writes the validated final content before a move failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-adr-renumber-seam-"));
    const numberedDir = join(root, "docs/adrs");
    const draftsDir = join(numberedDir, "drafts");
    const script = join(import.meta.dir, "../adr.ts");
    const originalPath = join(numberedDir, "0002-amendment.md");
    const destinationPath = join(numberedDir, "0003-amendment.md");

    try {
      await mkdir(draftsDir, { recursive: true });
      await Bun.write(
        join(numberedDir, "0001-base.md"),
        commandDocument(
          "id: 1\nslug: base\ntitle: Base\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']",
          "ADR-0001: Base"
        )
      );
      await Bun.write(
        originalPath,
        commandDocument(
          "id: 2\nslug: amendment\ntitle: Amendment\nstatus: accepted\ncreated: 2026-07-20\nupdated: 2026-07-20\nowners: ['owner']\namends: [1]",
          "ADR-0002: Amendment"
        )
      );
      Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });
      Bun.spawnSync(["git", "add", "docs"], { cwd: root });
      await chmod(numberedDir, 0o555);

      const result = Bun.spawnSync(
        [
          process.execPath,
          script,
          "update",
          "amendment",
          "--renumber",
          "3",
          "--yes",
        ],
        { cwd: root, stderr: "pipe", stdout: "pipe" }
      );

      expect(result.exitCode).not.toBe(0);
      const written = await Bun.file(originalPath).text();
      const parsed = parseFrontmatter(written);
      expect(parsed.frontmatter.id).toBe(3);
      expect(parsed.body).toContain("# ADR-0003: Amendment");
      expect(await Bun.file(destinationPath).exists()).toBe(false);
    } finally {
      await chmod(numberedDir, 0o755).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });
});
