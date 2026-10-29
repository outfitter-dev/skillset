import { describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildSkillset, buildSkillsetResult, diffSkillsetResult, verifySkillset } from "@skillset/core";
import { createOperationalPathContext, resolveOperationalPath } from "../operational-cache";
import { checkAdapterConformance } from "../adapter-conformance";
import { loadBuildGraph } from "../resolver";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const authored = "# Repository guidance\r\n\r\nPreserve this prose and its bytes.\r\n";
const config = "# Authored config\nskillset:\n  name: native-rules\ncompile:\n  targets: [claude, codex]\n";

async function fixture(explicit = false): Promise<string> {
  const root = await createTestFixtureRoot("skillset-native-rules-");
  await mkdir(join(root, ".skillset/rules/src"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), config + (explicit ? "workspace:\n  nativeAgents: true\n" : ""));
  await writeFile(join(root, "AGENTS.md"), authored);
  await writeFile(join(root, ".skillset/rules/src/testing.md"), "# Tests\n\nCover behavior.\n");
  return root;
}

describe("native root rule source", () => {
  it("keeps native source bytes while deriving Claude and scoped guidance", async () => {
    const root = await fixture(true);
    const graph = await loadBuildGraph(root);
    expect(graph.rules.find((rule) => rule.rootFrontPage)?.sourcePath).toBe(join(root, "AGENTS.md"));
    const files = await buildSkillset(root);
    expect(files.map((file) => file.path)).not.toContain("AGENTS.md");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(authored);
    expect(await readFile(join(root, ".claude/CLAUDE.md"), "utf8")).toContain("Preserve this prose");
    expect(await readFile(join(root, "src/AGENTS.md"), "utf8")).toContain("Cover behavior");
    const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8"));
    expect(lock.items.flatMap((item: { files: string[] }) => item.files)).not.toContain("AGENTS.md");
    expect((await verifySkillset(root)).failures).toEqual([]);
  });

  it("previews discovery without writes, persists it on build, and repeats cleanly", async () => {
    const root = await fixture();
    const preview = await diffSkillsetResult(root);
    expect(preview.ok).toBe(true);
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
    await buildSkillset(root);
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("nativeAgents: true");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(authored);
    expect((await verifySkillset(root)).failures).toEqual([]);
    await buildSkillset(root);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(authored);
  });

  it("rejects competing front-page and unscoped rule sources", async () => {
    const root = await fixture(true);
    await writeFile(join(root, ".skillset/RULES.md"), "# Competing source\n");
    await expect(loadBuildGraph(root)).rejects.toThrow("RULES.md");
    const scoped = await fixture(true);
    await writeFile(join(scoped, ".skillset/rules/testing.md"), "# Root rule\n");
    await expect(loadBuildGraph(scoped)).rejects.toThrow("AGENTS.md");
  });

  it("leaves config and authored root untouched when another output collides", async () => {
    const root = await fixture();
    await mkdir(join(root, ".claude"));
    await writeFile(join(root, ".claude/CLAUDE.md"), "# Other authored guidance\n");
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(false);
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(authored);
  });

  it("does not turn an edited managed root into authored source", async () => {
    const root = await fixture();
    await rm(join(root, "AGENTS.md"));
    await writeFile(join(root, ".skillset/RULES.md"), "# Managed front page\n");
    await buildSkillset(root);
    await writeFile(join(root, "AGENTS.md"), "# Hand edit\n");
    const graph = await loadBuildGraph(root);
    expect(graph.root.workspace.nativeAgents).toBeUndefined();
    expect((await diffSkillsetResult(root)).data.changed).toContain("AGENTS.md");
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
  });

  it("records native-only consumers without claiming authored output", async () => {
    const root = await fixture();
    await rm(join(root, ".skillset/rules"), { recursive: true });
    await writeFile(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n");
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    expect(result.data.map((file) => file.path)).not.toContain("AGENTS.md");
    const outcome = result.renderResults.find((item) => item.standardProfile === "agent-instructions" && item.sourceUnit === "rule:RULES");
    expect(outcome?.status).toBe("externally_managed");
    expect(outcome?.outputs ?? []).toEqual([]);
    const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8"));
    expect(lock.items).toEqual([]);
    expect(lock.renderResults).toContainEqual(expect.objectContaining({ status: "externally_managed", sourcePath: "AGENTS.md" }));
    expect((await verifySkillset(root)).failures).toEqual([]);
    if (outcome === undefined) throw new Error("missing native root outcome");
    const cases = [{ featureId: "project-instructions", standardProfile: "agent-instructions" as const }];
    expect(checkAdapterConformance([outcome], cases).ok).toBe(true);
    for (const invalid of [
      { ...outcome, sourcePath: "other.md" },
      { ...outcome, sourceUnit: "rule:other" },
      { ...outcome, outputs: [{ path: "AGENTS.md" }] },
      { ...outcome, diagnostics: [] },
    ]) expect(checkAdapterConformance([invalid], cases).ok).toBe(false);
  });

  it("fails closed for missing declared source, symlinks, and corrupt ownership evidence", async () => {
    const missing = await fixture(true);
    await rm(join(missing, "AGENTS.md"));
    await expect(loadBuildGraph(missing)).rejects.toThrow("requires authored root AGENTS.md");
    const linked = await fixture();
    await rm(join(linked, "AGENTS.md"));
    await writeFile(join(linked, "other.md"), authored);
    await symlink("other.md", join(linked, "AGENTS.md"));
    await expect(loadBuildGraph(linked)).rejects.toThrow("regular file");
    const corrupt = await fixture();
    await writeFile(join(corrupt, "skillset.lock"), "{invalid");
    await expect(loadBuildGraph(corrupt)).rejects.toThrow();
    expect(await readFile(join(corrupt, "skillset.yaml"), "utf8")).toBe(config);
  });

  it("keeps native macros literal and rebuilds projections when authored prose changes", async () => {
    const root = await fixture();
    const literal = "# Guidance\n\n{{not_a_skillset_macro}}\n";
    await writeFile(join(root, "AGENTS.md"), literal);
    await buildSkillset(root);
    expect(await readFile(join(root, ".claude/CLAUDE.md"), "utf8")).toContain("{{not_a_skillset_macro}}");
    await writeFile(join(root, "AGENTS.md"), literal + "New guidance.\n");
    const diff = await diffSkillsetResult(root);
    expect(diff.data.changed).toContain(".claude/CLAUDE.md");
    await buildSkillset(root);
    expect(await readFile(join(root, ".claude/CLAUDE.md"), "utf8")).toContain("New guidance.");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(literal + "New guidance.\n");
  });

  it("isolated output does not persist native selection into the live config", async () => {
    const root = await fixture();
    await buildSkillset(root, { isolated: true });
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(authored);
    expect(await Bun.file(resolveOperationalPath(createOperationalPathContext(root), ".skillset/cache/latest/.claude/CLAUDE.md")).exists()).toBe(true);
    expect(await Bun.file(join(root, ".claude/CLAUDE.md")).exists()).toBe(false);
  });

  it("rolls back native selection when an unscoped rule appears during staging or installation", async () => {
    for (const phase of ["beforeInitialInspection", "beforeWriteInstall"] as const) {
      const root = await fixture();
      const path = join(root, ".skillset/rules/late.md");
      await expect(buildSkillsetResult(root, {}, { transactionOptions: { testHooks: {
        [phase]: async () => { await writeFile(path, "# Concurrent root guidance\n"); },
      } } })).rejects.toThrow("read-only directory file set changed");
      expect(await readFile(path, "utf8")).toBe("# Concurrent root guidance\n");
      expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
      expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(authored);
      expect(await Bun.file(join(root, ".claude/CLAUDE.md")).exists()).toBe(false);
    }
  });

  it("preserves late ownership evidence and rejects changes to declared configuration", async () => {
    const root = await fixture();
    await expect(buildSkillsetResult(root, {}, { transactionOptions: { testHooks: {
      beforeInitialInspection: async () => { await writeFile(join(root, "skillset.lock"), "concurrent ownership evidence"); },
    } } })).rejects.toThrow();
    expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe("concurrent ownership evidence");
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
    const declared = await fixture(true);
    const changed = config + "workspace:\n  nativeAgents: true\n# Concurrent edit\n";
    await expect(buildSkillsetResult(declared, {}, { transactionOptions: { testHooks: {
      beforeWriteInstall: async () => { await writeFile(join(declared, "skillset.yaml"), changed); },
    } } })).rejects.toThrow("read-only input changed");
    expect(await readFile(join(declared, "skillset.yaml"), "utf8")).toBe(changed);
    expect(await Bun.file(join(declared, ".claude/CLAUDE.md")).exists()).toBe(false);
  });

  it("preserves a configuration edit racing transaction staging", async () => {
    const root = await fixture();
    const changed = config + "# Concurrent author change\n";
    await expect(buildSkillsetResult(root, {}, { transactionOptions: { testHooks: {
      beforeInitialInspection: async () => {
        await writeFile(join(root, "skillset.yaml"), changed);
      },
    } } })).rejects.toThrow("preimage changed");
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(changed);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(authored);
    expect(await Bun.file(join(root, ".claude/CLAUDE.md")).exists()).toBe(false);
  });

  it("rolls back config and output if native prose changes during the transaction", async () => {
    const root = await fixture();
    const changed = "# Concurrent authored guidance\n";
    await expect(buildSkillsetResult(root, {}, { transactionOptions: { testHooks: {
      beforeWriteInstall: async () => {
        await writeFile(join(root, "AGENTS.md"), changed);
      },
    } } })).rejects.toThrow("read-only input changed");
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(changed);
    expect(await Bun.file(join(root, ".claude/CLAUDE.md")).exists()).toBe(false);
  });

});
