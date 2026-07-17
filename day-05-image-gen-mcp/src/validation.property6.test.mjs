// Property test for defaulting of omitted optional parameters (Property 6).
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { validateGenerateInput } from "./validation.mjs";
import {
  Supported_Size,
  Supported_Quality,
  Default_Size,
  Default_Quality,
  Default_Model,
} from "./config.mjs";

const SIZE_MEMBERS = [...Supported_Size];
const QUALITY_MEMBERS = [...Supported_Quality];
const MODEL_MEMBERS = ["gpt-image-1", "dall-e-3"];

// A config that carries defaults, mirroring what loadConfig produces.
const config = {
  defaults: {
    size: Default_Size,
    quality: Default_Quality,
    model: Default_Model,
  },
};

// Feature: day-05-image-gen-mcp, Property 6: For any otherwise-valid input, omitting `size`, `quality`, or `model` yields a normalized input whose value equals `Default_Size`, `Default_Quality`, and `gpt-image-1` respectively.
test("Property 6: omitted optional params take their defaults; present valid members are preserved", () => {
  // A valid, non-empty prompt (1–4000 chars) so the input is otherwise valid.
  const validPrompt = fc.string({ minLength: 1, maxLength: 4000 });

  // Each optional field is independently either omitted or present-with-a-valid
  // member. `undefined` models omission; a member string models "present".
  const optionalSize = fc.option(fc.constantFrom(...SIZE_MEMBERS), {
    nil: undefined,
  });
  const optionalQuality = fc.option(fc.constantFrom(...QUALITY_MEMBERS), {
    nil: undefined,
  });
  const optionalModel = fc.option(fc.constantFrom(...MODEL_MEMBERS), {
    nil: undefined,
  });

  fc.assert(
    fc.property(
      validPrompt,
      optionalSize,
      optionalQuality,
      optionalModel,
      (prompt, size, quality, model) => {
        const raw = { prompt };
        if (size !== undefined) raw.size = size;
        if (quality !== undefined) raw.quality = quality;
        if (model !== undefined) raw.model = model;

        const result = validateGenerateInput(raw, config);

        // The input is otherwise valid, so validation must succeed.
        assert.equal(result.ok, true, "otherwise-valid input must validate");

        // Omitted -> default; present valid member -> preserved.
        assert.equal(
          result.value.size,
          size === undefined ? Default_Size : size,
        );
        assert.equal(
          result.value.quality,
          quality === undefined ? Default_Quality : quality,
        );
        assert.equal(
          result.value.model,
          model === undefined ? Default_Model : model,
        );
      },
    ),
    { numRuns: 200 },
  );
});
