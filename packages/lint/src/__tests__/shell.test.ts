import { describe, expect, test } from "bun:test";

import {
  findCommandSubstitutions,
  findTopLevelSeparators,
  hasTopLevelMixedAndOr,
  hasTopLevelSemicolon,
} from "../shell";

// Cases adapted from compound-engineering-plugin's
// tests/skill-shell-safety.test.ts reference implementation.

describe("hasTopLevelMixedAndOr", () => {
  test("flags the `[A] && B || C` antipattern", () => {
    expect(hasTopLevelMixedAndOr('[ -n "$x" ] && echo yes || echo no')).toBe(
      true
    );
  });

  test("does not flag `&&`-only chains", () => {
    expect(hasTopLevelMixedAndOr('a=$(cmd) && [ -n "$a" ] && echo "$a"')).toBe(
      false
    );
  });

  test("does not flag `||`-only chains", () => {
    expect(hasTopLevelMixedAndOr("cmd 2>/dev/null || echo fallback")).toBe(
      false
    );
  });

  test("does not flag `&&` inside subshells with `||` only at top level", () => {
    expect(hasTopLevelMixedAndOr("(a && b) || (c && d) || echo fallback")).toBe(
      false
    );
  });

  test("does not flag operators inside quoted strings", () => {
    expect(hasTopLevelMixedAndOr('echo "a && b || c"')).toBe(false);
  });

  test("does not flag `&&` inside `$(...)` with `||` at top level", () => {
    expect(hasTopLevelMixedAndOr("x=$(a && b) || echo fallback")).toBe(false);
  });
});

describe("hasTopLevelSemicolon", () => {
  test("flags a bare `;` separator", () => {
    expect(hasTopLevelSemicolon("setup; cmd")).toBe(true);
  });

  test("does not flag `;` inside a `(...)` subshell", () => {
    expect(
      hasTopLevelSemicolon(
        '(top=$(git rev-parse --show-toplevel 2>/dev/null); cat "$top/file") || echo fallback'
      )
    ).toBe(false);
  });

  test("does not flag `;` inside quotes", () => {
    expect(hasTopLevelSemicolon("echo 'a; b' \"c; d\"")).toBe(false);
  });
});

describe("findTopLevelSeparators", () => {
  test("reports separators in order", () => {
    expect(findTopLevelSeparators("a; b && c || d")).toEqual([";", "&&", "||"]);
  });

  test("ignores separators below the top level", () => {
    expect(findTopLevelSeparators("(a; b && c) || d")).toEqual(["||"]);
  });
});

describe("findCommandSubstitutions", () => {
  test("captures `$(...)` contents through double quotes", () => {
    expect(findCommandSubstitutions('basename "$(dirname "$common")"')).toEqual(
      ['dirname "$common"']
    );
  });

  test("captures nested `$(...)` as one outer span", () => {
    expect(
      findCommandSubstitutions('basename "$(dirname "$(dirname "$x")")"')
    ).toEqual(['dirname "$(dirname "$x")"']);
  });

  test("skips `$(` inside single quotes", () => {
    expect(findCommandSubstitutions("echo '$(not a substitution)'")).toEqual(
      []
    );
  });

  test("returns nothing for plain commands", () => {
    expect(findCommandSubstitutions("git status")).toEqual([]);
  });
});
