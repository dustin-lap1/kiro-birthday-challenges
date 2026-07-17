// Property test for model fallback and reported model (Property 14).
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { generate } from "./openaiClient.mjs";

// A response object shaped like a fetch Response the way openaiClient consumes it:
// only `ok`, `status`, and `json()` are used.
function makeResponse(spec) {
  if (spec.kind === "success") {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: spec.b64 }] }),
    };
  }
  // model-access rejection: 403/404-class error
  return {
    ok: false,
    status: spec.status,
    json: async () => ({
      error: { message: "You do not have access to this model." },
    }),
  };
}

// Build an injected fetch stub that returns configured responses in sequence and
// records every request (so the test can assert the call count and the model in
// each request body).
function makeFetchStub(responseSpecs) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    let body = null;
    try {
      body = JSON.parse(options.body);
    } catch {
      body = null;
    }
    calls.push({ url, options, body });
    const spec = responseSpecs[calls.length - 1];
    if (!spec) {
      throw new Error(
        `unexpected extra fetch call #${calls.length} (only ${responseSpecs.length} configured)`,
      );
    }
    return makeResponse(spec);
  };
  return { fetchImpl, calls };
}

const SUPPORTED_SIZE = fc.constantFrom(
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1792x1024",
  "1024x1792",
  "auto",
);
const SUPPORTED_QUALITY = fc.constantFrom(
  "low",
  "medium",
  "high",
  "standard",
  "hd",
  "auto",
);
const ACCESS_REJECT_STATUS = fc.constantFrom(403, 404);
const B64 = fc.string({ minLength: 1, maxLength: 64 });

// An outcome for a single API call: either a success (carrying b64) or a
// model-access rejection (403/404).
const outcome = fc.oneof(
  B64.map((b64) => ({ kind: "success", b64 })),
  ACCESS_REJECT_STATUS.map((status) => ({ kind: "reject", status })),
);

// Feature: day-05-image-gen-mcp, Property 14: For any first-call response: if `gpt-image-1` is rejected for lack of account access, the client issues exactly one retry with `dall-e-3`; if both are access-rejected the result is a model-access error carrying no image data; and whenever a call succeeds the reported model equals the model whose call succeeded.
test("Property 14: model fallback happens exactly once and the reported model is the one that succeeded", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("gpt-image-1", "dall-e-3"),
      outcome, // first-call outcome
      outcome, // fallback-call outcome (only consumed when fallback occurs)
      fc.string({ minLength: 1, maxLength: 200 }),
      SUPPORTED_SIZE,
      SUPPORTED_QUALITY,
      fc.string({ minLength: 1, maxLength: 40 }),
      async (model, first, second, effectivePrompt, size, quality, apiKey) => {
        const { fetchImpl, calls } = makeFetchStub([first, second]);

        const result = await generate({
          apiKey,
          model,
          effectivePrompt,
          size,
          quality,
          fetchImpl,
        });

        // Every call's request body must name the model that call was issued for.
        assert.equal(calls[0].body.model, model, "first request uses the selected model");

        if (model === "gpt-image-1" && first.kind === "reject") {
          // gpt-image-1 access rejection -> exactly one retry with dall-e-3.
          assert.equal(calls.length, 2, "exactly one retry is issued");
          assert.equal(
            calls[1].body.model,
            "dall-e-3",
            "the retry uses dall-e-3",
          );

          if (second.kind === "success") {
            // Fallback succeeded: reported model equals the model that succeeded.
            assert.equal(result.ok, true);
            assert.equal(result.model, "dall-e-3");
            assert.equal(result.b64, second.b64);
          } else {
            // Both access-rejected: model-access error carrying no image data.
            assert.equal(result.ok, false);
            assert.equal(result.kind, "model_access");
            assert.equal(result.b64, undefined, "no image data on model-access error");
          }
          return;
        }

        // No fallback path (either first call succeeded, or a dall-e-3 first call
        // was rejected and gets no retry).
        assert.equal(calls.length, 1, "no retry is issued");

        if (first.kind === "success") {
          // A succeeding call reports the model whose call succeeded.
          assert.equal(result.ok, true);
          assert.equal(result.model, model);
          assert.equal(result.b64, first.b64);
        } else {
          // dall-e-3 first-call access rejection: model-access error, no data,
          // and no fallback (the fallback only applies to gpt-image-1).
          assert.equal(result.ok, false);
          assert.equal(result.kind, "model_access");
          assert.equal(result.b64, undefined, "no image data on model-access error");
        }
      },
    ),
    { numRuns: 200 },
  );
});
