// Property test for filename validation (Property 11).
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { validateFilename } from "./filenames.mjs";

// Feature: day-05-image-gen-mcp, Property 11: For any filename that contains `/`, `\`, or a `..` segment, or that is empty, whitespace-only, or longer than 255 characters, filename validation returns an error and no file is written.
test("Property 11: invalid filenames are rejected by validateFilename", () => {
  // A generator of "core" strings used to build filenames. These are kept free
  // of separators and ".." so the harness can inject exactly one class of
  // invalidity at a time.
  const cleanFragment = fc
    .string({ maxLength: 20 })
    .filter((s) => !s.includes("/") && !s.includes("\\") && !s.includes(".."));

  // Category 1: contains a forward-slash or backslash separator.
  const withSeparator = fc
    .tuple(cleanFragment, fc.constantFrom("/", "\\"), cleanFragment)
    .map(([a, sep, b]) => a + sep + b);

  // Category 2: contains a `..` parent-directory *segment* (a bare "..", or a
  // ".." bounded by separators). A ".." embedded inside other characters
  // (e.g. "a..b" or ".. ") is a legitimate name and is intentionally excluded.
  const withDotDot = fc.oneof(
    fc.constant(".."),
    fc.tuple(fc.constantFrom("/", "\\"), cleanFragment).map(([sep, b]) => ".." + sep + b),
    fc.tuple(cleanFragment, fc.constantFrom("/", "\\")).map(([a, sep]) => a + sep + ".."),
    fc
      .tuple(cleanFragment, fc.constantFrom("/", "\\"), fc.constantFrom("/", "\\"), cleanFragment)
      .map(([a, sep1, sep2, b]) => a + sep1 + ".." + sep2 + b),
  );

  // Category 3: empty or whitespace-only.
  const emptyOrWhitespace = fc.oneof(
    fc.constant(""),
    fc
      .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
        minLength: 1,
        maxLength: 10,
      })
      .map((chars) => chars.join("")),
  );

  // Category 4: longer than 255 characters (no separators / "..").
  const tooLong = fc
    .integer({ min: 256, max: 400 })
    .map((n) => "a".repeat(n));

  const invalidFilename = fc.oneof(
    withSeparator,
    withDotDot,
    emptyOrWhitespace,
    tooLong,
  );

  fc.assert(
    fc.property(invalidFilename, (name) => {
      const result = validateFilename(name);
      // Validation must fail (ok:false) for every invalid filename, and carry
      // a structured error naming the filename parameter. A rejected filename
      // means no file is written by the handlers that gate on this check.
      assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(name)}`);
      assert.ok(result.error, "a rejected filename must carry an error");
      assert.equal(result.error.parameter, "filename");
    }),
    { numRuns: 200 },
  );
});
