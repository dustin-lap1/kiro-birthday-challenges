// filenames.property12.test.mjs — Property-based test for non-overwriting
// filename derivation.

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { deriveUniqueFilename } from "./filenames.mjs";

// Feature: day-05-image-gen-mcp, Property 12: For any desired filename and any
// set of existing filenames in the Output_Directory, the derived filename is
// not a member of the existing set (including the generated default when no
// filename is supplied).
test("Property 12: derived filename never collides with an existing name", () => {
  // A generator for plausible filenames (with and without extensions). These
  // are used both as desired names and as the contents of the existing set, so
  // collisions are exercised frequently.
  const filenameArb = fc.oneof(
    // Simple base names with common image extensions.
    fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
        fc.constantFrom(".png", ".jpg", ".jpeg", ".webp", ".gif", "")
      )
      .map(([base, ext]) => `${base}${ext}`),
    // Names drawn from a small pool to force frequent collisions.
    fc.constantFrom(
      "image.png",
      "photo.jpg",
      "art.png",
      "image-1.png",
      "image-2.png",
      "file"
    )
  );

  fc.assert(
    fc.property(
      // Desired name is present roughly half the time; undefined models the
      // "no filename supplied" case that generates a timestamped default.
      fc.option(filenameArb, { nil: undefined }),
      fc.array(filenameArb, { maxLength: 30 }),
      fc.integer({ min: 0, max: 4102444800000 }),
      (desiredName, existingArr, timestamp) => {
        const existingSet = new Set(existingArr);

        const derived = deriveUniqueFilename(desiredName, existingSet, timestamp);

        // The core property: the derived name is never a member of the
        // existing set, regardless of whether a name was supplied.
        assert.ok(
          !existingSet.has(derived),
          `derived name "${derived}" collides with the existing set`
        );

        // It must always produce a usable, non-empty string.
        assert.equal(typeof derived, "string");
        assert.ok(derived.length > 0);
      }
    ),
    { numRuns: 300 }
  );
});
