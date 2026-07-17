// Property test for missing API key blocking the network call (Property 2).
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fc from "fast-check";

import { handleGenerateImage } from "./generateImage.mjs";

// A fetch spy that records whether it was ever invoked. Reaching this stub at
// all is a failure for this property: a missing key must short-circuit BEFORE
// any network call. It throws so an accidental call also surfaces loudly.
function makeSpyFetch() {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("fetch must not be called when the API key is missing");
  };
  return { fetchImpl, wasCalled: () => called };
}

// A workspace root that never has to exist on disk: path resolution is not
// reached because the auth check short-circuits first, and the injected
// realpath/readdir stubs keep everything in-memory regardless.
const WORKSPACE_ROOT = os.tmpdir();

// Config injected directly so no environment probing occurs (design: config.mjs).
const CONFIG = {
  workspaceRoot: WORKSPACE_ROOT,
  defaultOutputDir: "public/images",
  styleGuidePath: null,
  enableEditTool: false,
  enableListTool: false,
  defaults: { size: "1024x1024", quality: "auto", model: "gpt-image-1" },
};

// In-memory effect stubs so nothing touches the real disk or clock.
const realpath = (p) => p;
const readdir = () => [];
const readStyleGuide = async () => ({ status: "none" });
const now = () => 1_700_000_000_000;

// An otherwise-VALID set of args so the ONLY reason the call can fail is the
// missing key. A prompt of 1..4000 chars with at least one non-whitespace char.
const validPrompt = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

// Whitespace-only strings built from the common whitespace characters.
const whitespaceOnly = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
    minLength: 1,
    maxLength: 12,
  })
  .map((chars) => chars.join(""));

// The three ways the OPENAI_API_KEY can be "missing" per Req 2.2:
//   - absent  : the key is not present on env at all
//   - empty   : the empty string
//   - blank   : whitespace-only
// Each generator yields a full env object; other unrelated keys may be present.
const envWithoutKey = fc
  .dictionary(
    fc.string({ minLength: 1, maxLength: 8 }).filter((k) => k !== "OPENAI_API_KEY"),
    fc.string({ maxLength: 8 }),
    { maxKeys: 4 },
  )
  .map((extra) => {
    const env = { ...extra };
    delete env.OPENAI_API_KEY;
    return env;
  });

const envEmptyKey = fc.constant({ OPENAI_API_KEY: "" });
const envBlankKey = whitespaceOnly.map((ws) => ({ OPENAI_API_KEY: ws }));

const missingKeyEnv = fc.oneof(envWithoutKey, envEmptyKey, envBlankKey);

// Feature: day-05-image-gen-mcp, Property 2: For any value of OPENAI_API_KEY that is absent, empty, or composed only of whitespace, invoking a network-calling tool returns an error Tool_Result stating the key is required, and the injected fetch is never called.
test("Property 2: missing API key blocks the network call", async () => {
  await fc.assert(
    fc.asyncProperty(missingKeyEnv, validPrompt, async (env, prompt) => {
      const spy = makeSpyFetch();

      const result = await handleGenerateImage(
        { prompt },
        {
          config: CONFIG,
          env,
          fetchImpl: spy.fetchImpl,
          realpath,
          readdir,
          readStyleGuide,
          now,
        },
      );

      // The Tool_Result is marked as an error (Req 2.2).
      assert.equal(result.isError, true, "a missing key must yield an error result");
      // The error is specifically an auth error about the required key.
      assert.equal(
        result.structuredContent.errorKind,
        "auth",
        "errorKind must indicate an authentication problem",
      );
      // The message must state that OPENAI_API_KEY is required (Req 2.2).
      const text = result.content.map((c) => c.text).join(" ");
      assert.match(
        text,
        /OPENAI_API_KEY/,
        "the error message must state the OPENAI_API_KEY is required",
      );
      // The injected fetch must never have been called (Req 2.3).
      assert.equal(
        spy.wasCalled(),
        false,
        "the network call must be skipped entirely when the key is missing",
      );
    }),
    { numRuns: 200 },
  );
});
