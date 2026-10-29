import { expect, test } from "bun:test";
import { parseMigrationMarker, formatMigrationMarker } from "../migration-marker";

const marker = { label: "todo" as const, id: "adopt-k3m9", code: "ambiguous-document-reference", message: "Review {{missing}} and @alice." };
const text = "<!-- skillset:todo ::: #adopt-k3m9 [ambiguous-document-reference] Review {{missing}} and @alice. -->";

test("exact migration marker grammar round trips without interpreting its prose", () => {
  expect(formatMigrationMarker(marker)).toBe(text);
  expect(parseMigrationMarker(text)).toEqual(marker);
  expect(parseMigrationMarker(text.replace("skillset:todo", "skillset:fix"))).toEqual({ ...marker, label: "fix" });
});

test("nearby comments and malformed ownership never parse as markers", () => {
  for (const value of [
    "<!-- ordinary comment -->", "skillset:todo", `prefix ${text}`, `${text} suffix`,
    text.replace(" ::: ", " :: "), text.replace("adopt-k3m9", "adopt-x"),
    text.replace("ambiguous-document-reference", "Invalid code"), text.replace("todo", "done"),
    text.replace("Review", "--> <!-- Review"), text.replace("Review", "Review\n"),
    text.replace(marker.message, ""), text.replace(marker.message, " "),
  ]) expect(parseMigrationMarker(value)).toBeUndefined();
});

test("formatting refuses unsafe comment bodies and invalid contract values", () => {
  for (const message of ["", " ", "a--b", "a\nb", "a\rb", "a\0b", " trailing "]) {
    expect(() => formatMigrationMarker({ ...marker, message })).toThrow();
  }
  expect(() => formatMigrationMarker({ ...marker, id: "other-id" })).toThrow();
});
