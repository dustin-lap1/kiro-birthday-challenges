// Property test for non-member enum rejection (Property 5).
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { validateGenerateInput } from "./validation.mjs";
import { Supported_Size, Supported_Quality } from "./config.mjs";

// The supported model set mirrors the one enforced in validation.mjs.
const SUPPORTED_MODELS = new Set(["gpt-image-1", "dall-e-3"]);

// A valid, in-range prompt so that validation always advances past the prompt
// check to the enum checks under test.
const VALID_PROMPT = "a friendly robot painting a mural";
// Concrete in-set values used to keep the earlier-validated parameters valid
// while a single enum is driven out of its set.
const VALID_SIZE = "1024x1024";
const VALID_QUALITY = "auto";

// A string generator producing values that are NOT members of `supported`.
function outsideOf(supported) {
  return fc.string({ maxLength: 24 }).filter((s) => !supported.has(s));
}

// Feature: day-05-image-gen-mcp, Property 5: For any `size`, `quality`, or `model` value that is not a member of its supported set, validation returns a validation error naming that parameter and the injected fetch is never called.
test("Property 5: non-member enum values are rejected without an API call", () => {
  // Validation order in the impl is prompt -> size -> quality -> model. To
  // isolate a single offending enum, we keep every earlier-validated parameter
  // valid and only push the parameter under test outside its supported set.
  const nonMemberSize = outsideOf(Supported_Size).map((size) => ({
    parameter: "size",
    input: { prompt: VALID_PROMPT, size },
  }));

  const nonMemberQuality = outsideOf(Supported_Quality).map((quality) => ({
    parameter: "quality",
    input: { prompt: VALID_PROMPT, size: VALID_SIZE, quality },
  }));

  const nonMemberModel = outsideOf(SUPPORTED_MODELS).map((model) => ({
    parameter: "model",
    input: {
      prompt: VALID_PROMPT,
      size: VALID_SIZE,
      quality: VALID_QUALITY,
      model,
    },
  }));

  const nonMemberCase = fc.oneof(
    nonMemberSize,
    nonMemberQuality,
    nonMemberModel,
  );

  fc.assert(
    fc.property(nonMemberCase, ({ parameter, input }) => {
      // An injected fetch that fails loudly if validation ever reaches out to
      // the network. Pure input validation must never call it.
      let fetchCalls = 0;
      const fetchSpy = () => {
        fetchCalls += 1;
        throw new Error("fetch must not be called during input validation");
      };

      const result = validateGenerateInput(input, { fetch: fetchSpy });

      // The offending enum is rejected with a structured validation error that
      // names exactly the parameter that was out of range.
      assert.equal(
        result.ok,
        false,
        `expected rejection for ${parameter}=${JSON.stringify(input[parameter])}`,
      );
      assert.ok(result.error, "a rejected input must carry an error");
      assert.equal(result.error.kind, "validation");
      assert.equal(result.error.parameter, parameter);

      // No API call is made when validation fails.
      assert.equal(fetchCalls, 0, "fetch must never be called");
    }),
    { numRuns: 200 },
  );
});
