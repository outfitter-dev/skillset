import { describe, expect, test } from "bun:test";
import path from "node:path";

import { parseCliRequest } from "../../apps/skillset/src/cli-args";
import { CliOutputError } from "../../apps/skillset/src/cli-output";
import { USAGE } from "../../apps/skillset/src/cli-usage";
import {
  CLI_ROUTE_FLAGS,
  FINITE_JSON_ROUTES,
  HIDDEN_CLI_ROUTES,
} from "../cli-contract";
import { validateCliContractParity } from "../cli-contract-parity";

describe("SET-305 CLI contract parity", () => {
  test("keeps the parser entrypoint as a small explicit facade", async () => {
    const source = await Bun.file(
      path.join(import.meta.dir, "../../apps/skillset/src/cli-args.ts")
    ).text();
    expect(source.split("\n").length).toBeLessThan(180);
    expect(source.match(/case "[a-z]+":/gu)).toHaveLength(21);
    for (const removed of [
      "ParsedArgs",
      "function parseArgs",
      "createCliRequest",
      "new CliArgReader",
    ]) {
      expect(source).not.toContain(removed);
    }
  });

  test("keeps runtime grammar, public help, and machine output aligned", () => {
    expect(validateCliContractParity()).toEqual([]);
  });

  test("keeps help-required lifecycle operands inside the parser boundary", () => {
    for (const helpFragment of [
      "skillset change add --scope <source-unit> --bump <bump>",
      "skillset change reason <@ref>",
      "skillset change amend <@ref>",
      "skillset change show <@ref>",
      "skillset release amend <@ref>",
    ]) {
      expect(USAGE).toContain(helpFragment);
    }
    expect(USAGE).toContain("skillset change history [@ref]");

    const cases = [
      ["change", "add"],
      ["change", "add", "--scope", "plugin:demo"],
      ["change", "reason", "--reason", "why"],
      ["change", "amend", "--reason", "why"],
      ["change", "show"],
      ["release", "amend", "--reason", "why"],
    ] as const;
    for (const args of cases) {
      try {
        parseCliRequest(args);
        throw new Error(`expected ${args.join(" ")} to fail parsing`);
      } catch (error) {
        expect(error).toBeInstanceOf(CliOutputError);
        expect(error).toMatchObject({ exitCode: 2 });
      }
    }
  });

  test("detects one-surface help and maintained-contract drift", () => {
    const usageWithoutBuildYes = USAGE.replace(
      "skillset build [--yes] ",
      "skillset build "
    );
    expect(
      validateCliContractParity({ usage: usageWithoutBuildYes })
    ).toContainEqual(expect.objectContaining({ surface: "help" }));

    const publicRouteFlags = {
      ...CLI_ROUTE_FLAGS,
      build: CLI_ROUTE_FLAGS.build.filter((flag) => flag !== "--root"),
    };
    expect(validateCliContractParity({ publicRouteFlags })).toContainEqual(
      expect.objectContaining({ surface: "help" })
    );
  });

  test("detects runtime ownership and machine-classification drift", () => {
    const publicRouteFlags = {
      ...CLI_ROUTE_FLAGS,
      build: [...CLI_ROUTE_FLAGS.build, "--write" as const],
    };
    expect(validateCliContractParity({ publicRouteFlags })).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          "build does not accept declared flag --write"
        ),
        surface: "runtime",
      })
    );

    expect(
      validateCliContractParity({
        finiteJsonRoutes: FINITE_JSON_ROUTES.filter(
          (route) => route !== "build"
        ),
      })
    ).toContainEqual(expect.objectContaining({ surface: "structured-output" }));

    for (const surfaces of [
      { finiteJsonRoutes: [...FINITE_JSON_ROUTES, "build"] },
      { jsonlRoutes: ["dev", "build"] },
    ]) {
      expect(validateCliContractParity(surfaces)).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            "build has 2 machine-output classifications"
          ),
          surface: "structured-output",
        })
      );
    }
  });

  test("detects coordinated public and hidden grammar drift", () => {
    const publicRouteFlags = {
      ...CLI_ROUTE_FLAGS,
      status: [...CLI_ROUTE_FLAGS.status, "--scope" as const],
    };
    const usage = USAGE.replace(
      "skillset status [--json]",
      "skillset status [--scope <scope>] [--json]"
    );
    expect(
      validateCliContractParity({ publicRouteFlags, usage })
    ).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          "status does not accept declared flag --scope"
        ),
        surface: "runtime",
      })
    );

    expect(
      validateCliContractParity({
        hiddenRouteFlags: { "test worker": ["--root", "--json"] },
      })
    ).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          "test worker does not accept declared flag --json"
        ),
        surface: "runtime",
      })
    );
  });

  test("keeps hidden protocol routes executable but absent from help", () => {
    const usageWithWorker = `${USAGE}\n       skillset test worker <run-id> [--root <path>]`;
    expect(
      validateCliContractParity({
        hiddenRouteFlags: HIDDEN_CLI_ROUTES,
        usage: usageWithWorker,
      })
    ).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("hidden route test worker"),
        surface: "help",
      })
    );
  });
});
