// Property test for the request carrying the Effective_Prompt and selected model (Property 7).
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { handleGenerateImage } from "./generateImage.mjs";
import { loadConfig } from "../config.mjs";
import { composePrompt } from "../promptComposer.mjs";

// A workspace root the identity-realpath / no-op fs stubs pretend exists.
const config = loadConfig({ WORKSPACE_ROOT: "/workspace" }, "/workspace");

// A valid, non-empty PNG-ish base64 payload so the success path (decode + write)
// completes without touching the real network or disk.
const B64_PAYLOAD = Buffer.from("fake-png-bytes").toString("base64");

/**
 * Build a set of injected effects that record every fetch request body and
 * always return a SUCCESS Images API response. The fs/realpath/readdir stubs
 * keep the whole call fully in-memory.
 * @returns {{ deps: object, requests: Array<{ url: string, body: any }> }}
 */
function makeDeps(env) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    let body = null;
    try {
      body = typeof options?.body === "string" ? JSON.parse(options.body) : options?.body;
    } catch {
      body = options?.body ?? null;
    }
    requests.push({ url, body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: B64_PAYLOAD }] }),
    };
  };

  const fs = {
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    rename: async () => undefined,
    rm: async () => undefined,
  };

  return {
    requests,
    deps: {
      config,
      env,
      fetchImpl,
      fs,
      realpath: (p) => p, // identity: pretend every path already exists
      readdir: () => [], // no existing files in the output directory
      now: () => 1_700_000_000_000, // constant clock
    },
  };
}

// Feature: day-05-image-gen-mcp, Property 7: For any valid input, the request body sent to the injected fetch has a prompt equal to the composed Effective_Prompt and a model equal to the selected (specified or default) Image_Model.
test("Property 7: the request carries the Effective_Prompt and the selected model", async () => {
  const validPrompt = fc.string({ minLength: 1, maxLength: 4000 });

  // Style-guide result variants: "none" and "ok" with 1–20000 char contents.
  const styleGuideResult = fc.oneof(
    fc.constant({ status: "none" }),
    fc
      .string({ minLength: 1, maxLength: 20000 })
      .map((contents) => ({ status: "ok", contents })),
  );

  // Selected model: specified gpt-image-1/dall-e-3, or omitted (=> default gpt-image-1).
  const selectedModel = fc.oneof(
    fc.constant("gpt-image-1"),
    fc.constant("dall-e-3"),
    fc.constant(undefined),
  );

  await fc.assert(
    fc.asyncProperty(
      validPrompt,
      styleGuideResult,
      selectedModel,
      async (prompt, sgResult, model) => {
        const env = { OPENAI_API_KEY: "sk-valid-test-key-1234567890" };
        const { deps, requests } = makeDeps(env);

        // Inject the generated style-guide result so the handler composes the
        // Effective_Prompt from exactly this classification.
        deps.readStyleGuide = async () => sgResult;

        const args = { prompt };
        if (model !== undefined) args.model = model;

        const result = await handleGenerateImage(args, deps);

        // The success path must have been reached and fetch invoked exactly once
        // (a SUCCESS first response means no dall-e-3 fallback occurs).
        assert.equal(result.isError, false, "expected a successful Tool_Result");
        assert.equal(requests.length, 1, "expected exactly one fetch request");

        const expectedModel = model ?? "gpt-image-1";
        const { effectivePrompt } = composePrompt(prompt, sgResult);

        const body = requests[0].body;
        assert.equal(
          body.prompt,
          effectivePrompt,
          "request prompt must equal the composed Effective_Prompt",
        );
        assert.equal(
          body.model,
          expectedModel,
          "request model must equal the selected (or default) Image_Model",
        );
      },
    ),
    { numRuns: 100 },
  );
});
