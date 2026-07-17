// Property test for invalid prompt rejection (Property 4).
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { validateGenerateInput, validateEditInput } from "./validation.mjs";

// A "never called" fetch. Validation happens before any network call, so if
// validation ever reaches out to fetch the test fails loudly. Both validation
// functions are pure and take no fetch, so this simply proves the boundary is
// respected: an invalid prompt is rejected without any opportunity to call it.
function makeSpyFetch() {
  let called = false;
  const fetchImpl = () => {
    called = true;
    throw new Error("fetch must not be called for an invalid prompt");
  };
  return { fetchImpl, wasCalled: () => called };
}

// Generators for the three classes of invalid prompt named by the property:
//   - missing (undefined)
//   - empty string
//   - longer than 4000 characters
const missingPrompt = fc.constant(undefined);
const emptyPrompt = fc.constant("");
const tooLongPrompt = fc
  .integer({ min: 4001, max: 6000 })
  .map((n) => "a".repeat(n));

const invalidPrompt = fc.oneof(missingPrompt, emptyPrompt, tooLongPrompt);

// A source path that is otherwise valid, so for the edit boundary the ONLY
// failing field is the prompt.
const validSourcePath = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0)
  .map((s) => "public/images/" + s.replace(/[/\\]/g, "_") + ".png");

// Feature: day-05-image-gen-mcp, Property 4: For any prompt that is missing, empty, or longer than 4000 characters, input validation returns a validation error naming the `prompt` parameter and the injected fetch is never called (at both the generate and edit boundaries).
test("Property 4: invalid prompt is rejected without an API call (generate + edit)", () => {
  fc.assert(
    fc.property(invalidPrompt, validSourcePath, (prompt, sourcePath) => {
      // --- generate boundary ---
      const genSpy = makeSpyFetch();
      const genResult = validateGenerateInput(
        { prompt },
        { fetchImpl: genSpy.fetchImpl },
      );
      assert.equal(
        genResult.ok,
        false,
        `generate: expected rejection for prompt ${JSON.stringify(prompt)}`,
      );
      assert.ok(genResult.error, "generate: a rejected input must carry an error");
      assert.equal(genResult.error.parameter, "prompt");
      assert.equal(
        genSpy.wasCalled(),
        false,
        "generate: fetch must never be called for an invalid prompt",
      );

      // --- edit boundary (only the prompt is invalid; sourcePath is valid) ---
      const editSpy = makeSpyFetch();
      const editResult = validateEditInput(
        { prompt, sourcePath },
        { fetchImpl: editSpy.fetchImpl },
      );
      assert.equal(
        editResult.ok,
        false,
        `edit: expected rejection for prompt ${JSON.stringify(prompt)}`,
      );
      assert.ok(editResult.error, "edit: a rejected input must carry an error");
      assert.equal(editResult.error.parameter, "prompt");
      assert.equal(
        editSpy.wasCalled(),
        false,
        "edit: fetch must never be called for an invalid prompt",
      );
    }),
    { numRuns: 200 },
  );
});
