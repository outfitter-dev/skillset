import { describe, expect, test } from "bun:test";

import {
  assertBooleanOption,
  CliArgReader,
  splitCliOption,
} from "../cli-arg-reader";
import type { CliOptionToken } from "../cli-arg-reader";

const readOption = (reader: CliArgReader): CliOptionToken => {
  const option = reader.readOption();
  if (option === undefined) {
    throw new Error("expected option");
  }
  return option;
};

describe("SET-300 CLI argument reader", () => {
  test("traverses argv from an injected cursor", () => {
    const reader = new CliArgReader(["build", "path", "--json"], 1);

    expect(reader.index).toBe(1);
    expect(reader.peek()).toBe("path");
    expect(reader.readOptionalPositional()).toBe("path");
    expect(reader.index).toBe(2);
    expect(reader.readOptionalPositional()).toBeUndefined();
    expect(reader.read()).toBe("--json");
    expect(reader.done).toBe(true);
  });

  test("splits inline values without losing empty values", () => {
    expect(splitCliOption("--root=workspace")).toEqual({
      flag: "--root",
      inlineValue: "workspace",
      raw: "--root=workspace",
    });
    expect(splitCliOption("--root=")).toEqual({
      flag: "--root",
      inlineValue: "",
      raw: "--root=",
    });
    expect(splitCliOption("--json")).toEqual({
      flag: "--json",
      raw: "--json",
    });
  });

  test("reads required inline and separate option values", () => {
    const reader = new CliArgReader(["--root", "workspace", "--name=demo"]);
    const root = readOption(reader);
    expect(reader.readRequiredOptionValue(root)).toBe("workspace");
    const name = readOption(reader);
    expect(reader.readRequiredOptionValue(name)).toBe("demo");
    expect(reader.done).toBe(true);
  });

  test("preserves missing-value and boolean diagnostics", () => {
    const reader = new CliArgReader(["--root", "--json"]);
    const root = readOption(reader);
    expect(() => reader.readRequiredOptionValue(root)).toThrow(
      "skillset: expected value after --root"
    );
    const json = readOption(reader);
    expect(() => assertBooleanOption(json)).not.toThrow();
    expect(() => assertBooleanOption(splitCliOption("--json=true"))).toThrow(
      "skillset: --json does not take a value"
    );
  });

  test("reads optional inline or repeated positional values", () => {
    const inline = new CliArgReader(["--compat=claude,codex", "tail"]);
    expect(inline.readOptionalOptionValues(readOption(inline))).toEqual([
      "claude,codex",
    ]);
    expect(inline.peek()).toBe("tail");

    const separate = new CliArgReader([
      "--compat",
      "claude",
      "codex",
      "--json",
    ]);
    expect(separate.readOptionalOptionValues(readOption(separate))).toEqual([
      "claude",
      "codex",
    ]);
    expect(separate.peek()).toBe("--json");
  });
});
