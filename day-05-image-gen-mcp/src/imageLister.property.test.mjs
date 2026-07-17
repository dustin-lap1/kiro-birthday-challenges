// imageLister.property.test.mjs — Property-based test for sorted image listing.

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { listImages } from "./imageLister.mjs";

// The set of extensions the lister recognizes as image files. Kept in sync with
// imageLister.mjs so the expected result can be computed independently here.
const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg",
];

// Non-image extensions used to salt the directory contents so the filter has
// something to exclude.
const NON_IMAGE_EXTENSIONS = [".txt", ".md", ".json", ".mjs", ".pdf", ".zip", ""];

// Feature: day-05-image-gen-mcp, Property 17: For any directory contents,
// list_generated_images returns exactly the image files present, each
// identified by file name, ordered ascending lexicographically (an empty or
// missing directory yields an empty list).
test("Property 17: listing returns exactly the image files, sorted ascending", () => {
  // A base name generator (no extension). Kept simple but non-empty so the
  // resulting file names are plausible directory entries.
  const baseNameArb = fc
    .string({ minLength: 1, maxLength: 16 })
    .filter((s) => !s.includes(".") && s.trim().length > 0);

  // A file name that is an image (base + a recognized image extension). The
  // extension casing is randomized to exercise the case-insensitive match.
  const imageNameArb = fc
    .tuple(baseNameArb, fc.constantFrom(...IMAGE_EXTENSIONS), fc.boolean())
    .map(([base, ext, upper]) => `${base}${upper ? ext.toUpperCase() : ext}`);

  // A file name that is NOT an image.
  const nonImageNameArb = fc
    .tuple(baseNameArb, fc.constantFrom(...NON_IMAGE_EXTENSIONS))
    .map(([base, ext]) => `${base}${ext}`);

  fc.assert(
    fc.property(
      fc.array(fc.oneof(imageNameArb, nonImageNameArb), { maxLength: 40 }),
      (names) => {
        // Inject an in-memory readdir stub returning exactly these names.
        const readdir = (_dir) => names.slice();

        const result = listImages("/workspace/public/images", readdir);

        assert.equal(result.ok, true);

        // Compute the expected set independently: keep only image files, sort
        // ascending lexicographically (default string sort, matching the impl).
        const expected = names
          .filter((name) => {
            const dot = name.lastIndexOf(".");
            if (dot <= 0) return false;
            return IMAGE_EXTENSIONS.includes(name.slice(dot).toLowerCase());
          })
          .sort();

        assert.deepEqual(result.entries, expected);

        // The result must be sorted ascending and contain only image files.
        for (let i = 1; i < result.entries.length; i++) {
          assert.ok(
            result.entries[i - 1] <= result.entries[i],
            "entries must be in ascending lexicographic order"
          );
        }
      }
    ),
    { numRuns: 200 }
  );
});

// A missing directory (readdir throws ENOENT) yields an empty successful list.
test("Property 17: a missing directory yields an empty list", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 40 }), (dir) => {
      const readdir = () => {
        const err = new Error("no such file or directory");
        err.code = "ENOENT";
        throw err;
      };

      const result = listImages(dir, readdir);

      assert.deepEqual(result, { ok: true, entries: [] });
    }),
    { numRuns: 100 }
  );
});
